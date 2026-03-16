import { AddressSearch } from "@/components/address-search";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-brand-500">
            RealEstateRadar
          </h1>
          <nav className="text-sm text-muted-foreground">
            <span>Pregled nepremičnin v Sloveniji</span>
          </nav>
        </div>
      </header>

      <section className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-xl text-center space-y-8">
          <div className="space-y-3">
            <h2 className="text-4xl font-bold tracking-tight">
              Poišči svojo nepremičnino
            </h2>
            <p className="text-muted-foreground text-lg">
              Vnesite naslov za celovit pregled podatkov o nepremičnini —
              energetska izkaznica, transakcije, podatki o stavbi.
            </p>
          </div>

          <AddressSearch />
        </div>
      </section>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        <p>Podatki: GURS, eProstor, Portal energetskih izkaznic</p>
      </footer>
    </main>
  );
}
