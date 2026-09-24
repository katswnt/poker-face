import type { Metadata } from "next";
import catalogData from "@/lib/solver/postflop/flop-library/artifacts/catalog.json";
import initialData from "@/lib/solver/postflop/flop-library/artifacts/initial.json";
import type { FlopCatalog, FlopScenario, FlopSlice } from "@/lib/solver/postflop/flop-library/model";
import FlopExplorer from "./FlopExplorer";

const title = "Flop to River Explorer | Poker Face";
const description = "Explore six saved heads-up poker scenarios across flop, turn and river. See action mixes, chip values, changing ranges and independently measured solver quality.";
const url = "https://pokerface.katswint.com/solver/flop";
export const metadata: Metadata = {
  title, description, alternates: { canonical: url },
  openGraph: { title, description, url, type: "website", images: [{ url: "https://pokerface.katswint.com/opengraph-image", width: 1200, height: 630, alt: "Poker Face, a hold’em teaching project by Kat Swint" }] },
  twitter: { card: "summary_large_image", title, description, images: ["https://pokerface.katswint.com/opengraph-image"] },
};
export default function FlopPage() {
  // Only the catalog, default metadata and small flop view cross this boundary.
  return <FlopExplorer catalog={catalogData as FlopCatalog} initial={initialData as unknown as { scenario: FlopScenario; flop: FlopSlice }} />;
}
