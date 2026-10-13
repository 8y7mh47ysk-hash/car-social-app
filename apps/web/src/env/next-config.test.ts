// @vitest-environment node
// next.config.ts runs in Node.js, not in a browser, and resolves its own path from a file: URL.

import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";

import config from "../../next.config";
import type { validateWebEnv as realValidateWebEnv } from "./validate";

// A stand-in for the check, so these tests show how next.config.ts uses it; validate.test.ts
// tests the check itself.
const { validateWebEnv } = vi.hoisted(() => ({
  validateWebEnv: vi.fn<typeof realValidateWebEnv>(),
}));
vi.mock("./validate", () => ({ validateWebEnv }));

// This is how `next dev`, `next build` and `next start` come to stop when a variable is missing
// or invalid: Next.js calls the config function with the phase and fails if it throws.
describe("the environment check in next.config.ts", () => {
  afterEach(() => {
    validateWebEnv.mockReset();
    vi.unstubAllEnvs();
  });

  it("checks the live environment for the phase Next.js passes", () => {
    vi.stubEnv("APEX_NEXT_CONFIG_TEST", "from the environment");

    config(PHASE_PRODUCTION_BUILD);

    expect(validateWebEnv).toHaveBeenCalledOnce();
    const [phase, source] = validateWebEnv.mock.calls[0] ?? [];
    expect(phase).toBe(PHASE_PRODUCTION_BUILD);
    expect(source).toHaveProperty("APEX_NEXT_CONFIG_TEST", "from the environment");
  });

  it("passes the check's error on to Next.js", () => {
    validateWebEnv.mockImplementation(() => {
      throw new Error("SESSION_SECRET: is required but not set");
    });

    expect(() => config(PHASE_DEVELOPMENT_SERVER)).toThrow(
      "SESSION_SECRET: is required but not set",
    );
  });
});
