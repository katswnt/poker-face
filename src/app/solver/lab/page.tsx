import type { Metadata } from "next";
import artifactData from "@/lib/solver/toy/artifacts/leduc-v1.json" with { type: "json" };
import type { LeducSolveArtifact } from "@/lib/solver/toy/leduc-artifact";
import { buildLeducLabData } from "@/lib/solver/toy/teaching";
import LeducLab from "./LeducLab";

export const metadata: Metadata = {
  title: "Explainable Poker Solver Lab | Hold'em Trainer",
  description:
    "Learn mixing, value betting, bluffing, and bluff-catching in a small poker game whose complete strategy can be checked.",
  alternates: { canonical: "https://pokerface.katswint.com/solver/lab" },
  openGraph: {
    title: "Explainable Poker Solver Lab",
    description:
      "A small, fully checked poker game for learning why different actions can make sense.",
    url: "https://pokerface.katswint.com/solver/lab",
  },
};

const artifact = artifactData as unknown as LeducSolveArtifact;

export default function SolverLabPage() {
  // Keep the full generated artifact on the server. The interactive client receives only
  // four curated lessons and the few quality measurements it renders.
  return <LeducLab data={buildLeducLabData(artifact)} />;
}
