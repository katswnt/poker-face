import type { Metadata } from "next";
import catalogData from "@/lib/solver/postflop/explorer/artifacts/catalog.json";
import initialData from "../../../../public/solver-data/turn-v1/turn-v2-dry-value/turn.json";
import type { ExplorerCatalog, ExplorerChunk } from "@/lib/solver/postflop/explorer/model";
import TurnExplorer from "./TurnExplorer";

export const metadata: Metadata = {
  title: "Turn & River Explorer | Poker Face",
  description: "Walk through saved two-player turn and river strategies. Explore bets, possible river cards, chip values and conditional ranges, with measured solver quality.",
  alternates: { canonical: "https://pokerface.katswint.com/solver/postflop" },
  openGraph: { title: "Turn & River Explorer | Poker Face", description: "Two betting rounds, one saved strategy. See how the last card changes a decision.", url: "https://pokerface.katswint.com/solver/postflop" },
};

export default function PostflopPage() {
  // Only the checked manifest and small turn slice cross this boundary. No source
  // policy, compiler, evaluator or CFR workspace is imported by this route.
  return <TurnExplorer catalog={catalogData as unknown as ExplorerCatalog} initial={initialData as unknown as ExplorerChunk} />;
}
