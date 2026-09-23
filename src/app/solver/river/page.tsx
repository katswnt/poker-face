import type { Metadata } from "next";
import { riverLabExample } from "@/lib/solver/river/lab/example";
import RiverLab from "./RiverLab";

export const metadata: Metadata = {
  title: "River Solver Lab | Poker Face",
  description: "Explore a bounded two-player river game. Inspect approximate strategies, exact card enumeration, chip values, and measured exploitability in plain language.",
  alternates: { canonical: "https://pokerface.katswint.com/solver/river" },
  openGraph: {
    title: "River Solver Lab | Poker Face",
    description: "Learn why a river choice works, with explicit ranges, bet sizes, and measured strategy quality.",
    url: "https://pokerface.katswint.com/solver/river",
  },
};

export default function RiverSolverPage() {
  // Only the menu and one explanation cross the server/client boundary. No browser solve
  // is needed to open the checked-in example; further explanations are requested in a worker.
  return <RiverLab example={riverLabExample().result} />;
}
