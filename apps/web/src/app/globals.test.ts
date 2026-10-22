// @vitest-environment node
// The stylesheet is compiled in Node.js, as Next.js compiles it: through PostCSS with
// postcss.config.mjs, which runs Tailwind CSS (vitest.config.ts turns that on for this stylesheet).
// Importing it here also lets `vitest related`, in the pre-commit hook, find this test when it
// changes. Tailwind CSS generates the utilities that it finds in the layout and the home page, which
// this test checks, so importing those too makes the hook run this test when either changes.
import "./globals.css";
import "./layout";
import "./page";

import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("the global stylesheet", () => {
  it("is built by Tailwind CSS, with the utilities that the layout and the home page use", async () => {
    // Vite's ?inline query returns the compiled CSS as text. The specifier is a variable, so that
    // TypeScript, which does not know the query, does not look it up.
    const inline = "./globals.css?inline";
    const { default: css } = z.object({ default: z.string() }).parse(await import(inline));

    expect(css).toMatch(/^\/\*! tailwindcss v4\./);
    // A plain utility, a responsive one and a dark-mode one, as they appear in CSS.
    const utilities = [".antialiased", ".mx-auto", ".sm\\:grid-cols-2", ".dark\\:bg-neutral-950"];
    for (const utility of utilities) {
      expect(css, utility).toContain(utility);
    }
  });
});
