// The CI step "Start the production build" (instruction 5). The build alone does not show that the
// apps start: `next start` checks the web server's environment variables only as it starts, and the
// API's production start runs compiled code with flags of its own. This starts both production
// builds with `pnpm start`, as a developer would, on free ports of 127.0.0.1; waits until the API
// answers GET /health and the web app serves its home page; then stops them by sending SIGTERM to
// pnpm. pnpm passes it on to both apps, but kills the other app as soon as one has ended, so the
// check shows that the apps start and answer, not that each one shuts down cleanly (the API's own
// tests, apps/api/src/server.test.ts and production.test.ts, check its shutdown).
//
// Usage, from the repository root, after `pnpm build`: node scripts/check-start.ts
// Exit status: 0 when both apps answered and then stopped, 1 otherwise. On failure it says what
// went wrong and prints everything the apps printed. Interrupted by SIGINT (Ctrl+C), SIGTERM or
// SIGHUP, it stops the apps first and then ends by that signal.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

/** The API's GET /health body, as packages/shared's healthResponseSchema defines it. */
const healthSchema = z.strictObject({ status: z.literal("ok") });

/**
 * The address both apps listen on, given as WEB_HOST and API_HOST, so that a wider address in the
 * shell or in apps/api/.env never exposes them during the check.
 */
const HOST = "127.0.0.1";

/** How long both apps may take to answer, from the moment the command starts. */
const START_TIMEOUT_MS = 60_000;

/** How long the apps may take to stop after SIGTERM, and then to end after SIGKILL. */
const STOP_TIMEOUT_MS = 10_000;

/** How long one request may take. */
const REQUEST_TIMEOUT_MS = 2_000;

/** How long to wait between two rounds of requests. */
const POLL_INTERVAL_MS = 250;

/** What interrupts the check as a program: Ctrl+C, `kill` or `timeout`, a closed terminal. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const satisfies readonly NodeJS.Signals[];

export interface StartCheckOptions {
  /** The command that starts both apps and the arguments it gets; `pnpm start` by default. */
  readonly command?: readonly [string, ...string[]];
  /** How long both apps may take to answer; one minute by default. */
  readonly timeoutMs?: number;
  /**
   * How long the apps may take to stop after SIGTERM, and then to end after SIGKILL; ten seconds
   * by default.
   */
  readonly stopTimeoutMs?: number;
  /** Once aborted, the check stops waiting for the apps, stops them as usual and fails. */
  readonly signal?: AbortSignal;
}

export interface StartCheckResult {
  /** The ports the apps were given, as WEB_PORT and API_PORT. */
  readonly ports: { readonly web: number; readonly api: number };
  /** What went wrong, one problem per line; undefined when both apps answered and then stopped. */
  readonly problem: string | undefined;
  /**
   * What went wrong while stopping the apps (also the last line of `problem`): they needed SIGKILL,
   * or a process that may still be running holds their output. Undefined otherwise.
   */
  readonly stopProblem: string | undefined;
  /** Everything the command printed, on stdout and stderr. */
  readonly output: string;
}

/** Two loopback ports that were free a moment ago. */
async function freePorts(): Promise<{ web: number; api: number }> {
  const listen = async (): Promise<Server> => {
    const server = createServer();
    server.listen(0, HOST);
    await once(server, "listening");
    return server;
  };
  const servers = [await listen(), await listen()];
  const ports = servers.map((server) => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("could not find a free port");
    }
    return address.port;
  });
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  const [web = 0, api = 0] = ports;
  return { web, api };
}

/**
 * Asks `url` once. Resolves with undefined when the answer passes `accept`, or with a description
 * of what came back (an unexpected answer, or no answer). `signal` cancels the request.
 */
async function probe(
  url: string,
  accept: (response: Response) => Promise<boolean>,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { connection: "close" },
      signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
    });
    if (await accept(response)) {
      return undefined;
    }
    return `answered with status ${String(response.status)} and an unexpected body`;
  } catch (error) {
    return `did not answer (${error instanceof Error ? error.message : String(error)})`;
  }
}

/** Whether the API's answer to GET /health is a 200 with the expected body. */
async function isHealthy(response: Response): Promise<boolean> {
  if (response.status !== 200) {
    return false;
  }
  try {
    return healthSchema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

/** Whether the web app's answer is a 200 HTML page. */
async function isPage(response: Response): Promise<boolean> {
  const html = response.headers.get("content-type")?.startsWith("text/html") === true;
  return response.status === 200 && html && (await response.text()).includes("</html>");
}

/** A duration in seconds, for messages: "60" for 60 000 ms, "0.5" for 500 ms. */
const seconds = (ms: number): string => String(ms / 1000);

/**
 * Starts the apps with `options.command` (by default `pnpm start`), with WEB_HOST and API_HOST set
 * to 127.0.0.1 and WEB_PORT and API_PORT to free ports, in a process group of its own. Waits until
 * the API answers GET /health and the web app its home page, then stops the group with SIGTERM,
 * and with SIGKILL if its output has not closed in time. Never waits longer than the time limits.
 */
export async function checkStart(options: StartCheckOptions = {}): Promise<StartCheckResult> {
  const [command, ...args] = options.command ?? ["pnpm", "start"];
  const commandLine = [command, ...args].join(" ");
  const timeoutMs = options.timeoutMs ?? START_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const { signal } = options;
  // A function, not a condition: TypeScript would keep a narrowed `signal.aborted` across awaits.
  const interrupted = (): boolean => signal?.aborted === true;
  const ports = await freePorts();
  if (interrupted()) {
    return {
      ports,
      problem: `The check was interrupted before \`${commandLine}\` started.`,
      stopProblem: undefined,
      output: "",
    };
  }

  // `detached` gives the command a process group of its own, which the stop signals below go to.
  // A plain command's child processes stay in that group. pnpm 12 instead starts each script in a
  // process group of its own. On SIGTERM it passes the signal on to them and ends as soon as one
  // script has ended; whenever pnpm exits, even by SIGKILL, a helper shell of pnpm's kills the
  // groups still running with SIGKILL. So signalling pnpm's group stops the apps as well.
  const child = spawn(command, args, {
    detached: true,
    env: {
      ...process.env,
      WEB_HOST: HOST,
      WEB_PORT: String(ports.web),
      API_HOST: HOST,
      API_PORT: String(ports.api),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk: string): void => {
    output += chunk;
  };
  child.stdout.setEncoding("utf8").on("data", collect);
  child.stderr.setEncoding("utf8").on("data", collect);
  // How the command ended, as first reported: a command that could not be started also closes.
  let exit: string | undefined;
  /** Settles once the command has ended and every process holding its output has closed it. */
  const closed = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      exit ??= `could not be started (${error.message})`;
      resolve();
    });
    child.once("close", (code, endSignal) => {
      exit ??=
        endSignal === null ? `exited with code ${String(code)}` : `was stopped by ${endSignal}`;
      resolve();
    });
  });

  const api = { name: "the API", url: `http://${HOST}:${String(ports.api)}/health` };
  const web = { name: "the web app", url: `http://${HOST}:${String(ports.web)}/` };
  let apiState = await probe(api.url, isHealthy, signal);
  let webState = await probe(web.url, isPage, signal);
  const problems: string[] = [];
  const deadline = Date.now() + timeoutMs;
  while (apiState !== undefined || webState !== undefined) {
    if (interrupted()) {
      problems.push("The check was interrupted before both apps answered.");
      break;
    }
    if (exit !== undefined) {
      problems.push(`\`${commandLine}\` ${exit} before both apps answered.`);
      break;
    }
    if (Date.now() >= deadline) {
      const waiting = [
        ...(apiState === undefined ? [] : [`${api.name} (GET ${api.url}) ${apiState}`]),
        ...(webState === undefined ? [] : [`${web.name} (GET ${web.url}) ${webState}`]),
      ];
      problems.push(`After ${seconds(timeoutMs)} s, ${waiting.join(", and ")}.`);
      break;
    }
    await sleep(POLL_INTERVAL_MS);
    apiState = apiState === undefined ? undefined : await probe(api.url, isHealthy, signal);
    webState = webState === undefined ? undefined : await probe(web.url, isPage, signal);
  }

  const signalGroup = (stop: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) {
        process.kill(-child.pid, stop);
      }
    } catch {
      // Every process of the group has ended (ESRCH; macOS answers EPERM while the ended
      // processes are not yet reaped). The waits below show whether the apps really stopped.
    }
  };
  /** Whether the output closed within `ms`; an unreferenced timer, so it never keeps Node alive. */
  const closedWithin = async (ms: number): Promise<boolean> =>
    Promise.race([closed.then(() => true), sleep(ms, false, { ref: false })]);

  let stopProblem: string | undefined;
  if (exit === undefined) {
    signalGroup("SIGTERM");
    if (!(await closedWithin(stopTimeoutMs))) {
      signalGroup("SIGKILL");
      if (await closedWithin(stopTimeoutMs)) {
        stopProblem =
          `The apps did not stop within ${seconds(stopTimeoutMs)} s of SIGTERM; ` +
          "SIGKILL stopped them.";
      } else {
        // SIGKILL ends every process of the group, so a process outside it holds the output.
        // Closing the streams lets this program end without waiting for that process.
        child.stdout.destroy();
        child.stderr.destroy();
        stopProblem =
          `The apps' output was still open ${seconds(stopTimeoutMs)} s after SIGKILL: a process ` +
          "outside the command's process group holds it, and may still be running.";
      }
    }
  }
  // Processes of the group that outlived the command itself, if any.
  signalGroup("SIGKILL");

  const all = stopProblem === undefined ? problems : [...problems, stopProblem];
  return { ports, problem: all.length === 0 ? undefined : all.join("\n"), stopProblem, output };
}

/**
 * Runs the check as a program: prints its result, or stops early on a stop signal. The tests run
 * it with shorter time `limits` than the defaults.
 */
export async function main(
  limits: Pick<StartCheckOptions, "timeoutMs" | "stopTimeoutMs"> = {},
): Promise<void> {
  // A terminal's Ctrl+C, `kill` and a closed terminal reach only this process, not the process
  // group the apps run in. Stop them first, then end by the same signal, as an interrupted
  // program should, so that a calling shell script stops too.
  const controller = new AbortController();
  const received: NodeJS.Signals[] = [];
  const interrupt = (stop: NodeJS.Signals): void => {
    received.push(stop);
    controller.abort();
  };
  for (const name of STOP_SIGNALS) {
    process.on(name, interrupt);
  }
  const result = await checkStart({ ...limits, signal: controller.signal });
  for (const name of STOP_SIGNALS) {
    process.off(name, interrupt);
  }

  const [stop] = received;
  if (stop !== undefined) {
    // "Stopped the apps" only when nothing may be left running, or else what went wrong.
    const outcome =
      result.stopProblem === undefined ? ": stopped the apps." : `. ${result.stopProblem}`;
    // Without a listener, Node.js no longer handles the signal, so it ends this process.
    process.stderr.write(`Interrupted by ${stop}${outcome}\n`, () => {
      process.kill(process.pid, stop);
    });
  } else if (result.problem === undefined) {
    console.log(
      `Both apps started: the API answered GET /health on port ${String(result.ports.api)}, ` +
        `the web app its home page on port ${String(result.ports.web)}, and both stopped.`,
    );
  } else {
    const printed =
      result.output === ""
        ? "The apps printed nothing."
        : `What the apps printed:\n${result.output}`;
    console.error(`${result.problem}\n${printed}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
