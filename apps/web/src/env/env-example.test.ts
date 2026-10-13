// @vitest-environment node
// The test reads the template through its file: URL, which only Node.js's environment provides.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { publicEnvSchema } from "./public-schema";
import { serverEnvSchema } from "./server-schema";

describe("apps/web/.env.example", () => {
  it("documents every variable the web app reads, and no other", () => {
    const text = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    // NAME=value lines, set or commented out ("# NAME=value"); prose lines do not match.
    const documented = [...text.matchAll(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map(
      ([, name = ""]) => name,
    );

    expect(documented.sort()).toEqual(
      [...Object.keys(serverEnvSchema.shape), ...Object.keys(publicEnvSchema.shape)].sort(),
    );
  });
});
