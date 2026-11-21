import type { Metadata } from "next";
import Drills from "./Drills";

export const metadata: Metadata = {
  title: "Poker Math Drills | Hold'em Trainer",
  description:
    "Timed drills for pot odds, minimum defence, bluff share, outs, combo counting, short-stack push/fold and equity against explicit ranges, with verified counts, saved action values and clear model limits.",
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
