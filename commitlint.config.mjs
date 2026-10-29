// Commit message rules, checked by the commit-msg hook (.husky/commit-msg) and explained in the
// README section "Commit messages". Severity 2 is an error, which rejects the commit.

/**
 * How the messages that git and GitHub write themselves begin: merges (`git merge`, `git pull` and
 * GitHub's merge button), `git revert` (and "Reapply" for a revert that is reverted) and
 * `git commit --fixup` and `--squash`. Such a message skips every check. Each pattern matches only
 * at the start of the message. They replace commitlint's own list, which also skipped a message
 * with a line such as "Merge the old parser into the new one" anywhere in it, and hand-written
 * subjects such as "revert the logger change" or a version number on its own.
 */
const writtenByGit = [
  /^Merge (?:branch|branches|remote-tracking branch|tag|commit|pull request) /,
  /^(?:Revert|Reapply) "/,
  /^(?:amend|fixup|squash)! /,
];

export default {
  // Conventional Commits, "type(scope): subject": a known lowercase type, a subject that does not
  // end with a full stop, a first line of at most 100 characters, and body and footer lines of at
  // most 100 characters (a line that holds a URL may be longer).
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  ignores: [(message) => writtenByGit.some((start) => start.test(message))],
  rules: {
    // Team rules: the scope and the subject (the text after "type(scope): ") are lowercase, and
    // the subject has at most 72 characters. Text in backticks or quotes is exempt from the case
    // rule, so names keep their case: "fix(api): validate `API_PORT`".
    "scope-case": [2, "always", "lower-case"],
    "subject-case": [2, "always", "lower-case"],
    "subject-max-length": [2, "always", 72],
    // Warnings in config-conventional; errors here. Git reads the first paragraph of a message
    // as its subject and trailers such as Co-Authored-By only from a paragraph of their own, so
    // the body and the footer must each start after a blank line.
    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"],
  },
  helpUrl: "README.md, section 'Commit messages'",
};
