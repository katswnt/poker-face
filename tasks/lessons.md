# Lessons

## 2026-09-25 — Never open a file for writing in the same expression that reads it

`open(p, "w").write(f(open(p).read()))` truncates `p` before the read runs: Python evaluates
`open(p, "w")` first, so the read sees an empty file. This emptied README.md and destroyed
another agent's uncommitted edits; the "failed text match" that followed was the symptom.

Rules:
- Read into a variable, compute, then write: `s = open(p).read(); s = f(s); open(p, "w").write(s)`.
- When an assertion about file content fails unexpectedly, first check the file's size and
  `git diff --stat` before debugging the pattern.
- Before scripted edits to a file with someone else's uncommitted changes, copy it to the
  scratchpad first so it can be restored.

## 2026-09-25 — Test the exact commit in isolation before pushing when others have WIP

Pushed heads-up play P0 (67f3102) after running its tests in the working tree, where they
passed only because another agent's uncommitted fixtures.ts exports were present. main did
not type-check; reverted in 9ef2704.

Rules:
- Before pushing a partial commit from a shared working tree, export the commit
  (`git archive HEAD | tar -x -C <scratch>`, symlink node_modules) and run its tests and
  `tsc` there. Never rely on working-tree test results for a partial commit.
- Before committing agent output, check `git status` for uncommitted changes in files it
  imports; if any exist, land them together or wait.
