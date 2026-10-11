import { APP_NAME } from "@apex/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("names the product in the main landmark's only level-one heading", () => {
    render(<HomePage />);

    // getByRole fails if there is no level-one heading or more than one.
    const heading = within(screen.getByRole("main")).getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName(APP_NAME);
  });

  it("lists the planned features in a labelled region", () => {
    render(<HomePage />);

    const region = screen.getByRole("region", { name: "Coming soon" });
    const features = within(region)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(features).toEqual(["Garage", "Build Log", "Maintenance", "Parts Locker", "Crew Chief"]);
    expect(within(region).getAllByRole("listitem")).toHaveLength(features.length);
  });
});
