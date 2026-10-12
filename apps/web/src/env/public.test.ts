import { describe, expect, it } from "vitest";

import { publicEnv } from "./public";

describe("publicEnv", () => {
  // These tests run in jsdom, so loading the module at all shows it is safe in browser code.
  it("loads in browser code and holds the public variables, of which there are none yet", () => {
    expect(publicEnv).toEqual({});
  });
});
