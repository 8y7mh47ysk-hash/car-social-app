import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The README's command blocks get pasted into terminals, and on macOS the terminal's shell is zsh.
// At its prompt zsh does not read `#` as the start of a comment unless its interactivecomments
// option is on, which it is not by default: `pnpm install   # also installs the git hooks (see ...)`
// stops with "zsh: number expected", `pnpm lint   # prints ...` lints files named "#" and "prints",
// and an apostrophe in a comment opens a quote that swallows the lines after it. So the README's
// blocks hold commands only, with explanations in the text around them. git-hooks.test.ts also
// pastes the steps of the section "Git hooks" into zsh, on machines that have it.

const readme = await readFile(join(import.meta.dirname, "README.md"), "utf8");

/** The README's shell code blocks. */
const shellBlocks = [
  ...readme.matchAll(/^```(?:sh|bash|shell|zsh|console)\n([\s\S]*?)^```$/gm),
].map(([, block = ""]) => block);

describe("the README's command blocks", () => {
  it("exist", () => {
    expect(shellBlocks.length).toBeGreaterThan(5);
  });

  it("hold no # comments, which zsh would pass to the commands", () => {
    const commented = shellBlocks
      .flatMap((block) => block.split("\n"))
      .filter((line) => /(?:^|\s)#/.test(line));

    expect(commented).toEqual([]);
  });
});
