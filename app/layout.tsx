import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "RealEstateRadar - Pregled nepremičnin",
  description:
    "Celovit pregled nepremičninskih podatkov za Slovenijo. Energetske izkaznice, transakcije, podatki o stavbah.",
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
