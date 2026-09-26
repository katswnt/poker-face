"use client";

// Heads-up preflop push/fold model — interactive demo backed by precomputed solutions.
import { useState } from "react";
import Link from "next/link";
import { HANDS, GRID_RANK_VALUES } from "@/lib/solver/hands";
import { getPushFoldSolution, SOLUTION_META } from "@/lib/solver/solutions";

// Theme lifted from the main app (terminal / JetBrains Mono).
const T = {
  bg: "#0d1014",
  panel: "#161a1f",
  panelAlt: "#1c2128",
  ink: "#d4d4cf",
  inkSoft: "#a8a8a0",
  dim: "#6a6a60",
  hair: "#2a2e34",
  shove: "#7dd3a0", // green — SB open-shove
  call: "#6db4f0",  // blue — BB call
  warn: "#f0c060",
  mono: "var(--font-jetbrains), 'JetBrains Mono', monospace",
};

type View = "sb" | "bb";

// Blend a hex base color toward the panel background by frequency (0 → background, 1 → full).
function cellColor(freq: number, base: string): string {
  if (freq <= 0) return T.panelAlt;
  const b = parseInt(base.slice(1, 3), 16), g = parseInt(base.slice(3, 5), 16), r = parseInt(base.slice(5, 7), 16);
  const bg = { b: 0x1c, g: 0x21, r: 0x28 };
  const t = 0.15 + 0.85 * freq; // keep even faint mixes visible
  const mix = (c: number, d: number) => Math.round(d + (c - d) * t);
  return `rgb(${mix(b, bg.b)}, ${mix(g, bg.g)}, ${mix(r, bg.r)})`;
}

export default function SolverPage() {
  const [stack, setStack] = useState(10);
  const [view, setView] = useState<View>("sb");

  const sol = getPushFoldSolution(stack);
  const freqs = view === "sb" ? sol.sbShove : sol.bbCall;
  const base = view === "sb" ? T.shove : T.call;

  return (
    <main style={{ minHeight: "100dvh", background: T.bg, color: T.ink, fontFamily: T.mono, padding: "clamp(16px, 4vw, 40px)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ borderBottom: `1px solid ${T.hair}`, paddingBottom: 16, marginBottom: 20 }}>
          <nav aria-label="Solver navigation" style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 12 }}>
            <Link href="/" aria-label="Back to the Hold'em Trainer"
              style={{ fontSize: 11, letterSpacing: 1, color: T.shove, textDecoration: "none" }}>
              <span aria-hidden="true">←</span> back to trainer
            </Link>
            <Link href="/solver/lab"
              style={{ fontSize: 11, letterSpacing: 1, color: T.shove, textDecoration: "none" }}>
              explainable solver lab <span aria-hidden="true">→</span>
            </Link>
            <Link href="/drills"
              style={{ fontSize: 11, letterSpacing: 1, color: T.shove, textDecoration: "none" }}>
              math drills <span aria-hidden="true">→</span>
            </Link>
          </nav>
          <div style={{ fontSize: 12, color: T.dim, textTransform: "uppercase" }}>Heads-Up · Push / Fold</div>
          <h1 style={{ fontSize: "clamp(20px, 4vw, 28px)", fontWeight: 700, margin: "6px 0 10px", color: T.ink }}>
            Push/Fold Strategy Explorer
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: T.inkSoft, margin: 0 }}>
            This tool searches for stable play in a small poker game: the small blind may shove or fold,
            and the big blind may call or fold. Hand matchups are exact and account for the cards each player
            holds, but the game itself is simplified (no limps or smaller raises), so treat it as a clear
            model—not an exact answer for every real game.
          </p>
        </header>

        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-end", marginBottom: 20 }}>
          <label style={{ flex: "1 1 260px" }}>
            <div style={{ fontSize: 12, color: T.dim, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span>EFFECTIVE STACK</span>
              <span style={{ color: T.warn }}>{stack.toFixed(1)} bb</span>
            </div>
            <input
              type="range" min={2} max={20} step={0.5} value={stack}
              onChange={e => setStack(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: base, cursor: "pointer" }}
              aria-label="Effective stack in big blinds"
            />
          </label>

          <div role="group" aria-label="Range to show" style={{ display: "flex", border: `1px solid ${T.hair}` }}>
            {([["sb", "SB shove"], ["bb", "BB call"]] as [View, string][]).map(([v, label]) => (
              <button type="button"
                key={v} aria-pressed={view === v} onClick={() => setView(v)}
                style={{
                  fontFamily: T.mono, fontSize: 12, padding: "8px 14px", cursor: "pointer", border: "none",
                  background: view === v ? (v === "sb" ? T.shove : T.call) : "transparent",
                  color: view === v ? T.bg : T.inkSoft, fontWeight: view === v ? 700 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <output aria-live="polite" style={{ display: "flex", gap: 24, marginBottom: 10, fontSize: 13, flexWrap: "wrap" }}>
          <div>
            <span style={{ color: T.shove }}>■</span> SB shoves{" "}
            <strong style={{ color: T.ink }}>{sol.sbShovePct.toFixed(1)}%</strong>
          </div>
          <div>
            <span style={{ color: T.call }}>■</span> BB calls{" "}
            <strong style={{ color: T.ink }}>{sol.bbCallPct.toFixed(1)}%</strong>
          </div>
        </output>
        <div style={{ marginBottom: 16, padding: "8px 10px", border: `1px solid ${T.hair}`, color: T.inkSoft, fontSize: 11, lineHeight: 1.6 }}>
          <strong style={{ color: sol.converged ? T.shove : T.warn }}>
            {sol.converged ? "Stable for this model." : "Still settling."}
          </strong>{" "}
          Together, the two players could improve by at most {sol.nashGap.toFixed(4)} big blinds by changing
          their choices against each other. This check covers the solving method; it does not remove the
          sampling error or the limits of the model.
        </div>

        {/* 13×13 grid */}
        <div style={{ overflowX: "auto" }}>
          <div role="group" aria-label={`${view === "sb" ? "Small blind shove" : "Big blind call"} chart at ${stack.toFixed(1)} big blinds`} style={{ display: "grid", gridTemplateColumns: "repeat(13, minmax(30px, 1fr))", gap: 2, minWidth: 420 }}>
            {GRID_RANK_VALUES.map((_, row) =>
              GRID_RANK_VALUES.map((__, col) => {
                const idx = row * 13 + col;
                const h = HANDS[idx];
                const f = freqs[idx];
                const mixed = f > 0.001 && f < 0.999;
                const action = view === "sb" ? "shove" : "call";
                const handSummary = mixed
                  ? `${h.label}: borderline in this model; exact frequency is not reliable`
                  : `${h.label}: ${Math.round(f * 100)} percent ${action}`;
                return (
                  <div
                    key={idx}
                    title={handSummary}
                    role="img"
                    aria-label={handSummary}
                    style={{
                      aspectRatio: "1 / 1", display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      background: cellColor(f, base),
                      color: f > 0.45 ? T.bg : T.inkSoft,
                      fontSize: "clamp(8px, 1.6vw, 11px)", fontWeight: f > 0.5 ? 700 : 400,
                      border: mixed ? `1px dashed ${base}` : "1px solid transparent",
                      lineHeight: 1.1,
                    }}
                  >
                    <span>{h.label}</span>
                    {mixed && <span style={{ fontSize: "0.8em", opacity: 0.85 }}>edge</span>}
                  </div>
                );
              }),
            )}
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 14, fontSize: 11, color: T.dim, lineHeight: 1.7 }}>
          <div>
            Diagonal = pocket pairs · upper-right = suited · lower-left = offsuit.{" "}
            <span style={{ borderBottom: `1px dashed ${base}`, color: T.inkSoft }}>Dashed</span> cells sit near
            the edge of the range: the choices there are nearly break-even, so a small change in stack depth
            can flip a borderline hand.
          </div>
          <div style={{ marginTop: 4 }}>
            Blinds are 0.5 and 1 big blind. Each saved chart used {SOLUTION_META.rounds.toLocaleString()} rounds.
            Every displayed depth passed the stability check for the fixed input table. Each non-self hand
            matchup in that table came from exact enumeration of all{" "}
            {SOLUTION_META.matrixSamples.toLocaleString()} possible boards, so it has no sampling error.
            Self-matchups are exactly 50%. Card removal is modeled: each hand is weighted by how many of the
            opponent&apos;s combinations remain possible given the cards it holds.
          </div>
        </div>
      </div>
    </main>
  );
}
