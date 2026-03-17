import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"] });

const APP_URL = "https://jakakavcic.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "RealEstateRadar — Pregled nepremičnin v Sloveniji",
    template: "%s | RealEstateRadar",
  },
  description:
    "Brezplačen celovit pregled nepremičninskih podatkov za Slovenijo. Energetske izkaznice, prodajne transakcije, podatki o stavbi, vrednostna analiza.",
  keywords: [
    "nepremičnine",
    "Slovenija",
    "energetska izkaznica",
    "GURS",
    "prodajne cene",
    "stavbe",
    "pregled nepremičnin",
  ],
  authors: [{ name: "RealEstateRadar" }],
  openGraph: {
    type: "website",
    locale: "sl_SI",
    url: APP_URL,
    siteName: "RealEstateRadar",
    title: "RealEstateRadar — Pregled nepremičnin v Sloveniji",
    description:
      "Celovit pregled nepremičninskih podatkov za Slovenijo: energetska izkaznica, transakcije, vrednostna analiza.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "RealEstateRadar",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RealEstateRadar — Pregled nepremičnin v Sloveniji",
    description:
      "Celovit pregled nepremičninskih podatkov za Slovenijo: energetska izkaznica, transakcije, vrednostna analiza.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sl">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
