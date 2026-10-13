import { describe, expect, it } from "vitest";

import { publicEnvSchema } from "./public-schema";

describe("publicEnvSchema", () => {
  // The schema's type rejects other names only where it is written as an object literal; this
  // also covers a schema extended or merged later. Next.js copies only NEXT_PUBLIC_ variables into
  // browser code, and server rendering would read any other one from the server's environment.
  it("holds only NEXT_PUBLIC_ variables", () => {
    const otherNames = Object.keys(publicEnvSchema.shape).filter(
      (name) => !name.startsWith("NEXT_PUBLIC_"),
    );

    expect(otherNames).toEqual([]);
  });
});
