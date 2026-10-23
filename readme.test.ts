import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

// The README's command blocks get pasted into terminals, and on macOS the terminal's shell is zsh.
// At its prompt zsh does not read `#` as the start of a comment unless its interactivecomments
// option is on, which it is not by default: `pnpm install   # also installs the git hooks (see ...)`
// stops with "zsh: number expected", `pnpm lint   # prints ...` lints files named "#" and "prints",
// and an apostrophe in a comment opens a quote that swallows the lines after it. So the README's
// blocks hold commands only, with explanations in the text around them. git-hooks.test.ts also
// pastes the steps of the section "Git hooks" into zsh, on machines that have it.

const repoRoot = import.meta.dirname;
const run = promisify(execFile);
const readme = await readFile(join(repoRoot, "README.md"), "utf8");

/** The shell code blocks of a Markdown document. */
function shellBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```(?:sh|bash|shell|zsh|console)\n([\s\S]*?)^```$/gm)].map(
    ([, block = ""]) => block,
  );
}

/** The lines of a Markdown document's shell code blocks that hold a `#` comment. */
function commentedLines(markdown: string): string[] {
  return shellBlocks(markdown)
    .flatMap((block) => block.split("\n"))
    .filter((line) => /(?:^|\s)#/.test(line));
}

/** The README's section "Prerequisites", up to the next section. */
const prerequisites = /^## Prerequisites\n([\s\S]*?)^## /m.exec(readme)?.[1] ?? "";

describe("the README's command blocks", () => {
  it("exist", () => {
    expect(shellBlocks(readme).length).toBeGreaterThan(5);
  });

  it("hold no # comments, which zsh would pass to the commands", () => {
    expect(commentedLines(readme)).toEqual([]);
  });

  // Other documents keep their comments, which say what each command should print, so the
  // README's prerequisites must tell zsh users to turn on interactivecomments before they paste
  // from any of them: the folder docs/ as a whole, every other such document by name.
  it("warn zsh users about every other document whose command blocks hold # comments", async () => {
    const { stdout } = await run("git", ["ls-files", "-z", "*.md"], { cwd: repoRoot });
    const documents = stdout.split("\0").filter((file) => file !== "" && file !== "README.md");
    const commented: string[] = [];
    for (const document of documents) {
      if (commentedLines(await readFile(join(repoRoot, document), "utf8")).length > 0) {
        commented.push(document);
      }
    }

    expect(prerequisites).toContain("setopt interactivecomments");
    expect(prerequisites).toContain("`docs/`");
    expect(commented).toContain("docs/BUILD_LOG.md");
    expect(
      commented.filter(
        (document) => !document.startsWith("docs/") && !prerequisites.includes(document),
      ),
    ).toEqual([]);
  });
});
