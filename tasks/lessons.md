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
