import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Push/Fold Strategy Explorer | Hold'em Trainer",
  description: "Explore a simplified heads-up shove-or-fold poker model, with its stability check and limits shown in plain language.",
  alternates: { canonical: "https://pokerface.katswint.com/solver" },
  openGraph: {
    title: "Push/Fold Strategy Explorer",
    description: "Explore a simplified heads-up shove-or-fold poker model, with its stability check and limits shown in plain language.",
    url: "https://pokerface.katswint.com/solver",
  },
};

export default function SolverLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
