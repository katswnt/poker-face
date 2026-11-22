# Codex handoff — 2026-11-21

**The requested browser-solving/play plan and all three teaching follow-ups are shipped.**
Read the [H1 release handoff](codex-handoff-2026-11-21-h1.md) and
[contract/release record](hand-review-h1-spec.md) for full evidence and remaining limits.

W1–W4/P1–P5, R1, E1, D1 push/fold, D2 equity-versus-range and H1 completed-hand review
are complete. Production at <https://pokerface.katswint.com> runs `de7f0d6`, following
H1 code `6ca2f9a`; all eight code jobs passed in
[CI 44972899823](https://github.com/katswnt/poker-face/actions/runs/44972899823).
The clean release passed 1,133 unit tests, 23 Rust tests, tsc/lint, 18 audits and browser
checks. All 200 frozen hands / 1,031 review decisions are preserved. Deployed checks:
103 pass, two existing skips, zero retries. Public engine, AGPL source and drill hashes
match the tested build. The earlier WebKit screenshot failure was fixed without
weakening coverage or any mathematical gate; its package was not deployed.

Protected trainer/session work, README trainer hunks, the paused configurable-flop draft,
its plan and the existing data-publication note remain untouched. Keep using explicit
file lists and isolated exact-commit checks with copied dependencies. PF4 stays gated;
physical phones remain unmeasured and nonblocking. Further solver research starts with
the preflop validation contract, not promotion of the current unvalidated model.
