import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health.ts";

describe("healthResponseSchema", () => {
  it("accepts the healthy response", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  it.each([
    ["an unknown status", { status: "down" }],
    ["a missing status", {}],
    ["an unexpected extra field", { status: "ok", uptime: 12 }],
    ["a string body", "ok"],
    ["a null body", null],
  ])("rejects %s", (_label, body) => {
    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });

  it("reports which field was wrong", () => {
    const result = healthResponseSchema.safeParse({ status: "down" });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: "invalid_value", path: ["status"] }),
    ]);
  });
});
