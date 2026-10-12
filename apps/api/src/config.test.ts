import { EnvValidationError } from "@apex/shared";
import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.ts";

/** Runs loadConfig and returns the EnvValidationError it throws; fails if it throws nothing. */
function configError(env: Readonly<Record<string, string>>): EnvValidationError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected loadConfig to throw an EnvValidationError");
}

describe("loadConfig", () => {
  it("listens on loopback port 4000 and logs JSON at info level by default", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4000,
      logLevel: "info",
      logFormat: "json",
    });
  });

  it("treats empty values as not set", () => {
    expect(loadConfig({ API_HOST: "", API_PORT: "", LOG_LEVEL: "", LOG_FORMAT: "" })).toEqual({
      host: "127.0.0.1",
      port: 4000,
      logLevel: "info",
      logFormat: "json",
    });
  });

  it("reads API_HOST, API_PORT, LOG_LEVEL and LOG_FORMAT", () => {
    expect(
      loadConfig({
        API_HOST: "0.0.0.0",
        API_PORT: "4010",
        LOG_LEVEL: "debug",
        LOG_FORMAT: "pretty",
      }),
    ).toEqual({ host: "0.0.0.0", port: 4010, logLevel: "debug", logFormat: "pretty" });
  });

  it("accepts port 0 so the OS can pick a free port", () => {
    expect(loadConfig({ API_PORT: "0" }).port).toBe(0);
  });

  it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const)(
    "accepts LOG_LEVEL=%s",
    (level) => {
      expect(loadConfig({ LOG_LEVEL: level }).logLevel).toBe(level);
    },
  );

  it.each(["abc", "-1", "4000.5", "1e3", "65536", "123456"])("rejects API_PORT=%j", (value) => {
    expect(configError({ API_PORT: value }).issues).toEqual([
      { variable: "API_PORT", problem: "must be a whole number from 0 to 65535" },
    ]);
  });

  it.each(["   ", "http://localhost", "localhost:4000", "999.0.0.1"])(
    "rejects API_HOST=%j",
    (value) => {
      expect(configError({ API_HOST: value }).issues).toEqual([
        {
          variable: "API_HOST",
          problem: "must be an IP address such as 127.0.0.1, or a hostname such as localhost",
        },
      ]);
    },
  );

  it.each(["INFO", "verbose", "0"])("rejects LOG_LEVEL=%j", (value) => {
    expect(configError({ LOG_LEVEL: value }).issues).toEqual([
      {
        variable: "LOG_LEVEL",
        problem: "must be one of fatal, error, warn, info, debug, trace, silent",
      },
    ]);
  });

  it("reports every invalid variable at once, without their values", () => {
    const error = configError({
      API_HOST: "host-value!",
      API_PORT: "port-value",
      LOG_LEVEL: "level-value",
    });

    expect(error.message).toBe(
      [
        "Invalid environment variables for the API (values are not shown):",
        "  - API_HOST: must be an IP address such as 127.0.0.1, or a hostname such as localhost",
        "  - API_PORT: must be a whole number from 0 to 65535",
        "  - LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent",
        "Set them in apps/api/.env (see apps/api/.env.example) or in the environment.",
      ].join("\n"),
    );
    expect(JSON.stringify(error.issues)).not.toContain("-value");
  });

  it("ignores variables it does not use", () => {
    expect(loadConfig({ HOST: "bad host", PORT: "bad", NODE_ENV: "production" })).toEqual(
      loadConfig({}),
    );
  });

  it.each(["PRETTY", "text", "pino-pretty"])("rejects LOG_FORMAT=%j", (value) => {
    expect(configError({ LOG_FORMAT: value }).issues).toEqual([
      { variable: "LOG_FORMAT", problem: "must be one of json, pretty" },
    ]);
  });
});
