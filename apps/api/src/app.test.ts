import { healthResponseSchema } from "@apex/shared";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";

async function inject(options: InjectOptions): Promise<LightMyRequestResponse> {
  const app = await buildApp();
  try {
    return await app.inject(options);
  } finally {
    await app.close();
  }
}

describe("buildApp", () => {
  it("answers GET /health with the shared health contract", async () => {
    const response = await inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(healthResponseSchema.parse(response.json())).toEqual({ status: "ok" });
  });

  it("returns 404 for routes that do not exist", async () => {
    const response = await inject({ method: "GET", url: "/does-not-exist" });

    expect(response.statusCode).toBe(404);
  });

  it("does not answer other methods on /health", async () => {
    const response = await inject({ method: "POST", url: "/health", payload: {} });

    expect(response.statusCode).toBe(404);
  });
});
