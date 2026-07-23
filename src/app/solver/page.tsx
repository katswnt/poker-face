"use client";

// Heads-up preflop push/fold Nash equilibrium — interactive demo.
// A real, computed equilibrium (iterative best response over a Monte-Carlo equity matrix),
// distinct from the app's 4-handed heuristic trainer. Client component: the slider re-solves
// the Nash ranges live from the committed 169×169 equity matrix.
import { useMemo, useState } from "react";
import { HANDS, GRID_RANK_VALUES } from "@/lib/solver/hands";
import { solvePushFold } from "@/lib/solver/pushfold";

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

  const sol = useMemo(() => solvePushFold(stack), [stack]);
  const freqs = view === "sb" ? sol.sbShove : sol.bbCall;
  const base = view === "sb" ? T.shove : T.call;

  return (
    <main style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.mono, padding: "clamp(16px, 4vw, 40px)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ borderBottom: `1px solid ${T.hair}`, paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.dim, textTransform: "uppercase" }}>Heads-Up · Push / Fold</div>
          <h1 style={{ fontSize: "clamp(20px, 4vw, 28px)", fontWeight: 700, margin: "6px 0 10px", color: T.ink }}>
            Nash Equilibrium Solver
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: T.inkSoft, margin: 0 }}>
            A <strong style={{ color: T.ink }}>real, computed Nash equilibrium</strong> — solved by iterative
            best response (fictitious play) over a Monte-Carlo equity matrix, and verifiable against published
            push/fold charts. This is the exact-solution, heads-up jam-or-fold game — distinct from the app&apos;s
            4-handed <em>heuristic</em> trainer.
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

          <div role="tablist" aria-label="Range view" style={{ display: "flex", border: `1px solid ${T.hair}` }}>
            {([["sb", "SB shove"], ["bb", "BB call"]] as [View, string][]).map(([v, label]) => (
              <button
                key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
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
        <div style={{ display: "flex", gap: 24, marginBottom: 16, fontSize: 13 }}>
          <div>
            <span style={{ color: T.shove }}>■</span> SB shoves{" "}
            <strong style={{ color: T.ink }}>{sol.sbShovePct.toFixed(1)}%</strong>
          </div>
          <div>
            <span style={{ color: T.call }}>■</span> BB calls{" "}
            <strong style={{ color: T.ink }}>{sol.bbCallPct.toFixed(1)}%</strong>
          </div>
        </div>

        {/* 13×13 grid */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(13, minmax(30px, 1fr))", gap: 2, minWidth: 420 }}>
            {GRID_RANK_VALUES.map((_, row) =>
              GRID_RANK_VALUES.map((__, col) => {
                const idx = row * 13 + col;
                const h = HANDS[idx];
                const f = freqs[idx];
                const mixed = f > 0.001 && f < 0.999;
                return (
                  <div
                    key={idx}
                    title={`${h.label}: ${(f * 100).toFixed(0)}% ${view === "sb" ? "shove" : "call"}`}
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
                    {mixed && <span style={{ fontSize: "0.8em", opacity: 0.85 }}>{Math.round(f * 100)}%</span>}
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
            <span style={{ borderBottom: `1px dashed ${base}`, color: T.inkSoft }}>Dashed</span> cells are mixed
            (fractional) frequencies.
          </div>
          <div style={{ marginTop: 4 }}>
            SB=0.5bb, BB=1.0bb. Solved by fictitious play (~1200 iterations) to equilibrium; combo-weighted
            (pairs ×6, suited ×4, offsuit ×12). Card removal between the two hands is not modeled.
          </div>
        </div>
      </div>
    </main>
  );
}
