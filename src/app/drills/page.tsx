import type { Metadata } from "next";
import Drills from "./Drills";

export const metadata: Metadata = {
  title: "Poker Math Drills | Hold'em Trainer",
  description:
    "Timed drills for pot odds, minimum defence, bluff share, outs, and combo counting, with exact answers and the at-table shortcut for each.",
  alternates: { canonical: "https://pokerface.katswint.com/drills" },
  openGraph: {
    title: "Poker Math Drills",
    description: "Practice the common poker numbers until they are instant, with exact answers and explained shortcuts.",
    url: "https://pokerface.katswint.com/drills",
  },
};

export default function DrillsPage() {
  return <Drills />;
}
