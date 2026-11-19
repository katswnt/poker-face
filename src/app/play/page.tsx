import type { Metadata } from "next";
import { readLiveDeployment } from "@/lib/solver/bridge/live/deployment-node";
import PlayTable from "./PlayTable";

const title = "Play the Solver-backed AI | Poker Face";
const description = "Practice a scripted heads-up poker formation against a solver-backed AI. Inspect pot odds, range equity and honest limits across 12 saved flops.";
const url = "https://pokerface.katswint.com/play", image = "https://pokerface.katswint.com/opengraph-image";
export const metadata: Metadata = {title,description,alternates:{canonical:url},
  openGraph:{title,description,url,type:"website",images:[{url:image,width:1200,height:630,alt:"Poker Face Hold'em Trainer"}]},
  twitter:{card:"summary_large_image",title,description,images:[image]}};
export default function PlayPage() { return <PlayTable deployment={readLiveDeployment()} />; }
