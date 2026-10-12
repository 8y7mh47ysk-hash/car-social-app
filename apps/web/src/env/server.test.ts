import { describe, expect, it } from "vitest";

describe("serverEnv", () => {
  // Next.js turns the same guard into a build error when a Client Component imports the module.
  it("refuses to load outside React Server Components", async () => {
    await expect(import("./server")).rejects.toThrow(
      "This module cannot be imported from a Client Component module",
    );
  });
});
