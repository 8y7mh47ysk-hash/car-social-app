import { describe, expect, it, vi } from "vitest";

// Browser code loads ./public.ts, so a module it loads, directly or through others, is sent to
// every visitor. If that included the server schema (./server-schema.ts, also loaded by
// ./validate.ts), its variables' names, rules and defaults would be too: this mock makes such an
// import fail.
vi.mock("./server-schema", () => {
  throw new Error("browser code must not load the server env schema");
});

describe("publicEnv", () => {
  // These tests run in jsdom, so loading the module at all shows it is safe in browser code.
  it("loads in browser code without the server schema, and holds the public variables", async () => {
    const { publicEnv } = await import("./public");

    // There are none yet.
    expect(publicEnv).toEqual({});
  });
});
