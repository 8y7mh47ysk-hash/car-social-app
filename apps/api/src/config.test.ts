import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./config.ts";

describe("loadServerConfig", () => {
  it("listens on loopback port 4000 by default", () => {
    expect(loadServerConfig({})).toEqual({ host: "127.0.0.1", port: 4000 });
  });

  it("reads API_HOST and API_PORT", () => {
    expect(loadServerConfig({ API_HOST: "0.0.0.0", API_PORT: "4010" })).toEqual({
      host: "0.0.0.0",
      port: 4010,
    });
  });

  it("accepts port 0 so the OS can pick a free port", () => {
    expect(loadServerConfig({ API_PORT: "0" }).port).toBe(0);
  });

  it.each(["", "abc", "-1", "4000.5", "1e3", "65536", "123456"])("rejects API_PORT=%j", (value) => {
    expect(() => loadServerConfig({ API_PORT: value })).toThrow(/API_PORT/);
  });

  it("rejects a blank API_HOST", () => {
    expect(() => loadServerConfig({ API_HOST: "   " })).toThrow(/API_HOST/);
  });
});
