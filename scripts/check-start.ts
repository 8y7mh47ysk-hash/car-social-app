// The CI step "Start the production build" (instruction 5). The build alone does not show that the
// apps start: `next start` checks the web server's environment variables only as it starts, and the
// API's production start runs compiled code with flags of its own. This starts both production
// builds with `pnpm start`, as a developer would, on free ports of 127.0.0.1; waits until the API
// answers GET /health and the web app serves its home page; then stops them with SIGTERM.
//
// Usage, from the repository root, after `pnpm build`: node scripts/check-start.ts
// Exit status: 0 when both apps answered and then stopped, 1 otherwise. On failure it says what
// went wrong and prints everything the apps printed.

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
}

export interface StartCheckResult {
  /** The ports the apps were given, as WEB_PORT and API_PORT. */
  readonly ports: { readonly web: number; readonly api: number };
  /** What went wrong; undefined when both apps answered and then stopped. */
  readonly problem: string | undefined;
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
 * of what came back (an unexpected answer, or no answer).
 */
async function probe(
  url: string,
  accept: (response: Response) => Promise<boolean>,
): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: { connection: "close" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

/** A duration in whole seconds, for messages. */
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
  const ports = await freePorts();

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
    child.once("close", (code, signal) => {
      exit ??= signal === null ? `exited with code ${String(code)}` : `was stopped by ${signal}`;
      resolve();
    });
  });

  const api = { name: "the API", url: `http://${HOST}:${String(ports.api)}/health` };
  const web = { name: "the web app", url: `http://${HOST}:${String(ports.web)}/` };
  let apiState = await probe(api.url, isHealthy);
  let webState = await probe(web.url, isPage);
  const problems: string[] = [];
  const deadline = Date.now() + timeoutMs;
  while (apiState !== undefined || webState !== undefined) {
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
    apiState = apiState === undefined ? undefined : await probe(api.url, isHealthy);
    webState = webState === undefined ? undefined : await probe(web.url, isPage);
  }

  // The apps run in the group that `detached` gave the command, so this reaches every process.
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) {
        process.kill(-child.pid, signal);
      }
    } catch {
      // Every process of the group has ended (ESRCH; macOS answers EPERM while the ended
      // processes are not yet reaped). The waits below show whether the apps really stopped.
    }
  };
  /** Whether the output closed within `ms`; an unreferenced timer, so it never keeps Node alive. */
  const closedWithin = async (ms: number): Promise<boolean> =>
    Promise.race([closed.then(() => true), sleep(ms, false, { ref: false })]);

  if (exit === undefined) {
    signalGroup("SIGTERM");
    if (!(await closedWithin(stopTimeoutMs))) {
      signalGroup("SIGKILL");
      if (await closedWithin(stopTimeoutMs)) {
        problems.push(`The apps did not stop within ${seconds(stopTimeoutMs)} s of SIGTERM.`);
      } else {
        // SIGKILL ends every process of the group, so a process outside it holds the output.
        child.stdout.destroy();
        child.stderr.destroy();
        problems.push(
          `The apps' output was still open ${seconds(stopTimeoutMs)} s after SIGKILL: a process ` +
            "outside the command's process group holds it, and may still be running.",
        );
      }
    }
  }
  // Processes of the group that outlived the command itself, if any.
  signalGroup("SIGKILL");

  return { ports, problem: problems.length === 0 ? undefined : problems.join(" "), output };
}

if (import.meta.main) {
  const result = await checkStart();
  if (result.problem === undefined) {
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
