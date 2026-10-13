import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/** The issues of the EnvValidationError that `read` throws; fails if it throws anything else. */
function issuesThrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    // vi.resetModules gives each test a fresh @apex/shared, whose EnvValidationError is another
    // class than one imported here, so the error is recognised by its name.
    if (error instanceof Error && error.name === "EnvValidationError" && "issues" in error) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("expected an EnvValidationError");
}

describe("server env module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("server-only");
    vi.doUnmock("./server-schema");
    vi.unstubAllEnvs();
  });

  // Next.js turns the same guard into a build error when a Client Component imports the module.
  it("refuses to load outside React Server Components", async () => {
    await expect(import("./server")).rejects.toThrow(
      "This module cannot be imported from a Client Component module",
    );
  });

  describe("getServerEnv", () => {
    beforeEach(() => {
      // What "server-only" resolves to in React Server Components, where the module runs.
      vi.doMock("server-only", () => ({}));
      // A stand-in for the app's server schema, which declares no variables yet.
      vi.doMock("./server-schema", () => ({
        serverEnvSchema: z.object({
          SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
        }),
      }));
    });

    // `next build` loads every route's modules while it collects page data.
    it("reads no variable when the module loads, so a build needs none of them", async () => {
      vi.stubEnv("SESSION_SECRET", undefined);

      await expect(import("./server")).resolves.toHaveProperty("getServerEnv");
    });

    it("names a missing or invalid variable when called, never its value", async () => {
      const { getServerEnv } = await import("./server");

      vi.stubEnv("SESSION_SECRET", undefined);
      expect(issuesThrownBy(getServerEnv)).toEqual([
        { variable: "SESSION_SECRET", problem: "is required but not set" },
      ]);
      vi.stubEnv("SESSION_SECRET", "s3cr3t");
      expect(issuesThrownBy(getServerEnv)).toEqual([
        { variable: "SESSION_SECRET", problem: "must be at least 32 characters" },
      ]);
    });

    it("returns the variables from the environment at the time of the call", async () => {
      const { getServerEnv } = await import("./server");

      vi.stubEnv("SESSION_SECRET", "a".repeat(32));
      expect(getServerEnv()).toEqual({ SESSION_SECRET: "a".repeat(32) });
    });
  });
});
