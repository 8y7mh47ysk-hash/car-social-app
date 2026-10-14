// The CI step "Start the production build" (instruction 5). The build alone does not show that the
// apps start: `next start` checks the web server's environment variables only as it starts, and the
// API's production start runs compiled code with flags of its own. This starts both production
// builds with `pnpm start`, as a developer would, on free loopback ports; waits until the API
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

/** How long both apps may take to answer, from the moment the command starts. */
const START_TIMEOUT_MS = 60_000;

/** How long the apps may take to stop after SIGTERM before they are killed. */
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
  /** How long the apps may take to stop after SIGTERM; ten seconds by default. */
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
    server.listen(0, "127.0.0.1");
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

/**
 * Starts the apps with `options.command` (by default `pnpm start`), with WEB_PORT and API_PORT
 * set to free ports, in a process group of its own. Waits until the API answers GET /health and
 * the web app its home page, then stops the group with SIGTERM, and kills it if it has not stopped
 * in time.
 */
export async function checkStart(options: StartCheckOptions = {}): Promise<StartCheckResult> {
  const [command, ...args] = options.command ?? ["pnpm", "start"];
  const timeoutMs = options.timeoutMs ?? START_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const ports = await freePorts();

  const child = spawn(command, args, {
    detached: true,
    env: { ...process.env, WEB_PORT: String(ports.web), API_PORT: String(ports.api) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk: string): void => {
    output += chunk;
  };
  child.stdout.setEncoding("utf8").on("data", collect);
  child.stderr.setEncoding("utf8").on("data", collect);
  let exit: string | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      exit = `could not be started (${error.message})`;
      resolve();
    });
    child.once("close", (code, signal) => {
      exit = signal === null ? `exited with code ${String(code)}` : `was stopped by ${signal}`;
      resolve();
    });
  });

  const api = { name: "the API", url: `http://127.0.0.1:${String(ports.api)}/health` };
  const web = { name: "the web app", url: `http://127.0.0.1:${String(ports.web)}/` };
  let apiState = await probe(api.url, isHealthy);
  let webState = await probe(web.url, isPage);
  let problem: string | undefined;
  const deadline = Date.now() + timeoutMs;
  while (apiState !== undefined || webState !== undefined) {
    if (exit !== undefined) {
      problem = `\`${[command, ...args].join(" ")}\` ${exit} before both apps answered.`;
      break;
    }
    if (Date.now() >= deadline) {
      const waiting = [
        ...(apiState === undefined ? [] : [`${api.name} (GET ${api.url}) ${apiState}`]),
        ...(webState === undefined ? [] : [`${web.name} (GET ${web.url}) ${webState}`]),
      ];
      problem = `After ${String(timeoutMs / 1000)} s, ${waiting.join(", and ")}.`;
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
      // The group has already exited.
    }
  };
  if (exit === undefined) {
    signalGroup("SIGTERM");
    // An unreferenced timer, so that it does not keep this process alive once the apps stopped.
    const stopped = await Promise.race([
      exited.then(() => true),
      sleep(stopTimeoutMs, false, { ref: false }),
    ]);
    if (!stopped) {
      signalGroup("SIGKILL");
      await exited;
      problem ??= `The apps did not stop within ${String(stopTimeoutMs / 1000)} s of SIGTERM.`;
    }
  }
  // Processes that outlived the command itself, if any.
  signalGroup("SIGKILL");

  return { ports, problem, output };
}

if (import.meta.main) {
  const result = await checkStart();
  if (result.problem === undefined) {
    console.log(
      `Both apps started: the API answered GET /health on port ${String(result.ports.api)}, ` +
        `the web app its home page on port ${String(result.ports.web)}, and both stopped.`,
    );
  } else {
    console.error(`${result.problem}\nWhat the apps printed:\n${result.output}`);
    process.exitCode = 1;
  }
}
