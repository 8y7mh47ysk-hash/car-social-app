// @vitest-environment node
// Next.js compiles the global stylesheet through PostCSS with postcss.config.mjs, which runs
// Tailwind CSS, and vitest.config.ts has Vite do the same here. Tailwind CSS writes a rule for each
// class name that it finds in the sources that globals.css names: the web app's source files, not
// its tests. These tests check that every class of the root layout and the home page gets a rule,
// and that the sources are no wider. They import the stylesheet, the layout and the home page, so
// `vitest related`, in the pre-commit hook, runs them when any of these changes.
import "./globals.css";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import RootLayout from "./layout";
import HomePage from "./page";

/** The global stylesheet as Tailwind CSS compiles it. */
async function compiledStylesheet(): Promise<string> {
  // Vite's ?inline query returns the compiled CSS as text. The specifier is a variable, so that
  // TypeScript, which does not know the query, does not look it up.
  const inline = "./globals.css?inline";
  return z.object({ default: z.string() }).parse(await import(inline)).default;
}

/** The class names that a stylesheet's selectors name, with CSS escapes undone (`sm\:p-4`). */
function selectorClasses(css: string): Set<string> {
  const names = [...css.matchAll(/\.((?:\\[\da-f]{1,6} ?|\\[^\da-f\n]|[\w-])+)/gi)];
  return new Set(
    names.map(([, name = ""]) =>
      name.replace(
        /\\([\da-f]{1,6}) ?|\\(.)/gi,
        (_escape: string, hex: string | undefined, char: string | undefined) =>
          hex === undefined ? (char ?? "") : String.fromCodePoint(Number.parseInt(hex, 16)),
      ),
    ),
  );
}

/** The HTML entities that React writes in attribute values. */
const entities = new Map([
  ["&amp;", "&"],
  ["&quot;", '"'],
  ["&#x27;", "'"],
  ["&lt;", "<"],
  ["&gt;", ">"],
]);

/** The class names in the class attributes of markup that React rendered. */
function markupClasses(html: string): string[] {
  return [...html.matchAll(/ class="([^"]*)"/g)].flatMap(([, value = ""]) =>
    value
      .replace(/&(?:amp|quot|#x27|lt|gt);/g, (entity) => entities.get(entity) ?? entity)
      .split(/\s+/)
      .filter((name) => name !== ""),
  );
}

describe("the global stylesheet", () => {
  it("is built by Tailwind CSS", async () => {
    expect(await compiledStylesheet()).toMatch(/^\/\*! tailwindcss v4\./);
  });

  // A class that Tailwind CSS does not know, such as a misspelt utility or a colour that the theme
  // does not define, gets no rule, and its element is left unstyled. (So does a class that only
  // marks an element for variants, such as `group`: if a page uses one, leave it out here.)
  it("has a rule for every class that the root layout and the home page use", async () => {
    const page = renderToStaticMarkup(createElement(RootLayout, null, createElement(HomePage)));
    const used = markupClasses(page);
    const defined = selectorClasses(await compiledStylesheet());

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  // Without the sources that globals.css names, Tailwind CSS reads every file in the working folder:
  // apps/web when Next.js builds the app, but the whole repository when `pnpm test` runs, so a class
  // that only the docs named got a rule there. Two class names that it must not find:
  // `[--sentinel-test-file:1]`, named only in this test, and the one in postcss.config.mjs, which
  // is outside the web app's source folder.
  it("takes class names from the web app's source files only, not from its tests", async () => {
    const css = await compiledStylesheet();

    expect(css).not.toContain("--sentinel-test-file");
    expect(css).not.toContain("--sentinel-outside-src");
  });
});
