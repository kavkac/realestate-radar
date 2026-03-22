import { Suspense } from "react";
import { AddressSearch } from "@/components/address-search";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";
import { HeaderSavedButton } from "@/components/header-saved-button";
import { UserMenu } from "@/components/user-menu";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = Link as any;

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-100">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between">
          <span className="font-semibold text-gray-900 text-[15px] tracking-tight">
            RealEstateRadar
          </span>
          <nav className="flex items-center gap-3 text-sm">
            <SignedIn>
              <HeaderSavedButton />
              <UserMenu />
            </SignedIn>
            <SignedOut>
              <L href="/sign-in" className="text-muted-foreground hover:text-foreground transition-colors">
                Prijava
              </L>
              <L href="/sign-up" className="bg-brand-500 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-brand-600 transition-colors">
                Registracija
              </L>
            </SignedOut>
          </nav>
        </div>
      </header>

      <section className="flex-1 flex items-start justify-center px-4 py-8 sm:py-16">
        <div className="w-full max-w-5xl space-y-8">
          <div className="text-center space-y-3">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Poišči svojo nepremičnino
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg">
              Vnesite naslov za celovit pregled podatkov o nepremičnini —
              energetska izkaznica, transakcije, podatki o stavbi.
            </p>
          </div>

          <Suspense>
            <AddressSearch />
          </Suspense>


        </div>
      </section>

      <footer className="border-t py-8 px-4">
        <div className="container mx-auto max-w-5xl space-y-3 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground/70">Viri podatkov</p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
            <span>📍 GURS — Register prostorskih enot (RPE)</span>
            <span>🏗️ GURS — Kataster nepremičnin (KN)</span>
            <span>⚡ Portal energetskih izkaznic (MOPE)</span>
            <span>💰 GURS — Evidenca trga nepremičnin (ETN)</span>
          </div>
          <p className="text-xs">
            <strong>Izjava o omejitvi odgovornosti:</strong> Podatki so informativne
            narave in temeljijo na uradnih javnih registrih. RealEstateRadar ne
            prevzema odgovornosti za točnost ali popolnost prikazanih podatkov.
            Pred pravnimi ali finančnimi odločitvami preverite podatke pri
            pristojnih organih.
          </p>
          <p className="text-xs text-muted-foreground/60">
            © {new Date().getFullYear()} RealEstateRadar · Podatki se osvežujejo periodično
          </p>
        </div>
      </footer>
    </main>
  );
}
