import { APP_NAME } from "@apex/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RootLayout, { metadata } from "./layout";

/** Whether the layout loaded the global stylesheet, which globals.test.ts checks. */
const stylesheet = vi.hoisted(() => ({ loaded: false }));
vi.mock("./globals.css", () => {
  stylesheet.loaded = true;
  return {};
});

describe("RootLayout", () => {
  // WCAG 2.2 success criterion 3.1.1, Language of Page: screen readers and browsers choose their
  // voice, pronunciation and hyphenation from it.
  it("declares the language of every page as British English", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page content</p>
      </RootLayout>,
    );
    const page = new DOMParser().parseFromString(html, "text/html");

    expect(page.documentElement.lang).toBe("en-GB");
    expect(page.body.textContent).toBe("Page content");
  });

  it("titles every page with the product's name", () => {
    expect(metadata.title).toBe(APP_NAME);
  });

  // It brings in Tailwind CSS; without it, every page is unstyled.
  it("loads the global stylesheet for every page", () => {
    expect(stylesheet.loaded).toBe(true);
  });
});
