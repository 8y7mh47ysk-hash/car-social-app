import { EnvValidationError, type EnvIssue, type EnvSource } from "@apex/shared";
import {
  PHASE_ANALYZE,
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_INFO,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_TEST,
} from "next/constants";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validateWebEnv, type WebEnvSchemas } from "./validate";

// The app's own schemas stay empty until the web app reads its first variable, so these tests
// give validateWebEnv one stand-in variable in each group.
const schemas = {
  server: z.object({ SESSION_SECRET: z.string().min(32, "must be at least 32 characters") }),
  public: z.object({ NEXT_PUBLIC_API_URL: z.url({ error: "must be a URL" }) }),
};

const validSource = {
  SESSION_SECRET: "a".repeat(32),
  NEXT_PUBLIC_API_URL: "https://api.example.com",
};

const ALL_PHASES = [
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_EXPORT,
  PHASE_INFO,
  PHASE_TEST,
  PHASE_ANALYZE,
];

/** Runs validateWebEnv and returns the EnvValidationError it throws, if any. */
function validationError(
  phase: string,
  source: EnvSource,
  testSchemas: WebEnvSchemas = schemas,
): EnvValidationError | undefined {
  try {
    validateWebEnv(phase, source, testSchemas);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

/** The problems validateWebEnv reports in a phase, or none if it accepts the environment. */
function problems(
  phase: string,
  source: EnvSource,
  testSchemas: WebEnvSchemas = schemas,
): readonly EnvIssue[] {
  return validationError(phase, source, testSchemas)?.issues ?? [];
}

describe("validateWebEnv", () => {
  it("checks both groups when the dev server starts, and reports every problem at once", () => {
    expect(problems(PHASE_DEVELOPMENT_SERVER, {})).toEqual([
      { variable: "NEXT_PUBLIC_API_URL", problem: "is required but not set" },
      { variable: "SESSION_SECRET", problem: "is required but not set" },
    ]);
  });

  it("checks only the public group in a production build, which copies it into the bundles", () => {
    expect(problems(PHASE_PRODUCTION_BUILD, {})).toEqual([
      { variable: "NEXT_PUBLIC_API_URL", problem: "is required but not set" },
    ]);
  });

  it("checks only the server group when the production server starts", () => {
    expect(problems(PHASE_PRODUCTION_SERVER, {})).toEqual([
      { variable: "SESSION_SECRET", problem: "is required but not set" },
    ]);
  });

  it.each([PHASE_EXPORT, PHASE_INFO, PHASE_TEST, PHASE_ANALYZE])(
    "checks nothing in %s",
    (phase) => {
      expect(problems(phase, {})).toEqual([]);
    },
  );

  it.each(ALL_PHASES)("accepts valid values in %s", (phase) => {
    expect(problems(phase, validSource)).toEqual([]);
  });

  it("names the web app and where to fix it, and never shows a value", () => {
    const error = validationError(PHASE_DEVELOPMENT_SERVER, {
      SESSION_SECRET: "s3cr3t",
      NEXT_PUBLIC_API_URL: "s3cr3t-url",
    });

    expect(error?.message).toBe(
      [
        "Invalid environment variables for the web app (values are not shown):",
        "  - NEXT_PUBLIC_API_URL: must be a URL",
        "  - SESSION_SECRET: must be at least 32 characters",
        "Set them in apps/web/.env (see apps/web/.env.example) or in the environment.",
      ].join("\n"),
    );
    expect(JSON.stringify(error?.issues)).not.toContain("s3cr3t");
  });

  // getServerEnv and publicEnv check such rules, so a check without them would let `next start`
  // start, and the first request that reads the variables fail.
  it("checks a rule about several variables in a group", () => {
    const withRule = {
      public: z.object({}),
      server: z
        .object({ SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional() })
        .refine((env) => env.SMTP_USER === undefined || env.SMTP_PASSWORD !== undefined, {
          message: "is required when SMTP_USER is set",
          path: ["SMTP_PASSWORD"],
        }),
    };

    expect(problems(PHASE_PRODUCTION_SERVER, { SMTP_USER: "owner" }, withRule)).toEqual([
      { variable: "SMTP_PASSWORD", problem: "is required when SMTP_USER is set" },
    ]);
    expect(
      problems(PHASE_PRODUCTION_SERVER, { SMTP_USER: "owner", SMTP_PASSWORD: "x" }, withRule),
    ).toEqual([]);
  });

  it.each(ALL_PHASES)(
    "accepts the app's own schemas in %s, which need no variables yet",
    (phase) => {
      expect(() => {
        validateWebEnv(phase, {});
      }).not.toThrow();
    },
  );
});
