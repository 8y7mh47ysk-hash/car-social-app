import { describe, expect, it } from "vitest";

import { serverEnvSchema } from "./server-schema";

describe("serverEnvSchema", () => {
  it("leaves NEXT_PUBLIC_ variables, which are public by definition, to publicEnvSchema", () => {
    const publicNames = Object.keys(serverEnvSchema.shape).filter((name) =>
      name.startsWith("NEXT_PUBLIC_"),
    );

    expect(publicNames).toEqual([]);
  });
});
