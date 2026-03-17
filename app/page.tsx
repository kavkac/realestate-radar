import { Suspense } from "react";
import { AddressSearch } from "@/components/address-search";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-brand-500">🏠 RealEstateRadar</span>
          </div>
          <nav className="text-sm text-muted-foreground hidden sm:block">
            <span>Pregled nepremičnin v Sloveniji</span>
          </nav>
        </div>
      </header>

      <section className="flex-1 flex items-start justify-center px-4 py-8 sm:py-16">
        <div className="w-full max-w-2xl space-y-8">
          <div className="text-center space-y-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
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
        <div className="container mx-auto max-w-2xl space-y-3 text-center text-sm text-muted-foreground">
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
