import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
});

const SITE_NAME = "Hold'em Trainer";
const CANONICAL_URL = "https://pokerface.katswint.com/";
const SITE_DESCRIPTION =
  "Step through Texas Hold'em hands and learn the math and GTO reasoning behind every decision, from equity to bet sizing. Built by Kat Swint.";
const OG_DESCRIPTION =
  "An interactive Hold'em trainer that walks you through the math and GTO reasoning behind every poker decision.";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  authors: [{ name: "Kat Swint", url: "https://katswint.com" }],
  creator: "Kat Swint",
  alternates: {
    canonical: CANONICAL_URL,
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: OG_DESCRIPTION,
    url: CANONICAL_URL,
  },
  twitter: {
    card: "summary_large_image",
    creator: "@katswint",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/icon.png", type: "image/png", sizes: "64x64" },
    ],
    shortcut: "/favicon.ico",
  },
};

const webApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: CANONICAL_URL,
  applicationCategory: "GameApplication",
  description: SITE_DESCRIPTION,
  creator: {
    "@type": "Person",
    name: "Kat Swint",
    alternateName: ["Kathryn Swint", "Kat Swint"],
    url: "https://katswint.com",
    sameAs: ["https://katswint.com", "https://twitter.com/katswint"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationJsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
