import type { Metadata } from "next";
import example from "@/lib/solver/bridge/live/example.json";
import { readLiveDeployment } from "@/lib/solver/bridge/live/deployment-node";
import type { SavedLiveExample } from "@/lib/solver/bridge/live/view";
import LiveSolver from "./LiveSolver";

const title = "Live Turn & River Solver | Poker Face";
const description = "Build a small two-player turn or river game, check its size, and inspect an approximate strategy solved in your browser.";
const url = "https://pokerface.katswint.com/solver/live";
const image = "https://pokerface.katswint.com/opengraph-image";
export const metadata: Metadata = { title, description, alternates: { canonical: url },
  openGraph: { title, description, url, type: "website", images: [{ url: image, width: 1200, height: 630, alt: "Poker Face Hold'em Trainer" }] },
  twitter: { card: "summary_large_image", title, description, images: [image] } };

export default function LiveSolverPage() {
  return <LiveSolver example={example as unknown as SavedLiveExample} deployment={readLiveDeployment()} />;
}
