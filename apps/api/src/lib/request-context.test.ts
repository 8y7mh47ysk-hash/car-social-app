import { setImmediate as nextTurn, setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { getRequestContext, runWithRequestContext } from "./request-context.ts";

describe("request context", () => {
  it("is undefined outside a request", () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it("follows the code of a request through awaits, timers and callbacks", async () => {
    const seen = await runWithRequestContext({ requestId: "request-1" }, async () => {
      const afterAwait = await Promise.resolve().then(() => getRequestContext()?.requestId);
      await sleep(1);
      const afterTimer = getRequestContext()?.requestId;
      const inCallback = await new Promise<string | undefined>((resolve) => {
        setTimeout(() => {
          resolve(getRequestContext()?.requestId);
        }, 1);
      });
      return [afterAwait, afterTimer, inCallback];
    });

    expect(seen).toEqual(["request-1", "request-1", "request-1"]);
    expect(getRequestContext()).toBeUndefined();
  });

  it("keeps concurrent requests apart", async () => {
    const run = (requestId: string, delayMs: number) =>
      runWithRequestContext({ requestId }, async () => {
        await sleep(delayMs);
        await nextTurn();
        return getRequestContext()?.requestId;
      });

    // The first request finishes last, so the three interleave.
    const seen = await Promise.all([run("first", 15), run("second", 5), run("third", 10)]);

    expect(seen).toEqual(["first", "second", "third"]);
  });
});
