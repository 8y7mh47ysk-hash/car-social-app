import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  EnvValidationError,
  envHostSchema,
  envPortSchema,
  parseEnv,
  type EnvSource,
} from "./env.ts";

const options = { app: "the test app", hint: "Set them in test/.env." };

const schema = z.object({
  APP_NAME: z.string(),
  APP_PORT: envPortSchema.default(4000),
  APP_MODE: z.enum(["fast", "safe"], { error: "must be fast or safe" }).default("safe"),
});

/** Runs parseEnv and returns the EnvValidationError it throws; fails if it throws nothing. */
function parseError(source: EnvSource, testSchema: z.ZodObject = schema): EnvValidationError {
  try {
    parseEnv(testSchema, source, options);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected parseEnv to throw an EnvValidationError");
}

describe("parseEnv", () => {
  it("returns typed values and applies defaults for variables that are not set", () => {
    const env = parseEnv(schema, { APP_NAME: "garage" }, options);

    expect(env).toEqual({ APP_NAME: "garage", APP_PORT: 4000, APP_MODE: "safe" });
    expectTypeOf(env).toEqualTypeOf<{
      APP_NAME: string;
      APP_PORT: number;
      APP_MODE: "fast" | "safe";
    }>();
  });

  it("converts and returns values that are set", () => {
    expect(
      parseEnv(schema, { APP_NAME: "garage", APP_PORT: "4010", APP_MODE: "fast" }, options),
    ).toEqual({ APP_NAME: "garage", APP_PORT: 4010, APP_MODE: "fast" });
  });

  it("returns only the variables the schema declares", () => {
    const env = parseEnv(schema, { APP_NAME: "garage", HOME: "/home/owner", TOKEN: "x" }, options);

    expect(Object.keys(env).sort()).toEqual(["APP_MODE", "APP_NAME", "APP_PORT"]);
  });

  it("does not modify the source", () => {
    const source = Object.freeze({ APP_NAME: "garage", APP_PORT: "" });

    expect(parseEnv(schema, source, options).APP_PORT).toBe(4000);
    expect(source).toEqual({ APP_NAME: "garage", APP_PORT: "" });
  });

  it("treats an empty value as not set, so the default applies", () => {
    expect(parseEnv(schema, { APP_NAME: "garage", APP_PORT: "", APP_MODE: "" }, options)).toEqual({
      APP_NAME: "garage",
      APP_PORT: 4000,
      APP_MODE: "safe",
    });
  });

  it("names a required variable that is not set", () => {
    expect(parseError({}).issues).toEqual([
      { variable: "APP_NAME", problem: "is required but not set" },
    ]);
    expect(parseError({ APP_NAME: undefined }).issues).toEqual([
      { variable: "APP_NAME", problem: "is required but not set" },
    ]);
  });

  it("names a required variable that is set but empty", () => {
    expect(parseError({ APP_NAME: "" }).issues).toEqual([
      { variable: "APP_NAME", problem: "is required but empty" },
    ]);
  });

  it("reports a missing variable as missing, whatever kind of schema checks it", () => {
    const required = z.object({
      MODE: z.enum(["a", "b"]),
      HOST: envHostSchema,
      PORT: envPortSchema,
      COUNT: z.coerce.number(),
      URL: z.url(),
    });

    expect(parseError({ HOST: "" }, required).issues).toEqual([
      { variable: "MODE", problem: "is required but not set" },
      { variable: "HOST", problem: "is required but empty" },
      { variable: "PORT", problem: "is required but not set" },
      { variable: "COUNT", problem: "is required but not set" },
      { variable: "URL", problem: "is required but not set" },
    ]);
  });

  it("collects every problem in one error, in the order the schema declares them", () => {
    expect(parseError({ APP_MODE: "turbo", APP_PORT: "abc" }).issues).toEqual([
      { variable: "APP_NAME", problem: "is required but not set" },
      { variable: "APP_PORT", problem: "must be a whole number from 0 to 65535" },
      { variable: "APP_MODE", problem: "must be fast or safe" },
    ]);
  });

  it("explains what to fix and where in its message", () => {
    const error = parseError({ APP_PORT: "99999" });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EnvValidationError");
    expect(error.message).toBe(
      [
        "Invalid environment variables for the test app (values are not shown):",
        "  - APP_NAME: is required but not set",
        "  - APP_PORT: must be a whole number from 0 to 65535",
        "Set them in test/.env.",
      ].join("\n"),
    );
    expect(String(error.stack)).toMatch(/^EnvValidationError: Invalid environment variables/);
  });

  it("reports a rule about several variables under (environment)", () => {
    const pairSchema = z
      .object({ FIRST: z.string().optional(), SECOND: z.string().optional() })
      .refine((env) => (env.FIRST === undefined) === (env.SECOND === undefined), {
        message: "set FIRST and SECOND together, or neither",
      });

    expect(parseError({ FIRST: "a" }, pairSchema).issues).toEqual([
      { variable: "(environment)", problem: "set FIRST and SECOND together, or neither" },
    ]);
  });

  it("keeps the message of a rule that names one variable, even when it is not set", () => {
    const dependentSchema = z
      .object({ USER: z.string().optional(), PASSWORD: z.string().optional() })
      .refine((env) => env.USER === undefined || env.PASSWORD !== undefined, {
        message: "is required when USER is set",
        path: ["PASSWORD"],
      });

    expect(parseError({ USER: "owner" }, dependentSchema).issues).toEqual([
      { variable: "PASSWORD", problem: "is required when USER is set" },
    ]);
  });

  it("never includes a value in what it throws, even with Zod's own messages", () => {
    const secret = "s3cr3t-Value_42";
    const formats = z.object({
      PORT: envPortSchema,
      HOST: envHostSchema,
      URL: z.url(),
      EMAIL: z.email(),
      UUID: z.uuid(),
      SHORT: z.string().max(3),
      LONG: z.string().min(64),
      CHOICE: z.enum(["a", "b"]),
      EXACT: z.literal("exact"),
      FLAG: z.stringbool(),
      PATTERN: z.string().regex(/^[a-z]+$/),
      NUMBER: z.coerce.number().int(),
    });
    const source = Object.fromEntries(
      Object.keys(formats.shape).map((name) => [name, `${secret} !`]),
    );

    const error = parseError(source, formats);

    expect(error.issues.map((issue) => issue.variable)).toEqual(Object.keys(formats.shape));
    const everything = [
      error.message,
      String(error.stack),
      JSON.stringify(error),
      JSON.stringify(error.issues),
      String(error.cause),
    ].join("\n");
    expect(everything).not.toContain("s3cr3t");
  });

  // JSON.parse and BigInt quote their input in their errors, and Node.js prints all of an
  // uncaught error, so passing such an error on would print the value.
  it("names a variable whose check throws, without passing on its error or value", () => {
    const secret = "s3cr3t-Value_42";
    const throwing = z.object({
      SETTINGS: z.string().transform((text): unknown => JSON.parse(text)),
      LIMIT: z.string().refine((text) => BigInt(text) > 0n),
      NAME: z.string(),
      MODE: z.enum(["a", "b"], { error: "must be a or b" }),
    });

    const error = parseError({ SETTINGS: secret, LIMIT: secret, MODE: "c" }, throwing);

    const thrown = "its check threw an error, which is not shown because it may contain the value";
    expect(error.issues).toEqual([
      { variable: "SETTINGS", problem: thrown },
      { variable: "LIMIT", problem: thrown },
      // The other problems are still reported in the same run.
      { variable: "NAME", problem: "is required but not set" },
      { variable: "MODE", problem: "must be a or b" },
    ]);
    expect(error.cause).toBeUndefined();
    expect([error.message, String(error.stack), JSON.stringify(error)].join("\n")).not.toContain(
      "s3cr3t",
    );
  });

  it("reports a rule about several variables that throws under (environment)", () => {
    const ruleSchema = z
      .object({ LOW: z.string(), HIGH: z.string() })
      .refine((env) => BigInt(env.LOW) < BigInt(env.HIGH));

    const error = parseError({ LOW: "s3cr3t", HIGH: "10" }, ruleSchema);

    expect(error.issues).toEqual([
      {
        variable: "(environment)",
        problem:
          "a rule about several variables threw an error, which is not shown because it may contain a value",
      },
    ]);
    expect(JSON.stringify(error)).not.toContain("s3cr3t");
  });
});

describe("envPortSchema", () => {
  it.each([
    ["0", 0],
    ["80", 80],
    ["4000", 4000],
    ["04000", 4000],
    ["65535", 65_535],
  ])("accepts %j", (value, port) => {
    expect(envPortSchema.parse(value)).toBe(port);
  });

  it.each(["", "abc", "-1", "+80", "4000.5", "1e3", "0x10", " 4000", "4000 ", "65536", "123456"])(
    "rejects %j",
    (value) => {
      const result = envPortSchema.safeParse(value);

      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "must be a whole number from 0 to 65535",
      ]);
    },
  );
});

describe("envHostSchema", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "::",
    "::1",
    "fe80::1",
    "localhost",
    "api",
    "db.internal",
    "1password.example",
  ])("accepts %j", (value) => {
    expect(envHostSchema.parse(value)).toBe(value);
  });

  it.each([
    "",
    " ",
    " 127.0.0.1",
    "local host",
    "http://localhost",
    "localhost:4000",
    "[::1]",
    "127.0.0.1/24",
    "127.0.0.1.",
    "999.0.0.1",
    "1.2.3",
    "4000",
    "under_score",
    "-leading.example",
  ])("rejects %j", (value) => {
    const result = envHostSchema.safeParse(value);

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "must be an IP address such as 127.0.0.1, or a hostname such as localhost",
    ]);
  });
});
