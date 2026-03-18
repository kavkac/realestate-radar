"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { CreditCalculator } from "./credit-calculator";

const CadastralMap = dynamic(() => import("./cadastral-map"), { ssr: false });

interface Prostor {
  vrsta: string;
  povrsina: number | null;
}

interface LastnistvoRecord {
  tipLastnistva: string;
  tipOsebe: "Pravna oseba" | "Fizična oseba";
  delez: string;
  datumVpisa: string;
  nazivPravneOsebe: string | null;
}

interface DelStavbe {
  stDela: number;
  povrsina: number | null;
  uporabnaPovrsina: number | null;
  vrsta: string | null;
  letoObnoveInstalacij: number | null;
  letoObnoveOken: number | null;
  dvigalo: boolean;
  prostori: Prostor[];
  lastnistvo?: LastnistvoRecord[];
  etazaDelStavbe?: number | null;
  vrstaStanovanjaUradno?: string | null;
}

interface Parcela {
  parcelnaStevila: string;
  povrsina: number | null;
  vrstaRabe: string | null;
  boniteta: number | null;
  katastrskiRazred: number | null;
  katastrskiDohodek: number | null;
}

interface RenVrednost {
  vrednost: number;
  datumOcene: string;
}

interface EnergyData {
  razred: string;
  tip: string | null;
  datumIzdaje: string;
  veljaDo: string;
  potrebnaTopota: number | null;
  dovedenaEnergija: number | null;
  celotnaEnergija: number | null;
  elektricnaEnergija: number | null;
  primaryEnergy: number | null;
  co2: number | null;
  kondicionirana: number | null;
}

interface EtnAnaliza {
  steviloTransakcij: number;
  povprecnaCenaM2: number;
  minCenaM2: number;
  maxCenaM2: number;
  ocenjenaTrznaVrednost: number | null;
  trend: "rast" | "padec" | "stabilno" | null;
  zadnjeLeto: number | null;
  predLeto: number | null;
}

interface PropertyCardProps {
  naslov: string;
  enolicniId: { koId: number; stStavbe: number; stDelaStavbe: number | null };
  stavba: {
    letoIzgradnje: number | null;
    letoObnove: { fasade: number | null; strehe: number | null };
    steviloEtaz: number | null;
    steviloStanovanj: number | null;
    povrsina: number | null;
    konstrukcija: string | null;
    tip: string | null;
    datumSys?: string | null;
    prikljucki: {
      elektrika: boolean;
      plin: boolean;
      vodovod: boolean;
      kanalizacija: boolean;
    };
    gasInfrastructure?: boolean | null;
    visina?: number | null;
    tipPolozaja?: "samostojna" | "vogalna" | "vmesna vrstna" | null;
    orientacija?: "S" | "SV" | "V" | "JV" | "J" | "JZ" | "Z" | "SZ" | null;
    kompaktnost?: number | null;
  };
  deliStavbe: DelStavbe[];
  energetskaIzkaznica: EnergyData | null;
  parcele?: Parcela[];
  renVrednost?: RenVrednost | null;
  etnAnaliza?: EtnAnaliza | null;
  lat?: number | null;
  lng?: number | null;
  requestedDel?: number;
  onClearDel?: () => void;
}

const ENERGY_COLORS: Record<string, string> = {
  A1: "bg-green-100 text-green-800",
  A2: "bg-green-100 text-green-800",
  B1: "bg-lime-100 text-lime-800",
  B2: "bg-lime-100 text-lime-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-orange-100 text-orange-800",
  E: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
  G: "bg-red-100 text-red-800",
};

const HEATING_PRICE_EUR = 0.12;

function Check({ on }: { on: boolean }) {
  return (
    <span className={`inline-block w-4 text-center ${on ? "text-green-600" : "text-gray-300"}`}>
      {on ? "\u2713" : "\u2717"}
    </span>
  );
}

export function PropertyCard({
  naslov,
  enolicniId,
  stavba,
  deliStavbe,
  energetskaIzkaznica,
  parcele,
  renVrednost,
  etnAnaliza,
  lat,
  lng,
  requestedDel,
  onClearDel,
}: PropertyCardProps) {
  const [selectedDel, setSelectedDel] = useState<number | null>(null);
  const [kreditOpen, setKreditOpen] = useState(false);
  const [showAllUnits, setShowAllUnits] = useState(false);
  const VISIBLE_DEFAULT = 6; // 2 polni vrstici × 3 stolpci
  const FADE_ROW = 3; // 3. vrsta vidna a fadirana

  const sortedParts = [...deliStavbe].sort((a, b) => a.stDela - b.stDela);
  const filteredParts =
    requestedDel != null
      ? sortedParts.filter((d) => d.stDela === requestedDel)
      : deliStavbe;

  const isMultiUnit = !requestedDel && deliStavbe.length > 1;
  const activePart =
    selectedDel != null
      ? deliStavbe.find((d) => d.stDela === selectedDel) ?? null
      : null;

  const currentPart = activePart ?? (!isMultiUnit ? filteredParts[0] : null) ?? null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: naslov,
    description: `Pregled nepremičnine: ${naslov}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: naslov,
      addressCountry: "SI",
    },
    ...(stavba.letoIzgradnje && { yearBuilt: stavba.letoIzgradnje }),
    ...(stavba.povrsina && {
      floorSize: {
        "@type": "QuantitativeValue",
        value: stavba.povrsina,
        unitText: "m2",
      },
    }),
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden text-left text-gray-700 print:shadow-none print:border-0">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Header */}
      <div className="bg-[#2d6a4f] px-6 py-5 text-white print:bg-white print:text-gray-900 print:border-b-2 print:border-[#2d6a4f]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-semibold print:text-[#2d6a4f] break-words">
              {naslov}
            </h3>
            <p className="text-sm text-green-200 print:text-gray-500 mt-0.5">
              Pregled podatkov o nepremičnini
            </p>
          </div>
          <button
            onClick={() => window.print()}
            title="Izvozi poročilo o nepremičnini"
            className="print:hidden flex-shrink-0 rounded border border-white/20 bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap"
            aria-label="Izvozi poročilo o nepremičnini"
          >
            Izvozi poročilo
          </button>
        </div>
      </div>

      {/* Back to all units button */}
      {requestedDel != null && deliStavbe.length > 1 && (
        <div className="px-6 pt-3 pb-1">
          <button
            onClick={() => onClearDel?.()}
            className="text-xs text-[#2d6a4f] hover:underline flex items-center gap-1"
          >
            ← Prikaži vse dele stavbe ({deliStavbe.length})
          </button>
        </div>
      )}

      {/* Cadastral map - full width on mobile, hidden on desktop (shown in right col) */}
      <div className="lg:hidden border-b border-gray-100 space-y-4 p-4">
        <AerialMap lat={lat} lng={lng} naslov={naslov} showStreetView={false} />
        <StreetViewEmbed lat={lat} lng={lng} naslov={naslov} />
        {lat && lng && (
          <div>
            <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Geodetski načrt · GURS</p>
            <CadastralMap lat={lat} lng={lng} naslov={naslov} koId={enolicniId.koId} stStavbe={enolicniId.stStavbe} />
          </div>
        )}
      </div>

      <div className="lg:flex overflow-hidden">
        {/* Left column: main data (60% on desktop) */}
        <div className="lg:w-[60%] min-w-0 p-6 space-y-8">
          {/* L1: Kratek opis */}
          <PropertySummary stavba={stavba} deliStavbe={deliStavbe} energetskaIzkaznica={energetskaIzkaznica} />

          {/* L1: Ključni podatki */}
          <KljucniPodatki stavba={stavba} deliStavbe={deliStavbe} />

          {/* L2: Tehnični izpis */}
          <BuildingSection stavba={stavba} />

          {/* L2: Stanovanja in prostori */}
          {isMultiUnit && !activePart && (
            <section>
              <Label vir="Kataster nepremičnin · GURS">Stanovanja in prostori ({deliStavbe.length})</Label>
              <p className="text-sm text-gray-400 mb-3 flex items-center gap-1">
                <span>↓</span> Izberite enoto za podroben pregled
              </p>
              <div className="relative">
              <div className="grid gap-2 sm:grid-cols-2">
                {(showAllUnits ? sortedParts : sortedParts.slice(0, VISIBLE_DEFAULT + FADE_ROW)).map((d) => (
                  <button
                    key={d.stDela}
                    onClick={() => setSelectedDel(d.stDela)}
                    className={`rounded-md border px-4 py-3 text-left hover:bg-gray-50 cursor-pointer transition-all ${
                      selectedDel === d.stDela
                        ? "bg-green-50 border-[#2d6a4f]"
                        : "bg-white border-gray-100"
                    }`}
                  >
                    {/* Header row: unit number left, type label right */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-gray-800">Enota {d.stDela}</span>
                      {/* d.vrsta hidden — WFS vrača napačne vrednosti; prikazati ko bo KN bulk import */}
                    </div>
                    {/* Area row: skupna left, uporabna right */}
                    {(d.povrsina != null || d.uporabnaPovrsina != null) && (
                      <div className="flex gap-6 mt-2">
                        {d.povrsina != null && (
                          <div>
                            <div className="text-base font-medium text-gray-800 tabular-nums">{fmtDec(d.povrsina)} m²</div>
                            <div className="text-xs text-gray-400">skupna površina</div>
                          </div>
                        )}
                        {d.uporabnaPovrsina != null && (
                          <div>
                            <div className="text-base font-medium text-gray-800 tabular-nums">{fmtDec(d.uporabnaPovrsina)} m²</div>
                            <div className="text-xs text-gray-400">uporabna površina</div>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Rooms row */}
                    {d.prostori.length > 0 && (
                      <div className="mt-2 text-xs text-gray-500">Prostori: {d.prostori.length}</div>
                    )}
                  </button>
                ))}
              </div>
              {!showAllUnits && sortedParts.length > VISIBLE_DEFAULT && (
                <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent pointer-events-none" />
              )}
              </div>
              {deliStavbe.length > VISIBLE_DEFAULT && (
                <button
                  onClick={() => setShowAllUnits(!showAllUnits)}
                  className="w-full mt-2 py-2 text-sm text-[#2d6a4f] hover:underline"
                >
                  {showAllUnits
                    ? "Skrij ↑"
                    : `Prikaži vse enote (${deliStavbe.length}) ↓`}
                </button>
              )}
            </section>
          )}

          {isMultiUnit && activePart && (
            <section>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 pb-3 border-b border-gray-100">
                <button onClick={() => setSelectedDel(null)} className="hover:text-[#2d6a4f] transition-colors">
                  Vse enote ({deliStavbe.length})
                </button>
                <span className="text-gray-300">/</span>
                <span className="text-gray-800 font-medium">Enota {activePart.stDela}</span>
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Enota {activePart.stDela}</h4>
              <PartDetail part={activePart} />
            </section>
          )}

          {!isMultiUnit && filteredParts.length > 0 && (
            <section>
              <Label vir="Kataster nepremičnin · GURS">
                {filteredParts.length === 1
                  ? "Stanovanje"
                  : `Stanovanja in prostori (${filteredParts.length})`}
              </Label>
              {filteredParts.map((d) => (
                <PartDetail key={d.stDela} part={d} />
              ))}
            </section>
          )}

          {/* L3: Stanje */}
          <MaintenanceSection stavba={stavba} part={currentPart} />
          <EnergyCertificateSection data={energetskaIzkaznica} stavba={stavba} part={currentPart} />
          <EnergetskiIzracunSection energetskaIzkaznica={energetskaIzkaznica} />

          {/* L4: Vrednost in lastništvo (vedno odprto) */}
          <div className="border-t border-gray-100 pt-6 space-y-8">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Vrednost in lastništvo</h3>
              <p className="text-xs text-gray-400 mt-0.5">Ocenjena vrednost, transakcije, lastništvo, parcele</p>
            </div>
            <RenVrednostSection data={renVrednost} />
            <VrednostnaAnalizaSection data={etnAnaliza} />
            {isMultiUnit && !activePart ? (
              <LastnistvoMultiSection deliStavbe={deliStavbe} />
            ) : (
              <LastnistvoSection data={currentPart?.lastnistvo} />
            )}
            <ParceleSection parcele={parcele} />
          </div>

          {/* L5: Storitve */}
          <ServicesSection />

          {/* L6: Izračunaj kredit */}
          <div>
            <button
              onClick={() => setKreditOpen(!kreditOpen)}
              className="w-full flex items-center justify-between px-6 py-3 bg-green-50 border border-green-200 hover:bg-green-100 transition-colors text-sm font-medium text-[#2d6a4f]"
            >
              <span>Izračunaj kredit</span>
              <span className="text-xs">{kreditOpen ? '▲' : '▼'}</span>
            </button>
            {kreditOpen && (
              <div className="border-l-4 border-[#2d6a4f] bg-gray-50 px-6 py-4">
                <CreditCalculator />
              </div>
            )}
          </div>
        </div>

        {/* Right column: maps (40% on desktop) */}
        <div className="hidden lg:block lg:w-[40%] min-w-0 overflow-hidden lg:border-l lg:border-gray-100 p-6 space-y-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          {/* 1. Google Maps aerial */}
          <AerialMap lat={lat} lng={lng} naslov={naslov} showStreetView={false} />
          {/* 2. Street View */}
          <StreetViewEmbed lat={lat} lng={lng} naslov={naslov} />
          {/* 3. Cadastral map - parcel boundaries */}
          {lat && lng && (
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Geodetski načrt · GURS</p>
              <CadastralMap lat={lat} lng={lng} naslov={naslov} koId={enolicniId.koId} stStavbe={enolicniId.stStavbe} />
            </div>
          )}
        </div>
      </div>

      {/* CC 4.0 attribution footer */}
      <div className="text-[10px] text-gray-400 px-6 py-3 border-t border-gray-100">
        Podatki: Geodetska uprava Republike Slovenije (GURS) &middot; Ministrstvo za okolje in prostor (MOP) &middot; Vir: Kataster nepremičnin, Register energetskih izkaznic &middot; Licenca: CC BY 4.0
      </div>

      {/* Lead capture - low-key, bottom of card */}
      <LeadCaptureSection naslov={naslov} />
    </div>
  );
}

// --- Lead capture ---

function LeadCaptureSection({ naslov }: { naslov: string }) {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, naslov }),
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-6 py-5 print:hidden">
      {sent ? (
        <p className="text-sm text-[#2d6a4f]">Hvala! Obvestili vas bomo, ko bodo podatki dostopni.</p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-3">
            Manjkajo podatki za to nepremičnino? Obvestimo vas, ko bodo energetska izkaznica ali transakcijske cene dostopne.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-sm">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="vas@email.si"
              required
              className="flex-1 rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#2d6a4f]"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-[#2d6a4f] px-4 py-2 text-sm text-white hover:bg-[#245a42] disabled:opacity-50 transition-colors"
            >
              {loading ? "..." : "Obvestite me"}
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-2">Brez registracije. E-pošto uporabimo samo za to obvestilo.</p>
        </>
      )}
    </div>
  );
}

// --- Shared components ---

function Label({ children, vir }: { children: React.ReactNode; vir?: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500 border-l-4 border-gray-800 pl-3">
        {children}
      </h4>
      {vir && (
        <p className="text-[10px] text-gray-400 font-normal pl-[19px] mt-0.5">Vir: {vir}</p>
      )}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <h5 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
      {children}
    </h5>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (value == null) return null;
  return (
    <div>
      <span className="text-xs text-gray-400">{label}</span>
      <p className="text-sm text-gray-700">{value}</p>
    </div>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("sl-SI");
}

function fmtDec(n: number): string {
  return n.toLocaleString("sl-SI");
}

function fmtDate(raw: string): string {
  if (!raw) return "\u2014";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("sl-SI", { day: "numeric", month: "numeric", year: "numeric" });
}

// --- Sections ---

function PropertySummary({ stavba, deliStavbe, energetskaIzkaznica }: {
  stavba: PropertyCardProps["stavba"];
  deliStavbe: PropertyCardProps["deliStavbe"];
  energetskaIzkaznica: PropertyCardProps["energetskaIzkaznica"];
}) {
  if (!stavba || !stavba.letoIzgradnje) return null;

  const leto = stavba.letoIzgradnje;
  const letnica = new Date().getFullYear();

  // --- Stavek 1: Ocena vzdrževalne urgentnosti ---
  const LIFECYCLE: Record<string, number> = { fasada: 30, streha: 40, instalacije: 30 };
  const komponente: { ime: string; starost: number; zivljenjska: number }[] = [];
  const letoFasade = stavba.letoObnove?.fasade || leto;
  const letoStrehe = stavba.letoObnove?.strehe || leto;
  komponente.push({ ime: "fasada", starost: letnica - letoFasade, zivljenjska: LIFECYCLE.fasada });
  komponente.push({ ime: "streha", starost: letnica - letoStrehe, zivljenjska: LIFECYCLE.streha });
  komponente.push({ ime: "instalacije", starost: letnica - leto, zivljenjska: LIFECYCLE.instalacije });

  const prekoracene = komponente.filter(k => k.starost > k.zivljenjska);
  let stavek1 = "";
  if (prekoracene.length >= 3) {
    stavek1 = `Stavba je stara ${letnica - leto} let. Fasada, streha in instalacije so presegle priporočeno življenjsko dobo — investicija v prenovo je visoko verjetna.`;
  } else if (prekoracene.length === 2) {
    const imena = prekoracene.map(k => k.ime).join(" in ");
    stavek1 = `Stavba je stara ${letnica - leto} let. ${imena.charAt(0).toUpperCase() + imena.slice(1)} presegata priporočeno življenjsko dobo — pričakujte stroške prenove.`;
  } else if (prekoracene.length === 1) {
    stavek1 = `Stavba je stara ${letnica - leto} let. ${prekoracene[0].ime.charAt(0).toUpperCase() + prekoracene[0].ime.slice(1)} presega priporočeno življenjsko dobo ${prekoracene[0].zivljenjska} let.`;
  } else {
    stavek1 = `Stavba je stara ${letnica - leto} let. Glede na zabeležene obnove so ključne komponente v pričakovani življenjski dobi.`;
  }

  // --- Stavek 2: Energetska ocena (samo če ni EIZ) ---
  let stavek2 = "";
  if (!energetskaIzkaznica) {
    let ocenjenRazred = "";
    if (leto < 1945) ocenjenRazred = "E ali F";
    else if (leto < 1980) ocenjenRazred = "D ali E";
    else if (leto < 2002) ocenjenRazred = "C ali D";
    else if (leto < 2010) ocenjenRazred = "B ali C";
    else ocenjenRazred = "B";
    stavek2 = `Energetska izkaznica za to stavbo ni vpisana v register. Glede na leto izgradnje je pričakovan energetski razred ${ocenjenRazred}.`;
  }

  return (
    <div className="text-sm text-gray-600 leading-relaxed border-l-4 border-gray-200 pl-4 py-1 space-y-1.5">
      <p>{stavek1}</p>
      {stavek2 && <p>{stavek2}</p>}
      <p className="text-[10px] text-gray-400">Ocena na podlagi podatkov Katastra nepremičnin · GURS</p>
    </div>
  );
}

function KljucniPodatki({ stavba, deliStavbe }: { stavba: PropertyCardProps["stavba"]; deliStavbe: PropertyCardProps["deliStavbe"] }) {
  // Površina: bruto iz stavbe, fallback = vsota enot
  const povrsina = stavba.povrsina ?? (
    deliStavbe.length > 0
      ? deliStavbe.reduce((sum, d) => sum + (d.povrsina ?? 0), 0) || null
      : null
  );

  const stats: { label: string; value: string }[] = [];
  if (stavba.letoIzgradnje) stats.push({ label: "Leto izgradnje", value: String(stavba.letoIzgradnje) });
  if (stavba.steviloEtaz) stats.push({ label: "Etaže", value: String(stavba.steviloEtaz) });
  if (povrsina) stats.push({ label: "Površina", value: `${fmtDec(povrsina)} m²` });

  if (stats.length === 0) return null;

  return (
    <section>
      <Label vir="Kataster nepremičnin · GURS">Ključni podatki</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden divide-y sm:divide-y-0 divide-gray-100">
        {stats.map((s, i) => (
          <div key={s.label} className={`px-4 py-5 text-center ${i > 0 ? "sm:border-l sm:border-gray-100" : ""} ${i === stats.length - 1 && stats.length % 2 !== 0 ? "col-span-2 sm:col-span-1" : ""}`}>
            <p className="text-[11px] text-gray-400 mb-2 uppercase tracking-wider">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BuildingSection({ stavba }: { stavba: PropertyCardProps["stavba"] }) {
  return (
    <section>
      <Label vir="Kataster nepremičnin · GURS">O stavbi</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <Field label="Tip stavbe" value={stavba.tip} />
        <Field label="Stanovanj" value={stavba.steviloStanovanj} />
        <Field label="Konstrukcija" value={stavba.konstrukcija} />
        <Field label="Obnova fasade" value={stavba.letoObnove.fasade} />
        <Field label="Obnova strehe" value={stavba.letoObnove.strehe} />
        {stavba.datumSys && (
          <Field label="Stanje registra" value={fmtDate(stavba.datumSys)} />
        )}
        {stavba.tipPolozaja && (
          <Field label="Tip položaja" value={stavba.tipPolozaja.charAt(0).toUpperCase() + stavba.tipPolozaja.slice(1)} />
        )}
        {stavba.orientacija && (
          <Field label="Orientacija fasade" value={stavba.orientacija} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600 mt-4">
        <span><Check on={stavba.prikljucki.elektrika} /> Elektrika</span>
        <span>
          <Check on={stavba.gasInfrastructure ?? stavba.prikljucki.plin} /> Plin
          <span className="ml-1 text-xs text-gray-400">{stavba.gasInfrastructure != null ? "ZK GJI · GURS" : "GURS"}</span>
        </span>
        <span><Check on={stavba.prikljucki.vodovod} /> Vodovod</span>
        <span><Check on={stavba.prikljucki.kanalizacija} /> Kanalizacija</span>
      </div>
    </section>
  );
}

function PartDetail({ part }: { part: DelStavbe }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <Field label="Številka dela" value={part.stDela} />
        <Field
          label="Površina"
          value={part.povrsina != null ? `${fmtDec(part.povrsina)} m\u00B2` : null}
        />
        <Field
          label="Uporabna površina"
          value={
            part.uporabnaPovrsina != null
              ? `${fmtDec(part.uporabnaPovrsina)} m\u00B2`
              : null
          }
        />
        {/* Namembnost (KN) hidden — WFS vrača napačne vrednosti; prikazati ko bo KN bulk import */}
        <div className="col-span-2 sm:col-span-3 -mt-2">
          <p className="text-[10px] text-gray-400">Kataster nepremičnin, GURS</p>
        </div>
        <Field label="Obnova instalacij" value={part.letoObnoveInstalacij} />
        <Field label="Obnova oken" value={part.letoObnoveOken} />
        {part.dvigalo && <Field label="Dvigalo" value="Da" />}
      </div>

      {part.prostori.length > 0 && (
        <div>
          <SubLabel>Prostori</SubLabel>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500 text-xs tracking-wide">
                <th className="pb-2 pr-4 font-medium">Vrsta prostora</th>
                <th className="pb-2 text-right font-medium">Površina</th>
              </tr>
            </thead>
            <tbody>
              {part.prostori.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 odd:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-700">{r.vrsta}</td>
                  <td className="py-2 text-right tabular-nums text-gray-700">
                    {r.povrsina != null ? `${fmtDec(r.povrsina)} m\u00B2` : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EnergyMeter({ razred }: { razred: string }) {
  const classes = [
    { label: "A1", color: "#1a9f3f", width: "45%" },
    { label: "A2", color: "#4caf50", width: "52%" },
    { label: "B1", color: "#8bc34a", width: "59%" },
    { label: "B2", color: "#cddc39", width: "66%" },
    { label: "C",  color: "#ffeb3b", width: "73%" },
    { label: "D",  color: "#ffc107", width: "80%" },
    { label: "E",  color: "#ff9800", width: "87%" },
    { label: "F",  color: "#f44336", width: "94%" },
    { label: "G",  color: "#b71c1c", width: "100%" },
  ];

  return (
    <div className="flex flex-col gap-[2px] my-3 max-w-[280px]">
      {classes.map((c) => {
        const isActive = c.label === razred;
        return (
          <div key={c.label} className="flex items-center gap-2">
            <div
              className="flex items-center justify-end pr-2 text-white font-bold text-xs"
              style={{
                width: c.width,
                backgroundColor: c.color,
                height: isActive ? "26px" : "18px",
                clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)",
                opacity: isActive ? 1 : 0.45,
                transition: "all 0.15s",
              }}
            >
              {c.label}
            </div>
            {isActive && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-bold" style={{ color: c.color }}>◀</span>
                <span className="text-sm font-bold text-gray-800">{c.label}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function oceniEnergetskiRazred(stavba: {
  letoIzgradnje: number | null;
  letoObnove: { fasade: number | null; strehe: number | null };
  konstrukcija: string | null;
  prikljucki: { plin: boolean; vodovod: boolean; elektrika: boolean; kanalizacija: boolean };
  gasInfrastructure?: boolean | null;
  steviloEtaz?: number | null;
  visina?: number | null;
  tipPolozaja?: "samostojna" | "vogalna" | "vmesna vrstna" | null;
  kompaktnost?: number | null;
  orientacija?: "S" | "SV" | "V" | "JV" | "J" | "JZ" | "Z" | "SZ" | null;
}, part?: {
  letoObnoveOken: number | null;
  letoObnoveInstalacij: number | null;
  etazaDelStavbe?: number | null;
} | null): { razred: string; razredBazni: string; prilagoditev: number; dejavnikiBaza: string[]; dejavnikiPrilagoditve: string[]; zaupanje: "visoko" | "srednje" | "nizko" } | null {
  if (!stavba.letoIzgradnje) return null;

  const leto = stavba.letoIzgradnje;
  const zdaj = new Date().getFullYear();
  const dejavnikiBaza: string[] = [];
  const dejavnikiPrilagoditve: string[] = [];

  // Faza 1 — Standard (PURES 2010 / EN ISO 52000): samo leto izgradnje
  let scoreBaza = 0;
  if (leto < 1946)      { scoreBaza = 95; dejavnikiBaza.push(`Zgrajeno pred 1946 — brez toplotne zaščite`); }
  else if (leto < 1960) { scoreBaza = 88; dejavnikiBaza.push(`Zgrajeno ${leto} — predvojna gradnja`); }
  else if (leto < 1974) { scoreBaza = 82; dejavnikiBaza.push(`Zgrajeno ${leto} — pred energetsko krizo`); }
  else if (leto < 1980) { scoreBaza = 74; dejavnikiBaza.push(`Zgrajeno ${leto} — začetek toplotne izolacije`); }
  else if (leto < 1988) { scoreBaza = 68; dejavnikiBaza.push(`Zgrajeno ${leto} — minimalni standardi`); }
  else if (leto < 1994) { scoreBaza = 60; dejavnikiBaza.push(`Zgrajeno ${leto} — JUS standardi`); }
  else if (leto < 2002) { scoreBaza = 52; dejavnikiBaza.push(`Zgrajeno ${leto} — delna toplotna izolacija`); }
  else if (leto < 2006) { scoreBaza = 42; dejavnikiBaza.push(`Zgrajeno ${leto} — PURES 2002`); }
  else if (leto < 2010) { scoreBaza = 36; dejavnikiBaza.push(`Zgrajeno ${leto} — PURES 2002 (strožji)`); }
  else if (leto < 2013) { scoreBaza = 28; dejavnikiBaza.push(`Zgrajeno ${leto} — PURES 2010`); }
  else if (leto < 2016) { scoreBaza = 22; dejavnikiBaza.push(`Zgrajeno ${leto} — PURES 2010 (strožji)`); }
  else if (leto < 2021) { scoreBaza = 15; dejavnikiBaza.push(`Zgrajeno ${leto} — nizko-energijska gradnja`); }
  else                  { scoreBaza = 8;  dejavnikiBaza.push(`Zgrajeno ${leto} — skoraj nič-energijska gradnja`); }

  // Faza 2 — Prilagoditve (naš algoritem): vse korekcije v točkah (negativno = boljše)
  let adj = 0;

  const letaFasade = stavba.letoObnove.fasade;
  if (letaFasade) {
    const starost = zdaj - letaFasade;
    if (starost <= 5)       { adj -= 22; dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade} — nova toplotna izolacija`); }
    else if (starost <= 10) { adj -= 18; dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade} — dobra toplotna izolacija`); }
    else if (starost <= 20) { adj -= 10; dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade} — delna izboljšava`); }
    else                    { adj -= 4;  dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade}`); }
  }

  const letaStrehe = stavba.letoObnove.strehe;
  if (letaStrehe) {
    const starost = zdaj - letaStrehe;
    if (starost <= 5)       { adj -= 10; dejavnikiPrilagoditve.push(`Streha obnovljena ${letaStrehe} — nova toplotna zaščita`); }
    else if (starost <= 15) { adj -= 7;  dejavnikiPrilagoditve.push(`Streha obnovljena ${letaStrehe}`); }
    else                    { adj -= 3;  dejavnikiPrilagoditve.push(`Streha obnovljena ${letaStrehe}`); }
  }

  const letaOken = part?.letoObnoveOken;
  if (letaOken) {
    const starost = zdaj - letaOken;
    if (starost <= 5)       { adj -= 10; dejavnikiPrilagoditve.push(`Okna obnovljena ${letaOken} — energijsko varčna okna`); }
    else if (starost <= 10) { adj -= 7;  dejavnikiPrilagoditve.push(`Okna obnovljena ${letaOken}`); }
    else                    { adj -= 3;  dejavnikiPrilagoditve.push(`Okna obnovljena ${letaOken}`); }
  }

  const letaInstalacij = part?.letoObnoveInstalacij;
  if (letaInstalacij) {
    const starost = zdaj - letaInstalacij;
    if (starost <= 10) { adj -= 5; dejavnikiPrilagoditve.push(`Instalacije obnovljene ${letaInstalacij}`); }
  }

  // Etaža dela stavbe (pritličje ali zadnja etaža = slabše)
  const etaza = part?.etazaDelStavbe;
  const skupajEtaz = stavba.steviloEtaz ?? 1;
  if (etaza != null) {
    if (etaza === 1) {
      adj += 4;
      dejavnikiPrilagoditve.push(`Pritlična enota — večje toplotne izgube skozi tla`);
    } else if (etaza === skupajEtaz) {
      adj += 5;
      dejavnikiPrilagoditve.push(`Enota v zadnji etaži — večje toplotne izgube skozi streho`);
    } else {
      adj -= 2;
      dejavnikiPrilagoditve.push(`Enota v srednji etaži — manjše toplotne izgube`);
    }
  }

  // Višina stavbe
  const visina = stavba.visina;
  if (visina != null && visina > 0) {
    if (visina > 20) {
      adj += 3;
      dejavnikiPrilagoditve.push(`Visoka stavba (${visina.toFixed(0)} m) — večji A/V razmernik`);
    } else if (visina < 7) {
      adj += 2;
      dejavnikiPrilagoditve.push(`Nizka stavba (${visina.toFixed(0)} m) — neugodna oblika`);
    }
  }

  // Tip položaja — izpostavljenost zunanjim stenam
  const tip = stavba.tipPolozaja;
  if (tip === "vmesna vrstna") {
    adj -= 8;
    dejavnikiPrilagoditve.push(`Vmesna vrstna stavba — 2 izpostavljeni fasadi, manj toplotnih izgub`);
  } else if (tip === "vogalna") {
    adj -= 4;
    dejavnikiPrilagoditve.push(`Vogalna stavba — 3 izpostavljene fasade`);
  } else if (tip === "samostojna") {
    adj += 5;
    dejavnikiPrilagoditve.push(`Samostojna stavba — 4 izpostavljene fasade, večje toplotne izgube`);
  }

  const konstr = stavba.konstrukcija?.toLowerCase() ?? "";
  if (konstr.includes("mont") || konstr.includes("panel")) {
    adj += 8;
    dejavnikiPrilagoditve.push(`Montažna konstrukcija — nižja toplotna masa`);
  } else if (konstr.includes("les")) {
    adj += 5;
    dejavnikiPrilagoditve.push(`Lesena konstrukcija`);
  } else if (konstr.includes("masivna") || konstr.includes("opeka") || konstr.includes("beton")) {
    adj -= 3;
    dejavnikiPrilagoditve.push(`Masivna konstrukcija — dobra toplotna masa`);
  }

  // Fix 1: Uporabi ZK GJI gasInfrastructure (zanesljiv) pred prikljucki.plin (nezanesljiv)
  const imaPlin = stavba.gasInfrastructure ?? (stavba.prikljucki?.plin ?? false);
  if (!imaPlin) {
    adj += 5;
    dejavnikiPrilagoditve.push(`Brez plinskega priključka — verjetno električno ogrevanje`);
  }

  // Kompaktnost (1.27 = kvadrat, višje = manj kompaktno, slabše)
  const k = stavba.kompaktnost;
  if (k != null) {
    if (k < 1.4) { adj -= 4; dejavnikiPrilagoditve.push(`Kompaktna oblika stavbe — manjše toplotne izgube`); }
    else if (k > 2.0) { adj += 5; dejavnikiPrilagoditve.push(`Podolgovata oblika stavbe — večje toplotne izgube`); }
    else if (k > 1.7) { adj += 2; dejavnikiPrilagoditve.push(`Nekoliko podolgovata oblika stavbe`); }
  }

  // Orientacija
  const or = stavba.orientacija;
  if (or === "J" || or === "JZ" || or === "JV") {
    adj -= 3;
    dejavnikiPrilagoditve.push(`${or} orientacija — pasivni solarni prispevek`);
  } else if (or === "S" || or === "SV" || or === "SZ") {
    adj += 3;
    dejavnikiPrilagoditve.push(`${or} orientacija — manj solarnih dobitkov`);
  }

  const stDejavnikov = [letaFasade, letaStrehe, letaOken, letaInstalacij].filter(Boolean).length;
  const zaupanje = stDejavnikov >= 3 ? "visoko" : stDejavnikov >= 1 ? "srednje" : "nizko";

  function toRazred(s: number): string {
    const sc = Math.max(0, Math.min(100, s));
    if (sc <= 10) return "A1";
    if (sc <= 18) return "A2";
    if (sc <= 28) return "B1";
    if (sc <= 38) return "B2";
    if (sc <= 50) return "C";
    if (sc <= 62) return "D";
    if (sc <= 72) return "E";
    if (sc <= 82) return "F";
    return "G";
  }

  return {
    razred: toRazred(scoreBaza + adj),
    razredBazni: toRazred(scoreBaza),
    prilagoditev: adj,
    dejavnikiBaza,
    dejavnikiPrilagoditve,
    zaupanje,
  };
}

const zaupanjeColor = {
  visoko: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: "ℹ" },
  srednje: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "⚠" },
  nizko: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "⚠" },
} as const;

const zaupanjeBesedilo = {
  visoko: "Ocena temelji na letu izgradnje in podatkih o vseh večjih prenovah. To ni uradna energetska izkaznica.",
  srednje: "Ocena temelji na delnih podatkih o prenovah. Natančnost je omejena. To ni uradna energetska izkaznica.",
  nizko: "Ocena temelji zgolj na letu izgradnje — podatkov o prenovah nimamo. To ni uradna energetska izkaznica.",
} as const;

const zaupanjeLabel = {
  visoko: "Visoko zaupanje",
  srednje: "Srednje zaupanje",
  nizko: "Nizko zaupanje",
} as const;

function EnergyCertificateSection({ data, stavba, part }: {
  data: EnergyData | null;
  stavba: PropertyCardProps["stavba"];
  part?: PropertyCardProps["deliStavbe"][number] | null;
}) {
  if (!data) {
    const ocena = stavba ? oceniEnergetskiRazred(stavba, part) : null;
    if (!ocena) return (
      <section>
        <Label vir="Register energetskih izkaznic · MOP">Poraba energije</Label>
        <p className="text-sm text-gray-400 italic">
          Energetska izkaznica za to nepremičnino ni vpisana v register.
        </p>
      </section>
    );
    const zc = zaupanjeColor[ocena.zaupanje];
    return (
      <section>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <Label vir="Ocena · multi-faktorski algoritem">Energetsko stanje</Label>
          </div>
          <span className="text-xs text-gray-400 mt-1 ml-2 shrink-0">{zaupanjeLabel[ocena.zaupanje]}</span>
        </div>
        <div className={`flex items-start gap-2 ${zc.bg} border ${zc.border} rounded px-3 py-2 mb-3`}>
          <span className={`${zc.text} text-xs mt-0.5`}>{zc.icon}</span>
          <p className={`text-xs ${zc.text}`}>{zaupanjeBesedilo[ocena.zaupanje]}</p>
        </div>
        {/* Sekcija 1: Standard */}
        <div className="mb-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Osnova · PURES 2010 / EN ISO 52000</p>
          <p className="text-sm text-gray-600">{ocena.dejavnikiBaza[0]}</p>
          <p className="text-xs text-gray-400 mt-0.5">Razred po standardu: <span className="font-medium">{ocena.razredBazni}</span></p>
        </div>
        {/* EnergyMeter prikaže končni razred */}
        <EnergyMeter razred={ocena.razred} />
        {/* Sekcija 2: Prilagoditve */}
        {ocena.dejavnikiPrilagoditve.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
              Prilagoditve · lastni algoritem ({ocena.prilagoditev > 0 ? "+" : ""}{ocena.prilagoditev} točk · razred {ocena.prilagoditev < 0 ? "boljši" : ocena.prilagoditev > 0 ? "slabši" : "nespremenjen"})
            </p>
            <ul className="space-y-0.5">
              {ocena.dejavnikiPrilagoditve.map((d, i) => (
                <li key={i} className="text-xs text-gray-500 flex items-start gap-1">
                  <span className="text-gray-300">·</span><span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section>
      <Label vir="Register energetskih izkaznic · MOP">Poraba energije</Label>
      <div className="space-y-4">
        <div>
          <EnergyMeter razred={data.razred} />
          <div className="text-sm text-gray-500 mt-1">
            <p>Veljavna do {data.veljaDo}</p>
            {data.tip && <p className="mt-0.5">Tip: {data.tip}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <Field
            label="Potrebna toplota"
            value={
              data.potrebnaTopota != null
                ? `${fmtDec(data.potrebnaTopota)} kWh/m\u00B2a`
                : null
            }
          />
          <Field
            label="Dovedena energija"
            value={
              data.dovedenaEnergija != null
                ? `${fmtDec(data.dovedenaEnergija)} kWh/m\u00B2a`
                : null
            }
          />
          <Field
            label="Električna energija"
            value={
              data.elektricnaEnergija != null
                ? `${fmtDec(data.elektricnaEnergija)} kWh/m\u00B2a`
                : null
            }
          />
          <Field
            label="Primarna energija"
            value={
              data.primaryEnergy != null
                ? `${fmtDec(data.primaryEnergy)} kWh/m\u00B2a`
                : null
            }
          />
          <Field
            label={"CO\u2082 emisije"}
            value={data.co2 != null ? `${fmtDec(data.co2)} kg/m\u00B2a` : null}
          />
          <Field
            label="Kondicionirana površina"
            value={
              data.kondicionirana != null
                ? `${fmtDec(data.kondicionirana)} m\u00B2`
                : null
            }
          />
          <Field label="Datum izdaje" value={data.datumIzdaje} />
        </div>
      </div>
    </section>
  );
}

function ParceleSection({ parcele }: { parcele?: Parcela[] }) {
  if (!parcele || parcele.length === 0) return null;
  return (
    <section>
      <Label vir="Zemljiški kataster · GURS">Zemljišče</Label>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[400px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500 text-xs uppercase tracking-wide">
              <th className="pb-2 pr-4 font-medium">Parcela</th>
              <th className="pb-2 pr-4 text-right font-medium">Površina</th>
              <th className="pb-2 pr-4 font-medium">Vrsta rabe</th>
              <th className="pb-2 text-right font-medium">Boniteta</th>
            </tr>
          </thead>
          <tbody>
            {parcele.map((p, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 odd:bg-gray-50">
                <td className="py-2 pr-4">{p.parcelnaStevila}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {p.povrsina != null ? `${fmtDec(p.povrsina)} m\u00B2` : "\u2014"}
                </td>
                <td className="py-2 pr-4">{p.vrstaRabe ?? "\u2014"}</td>
                <td className="py-2 text-right tabular-nums">
                  {p.boniteta != null ? fmtDec(p.boniteta) : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtLastniki(n: number): string {
  if (n === 1) return "1 lastnik";
  if (n >= 2 && n <= 4) return `${n} lastnika`;
  return `${n} lastnikov`;
}

function LastnistvoMultiSection({ deliStavbe }: { deliStavbe: PropertyCardProps["deliStavbe"] }) {
  const all = deliStavbe.flatMap(d => (d.lastnistvo ?? []).map(l => ({ ...l, enota: d.stDela })));
  const MAX_VISIBLE_LASTNIKI = 4;
  const [showAllLastniki, setShowAllLastniki] = useState(false);
  const vidniLastniki = showAllLastniki ? all : all.slice(0, MAX_VISIBLE_LASTNIKI);
  const jePokritih = all.length > MAX_VISIBLE_LASTNIKI;

  if (all.length === 0) return (
    <section>
      <Label vir="Zemljiška knjiga · GURS">Lastništvo</Label>
      <p className="text-sm text-gray-400 italic">Podatki o lastništvu niso dostopni za to stavbo.</p>
    </section>
  );
  return (
    <section>
      <Label vir="Zemljiška knjiga · GURS">Lastništvo</Label>
      <p className="text-xs text-gray-500 mb-3">{fmtLastniki(all.length)}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[400px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500 text-xs tracking-wide">
              <th className="pb-2 pr-4 font-medium">Enota</th>
              <th className="pb-2 pr-4 font-medium">Tip lastnika</th>
              <th className="pb-2 pr-4 font-medium">Delež</th>
              <th className="pb-2 font-medium">Vrsta pravice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {vidniLastniki.map((r, i) => (
              <tr key={i} className="text-gray-700">
                <td className="py-2 pr-4 text-gray-500">{r.enota}</td>
                <td className="py-2 pr-4">{r.tipOsebe}</td>
                <td className="py-2 pr-4 tabular-nums">{r.delez}</td>
                <td className="py-2">{r.tipLastnistva}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jePokritih && (
        <div className="relative">
          {!showAllLastniki && (
            <div className="absolute bottom-8 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          )}
          <button
            onClick={() => setShowAllLastniki(!showAllLastniki)}
            className="w-full mt-1 py-1.5 text-xs text-[#2d6a4f] hover:underline"
          >
            {showAllLastniki ? "Skrij ↑" : `Prikaži vse lastnike (${all.length}) ↓`}
          </button>
        </div>
      )}
    </section>
  );
}

function LastnistvoSection({ data }: { data?: LastnistvoRecord[] }) {
  const MAX_VISIBLE_LASTNIKI = 4;
  const [showAllLastniki, setShowAllLastniki] = useState(false);
  if (!data || data.length === 0) return null;
  const vidniLastniki = showAllLastniki ? data : data.slice(0, MAX_VISIBLE_LASTNIKI);
  const jePokritih = data.length > MAX_VISIBLE_LASTNIKI;
  return (
    <section>
      <Label vir="Zemljiška knjiga · GURS">Lastništvo</Label>
      <p className="text-xs text-gray-500 mb-3">{fmtLastniki(data.length)}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500 text-xs tracking-wide">
              <th className="pb-2 pr-4 font-medium">Tip lastnika</th>
              <th className="pb-2 pr-4 font-medium">Delež</th>
              <th className="pb-2 pr-4 font-medium">Vrsta pravice</th>
              <th className="pb-2 font-medium">Datum vpisa</th>
            </tr>
          </thead>
          <tbody>
            {vidniLastniki.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 odd:bg-gray-50">
                <td className="py-2 pr-4 text-gray-700">
                  {r.tipOsebe}
                  {r.nazivPravneOsebe && (
                    <span className="block text-xs text-gray-400">{r.nazivPravneOsebe}</span>
                  )}
                </td>
                <td className="py-2 pr-4 tabular-nums text-gray-700">{r.delez}</td>
                <td className="py-2 pr-4 text-gray-700">{r.tipLastnistva}</td>
                <td className="py-2 text-gray-700">{r.datumVpisa ? fmtDate(r.datumVpisa) : "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jePokritih && (
        <div className="relative">
          {!showAllLastniki && (
            <div className="absolute bottom-8 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          )}
          <button
            onClick={() => setShowAllLastniki(!showAllLastniki)}
            className="w-full mt-1 py-1.5 text-xs text-[#2d6a4f] hover:underline"
          >
            {showAllLastniki ? "Skrij ↑" : `Prikaži vse lastnike (${data.length}) ↓`}
          </button>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">Vir: GURS zemljiška knjiga. Imena fizičnih oseb niso prikazana (GDPR).</p>
    </section>
  );
}

function RenVrednostSection({ data }: { data?: RenVrednost | null }) {
  if (!data) return null;
  return (
    <section>
      <Label vir="Množično vrednotenje · GURS">Ocenjena vrednost</Label>
      <div className="rounded-lg border border-green-100 bg-green-50 px-5 py-4">
        <p className="text-2xl font-bold text-gray-800">
          {data.vrednost.toLocaleString("sl-SI")} {"\u20AC"}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Vir: GURS množično vrednotenje
          {data.datumOcene ? ` \u2014 ${data.datumOcene}` : ""}
        </p>
      </div>
    </section>
  );
}

function EnergetskiIzracunSection({
  energetskaIzkaznica,
}: {
  energetskaIzkaznica: EnergyData | null;
}) {
  if (
    !energetskaIzkaznica ||
    energetskaIzkaznica.potrebnaTopota == null ||
    energetskaIzkaznica.kondicionirana == null
  )
    return null;

  const heatingNeed = energetskaIzkaznica.potrebnaTopota;
  const area = energetskaIzkaznica.kondicionirana;
  const annualCost = heatingNeed * area * HEATING_PRICE_EUR;

  const targetB2 = 75;
  const targetA2 = 25;
  const costB2 = targetB2 * area * HEATING_PRICE_EUR;
  const costA2 = targetA2 * area * HEATING_PRICE_EUR;
  const savingsB2 = annualCost - costB2;
  const savingsA2 = annualCost - costA2;

  const fasadaArea = Math.sqrt(area) * 12;
  const windowCount = Math.floor(area / 15);
  const roofArea = area * 0.8;

  const improvements = [
    {
      name: "Toplotna izolacija fasade",
      costRange: `${fmt(fasadaArea * 80)} \u2013 ${fmt(fasadaArea * 120)} \u20AC`,
      midCost: fasadaArea * 100,
    },
    {
      name: "Menjava oken",
      costRange: `${fmt(windowCount * 400)} \u2013 ${fmt(windowCount * 800)} \u20AC`,
      midCost: windowCount * 600,
    },
    {
      name: "Toplotna črpalka",
      costRange: "8.000 \u2013 15.000 \u20AC",
      midCost: 11500,
    },
    {
      name: "Strešna izolacija",
      costRange: `${fmt(roofArea * 40)} \u2013 ${fmt(roofArea * 80)} \u20AC`,
      midCost: roofArea * 60,
    },
  ];

  return (
    <section>
      <Label vir="Register energetskih izkaznic · MOP">Stroški ogrevanja</Label>
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <Field
            label="Letni strošek ogrevanja"
            value={`${fmt(annualCost)} \u20AC`}
          />
          <Field
            label="Prihranek do B2"
            value={
              savingsB2 > 0 ? `${fmt(savingsB2)} \u20AC/leto` : "Ni prihranka"
            }
          />
          <Field
            label="Prihranek do A2"
            value={
              savingsA2 > 0 ? `${fmt(savingsA2)} \u20AC/leto` : "Ni prihranka"
            }
          />
        </div>

        <div>
          <SubLabel>Predlagane izboljšave</SubLabel>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[380px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-4 font-medium">Ukrep</th>
                <th className="pb-2 pr-4 text-right font-medium whitespace-nowrap">
                  Ocena stroška
                </th>
                <th className="pb-2 text-right font-medium whitespace-nowrap">ROI (let)</th>
              </tr>
            </thead>
            <tbody>
              {improvements.map((imp) => {
                const roi =
                  savingsB2 > 0 ? imp.midCost / savingsB2 : null;
                return (
                  <tr
                    key={imp.name}
                    className="border-b border-gray-50 last:border-0 odd:bg-gray-50"
                  >
                    <td className="py-2 pr-4 text-gray-700">{imp.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                      {imp.costRange}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-700">
                      {roi != null ? `~${Math.round(roi)}` : "\u2014"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function VrednostnaAnalizaSection({ data }: { data?: EtnAnaliza | null }) {
  if (!data) return null;

  const trendArrow =
    data.trend === "rast"
      ? "\u2191"
      : data.trend === "padec"
        ? "\u2193"
        : data.trend === "stabilno"
          ? "\u2192"
          : null;

  const trendColor =
    data.trend === "rast"
      ? "text-green-700"
      : data.trend === "padec"
        ? "text-red-700"
        : "text-gray-600";

  return (
    <section>
      <Label vir="Evidenca trga nepremičnin · GURS">Prodajne cene v okolici</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <Field
          label="Povprečna cena/m²"
          value={`${data.povprecnaCenaM2.toLocaleString("sl-SI")} \u20AC`}
        />
        <Field
          label="Min cena/m²"
          value={`${data.minCenaM2.toLocaleString("sl-SI")} \u20AC`}
        />
        <Field
          label="Max cena/m²"
          value={`${data.maxCenaM2.toLocaleString("sl-SI")} \u20AC`}
        />
        <Field label="Št. transakcij" value={data.steviloTransakcij.toLocaleString("sl-SI")} />
        {data.ocenjenaTrznaVrednost != null && (
          <Field
            label="Ocenjena tržna vrednost"
            value={`${data.ocenjenaTrznaVrednost.toLocaleString("sl-SI")} \u20AC`}
          />
        )}
        {data.trend && (
          <div>
            <span className="text-gray-500 text-xs">Trend</span>
            <p className={`font-medium ${trendColor}`}>
              {trendArrow}{" "}
              {data.trend === "rast"
                ? "Rast"
                : data.trend === "padec"
                  ? "Padec"
                  : "Stabilno"}
              {data.zadnjeLeto != null && data.predLeto != null && (
                <span className="text-xs text-gray-400 ml-1.5">
                  ({data.predLeto.toLocaleString("sl-SI")} &rarr;{" "}
                  {data.zadnjeLeto.toLocaleString("sl-SI")} \u20AC/m²)
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

const MAINTENANCE_ITEMS = [
  { name: "Fasada", lifespan: 30, key: "fasade" as const },
  { name: "Strešna kritina", lifespan: 40, key: "strehe" as const },
  { name: "Instalacije", lifespan: 30, key: "instalacije" as const },
  { name: "Okna", lifespan: 25, key: "okna" as const },
];

function MaintenanceSection({
  stavba,
  part,
}: {
  stavba: PropertyCardProps["stavba"];
  part: DelStavbe | null;
}) {
  const currentYear = 2026;
  const baseYear = stavba.letoIzgradnje;
  if (!baseYear) return null;

  const items: {
    name: string;
    age: number;
    lifespan: number;
    urgency: string;
    borderColor: string;
    pillClass: string;
  }[] = [];

  const noDataItems: string[] = [];

  for (const m of MAINTENANCE_ITEMS) {
    let letoObnove: number | null = null;
    if (m.key === "fasade") {
      letoObnove = stavba.letoObnove.fasade;
    } else if (m.key === "strehe") {
      letoObnove = stavba.letoObnove.strehe;
    } else if (m.key === "instalacije") {
      letoObnove = part?.letoObnoveInstalacij ?? null;
    } else if (m.key === "okna") {
      letoObnove = part?.letoObnoveOken ?? null;
    }

    if (!letoObnove) {
      noDataItems.push(m.name);
      continue;
    }

    const age = currentYear - letoObnove;
    if (age >= m.lifespan) {
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "Nujno",
        borderColor: "border-l-red-500",
        pillClass: "bg-red-50 text-red-700",
      });
    } else if (age >= m.lifespan * 0.85) {
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "Priporočeno",
        borderColor: "border-l-amber-400",
        pillClass: "bg-amber-50 text-amber-700",
      });
    } else if (age >= m.lifespan * 0.7) {
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "Planirati",
        borderColor: "border-l-green-400",
        pillClass: "bg-green-50 text-green-700",
      });
    }
  }

  return (
    <section>
      <Label vir="Kataster nepremičnin · GURS">Kdaj je potrebno vzdrževanje</Label>
      {items.length === 0 && noDataItems.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          Ni nujnih vzdrževalnih posegov
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.name}
              className={`flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 border-l-4 ${item.borderColor} bg-white px-4 py-3 text-sm`}
            >
              <div className="text-gray-700 min-w-0">
                <span className="font-medium">{item.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  ({item.age}/{item.lifespan} let)
                </span>
              </div>
              <span
                className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${item.pillClass}`}
              >
                {item.urgency}
              </span>
            </div>
          ))}
          {noDataItems.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between rounded border border-gray-100 border-l-4 border-l-gray-300 bg-white px-4 py-3 text-sm"
            >
              <span className="text-gray-500">{name}</span>
              <span className="text-xs text-gray-400 italic">Ni podatka o zadnji obnovi</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CollapsibleValueSection({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-t border-gray-100 pt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left group min-h-[44px] py-2"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-800">Vrednost in lastništvo</h3>
          <p className="text-xs text-gray-400 mt-0.5">Ocenjena vrednost, transakcije, lastništvo, parcele</p>
        </div>
        <span className="flex-shrink-0 flex items-center justify-center w-11 h-11 text-gray-400 text-lg ml-4 group-hover:text-gray-600 transition-colors">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="mt-6 space-y-8">{children}</div>}
    </div>
  );
}

function StreetViewEmbed({ lat, lng, naslov }: { lat: number | null | undefined; lng: number | null | undefined; naslov: string }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!lat || !lng || !apiKey) return null;
  const url = `https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${lat},${lng}&fov=80&pitch=5&source=outdoor`;
  return (
    <div className="print:hidden">
      <div className="relative rounded-lg overflow-hidden">
        <iframe
          src={url}
          className="w-full h-[200px] border-0"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={`Street View: ${naslov}`}
        />
      </div>
      <p className="text-[10px] text-gray-400 mt-1 text-right">Vir: Google Street View · Povlecite za rotacijo</p>
    </div>
  );
}

function AerialMap({
  lat,
  lng,
  naslov,
  showStreetView = true,
}: {
  lat?: number | null;
  lng?: number | null;
  naslov: string;
  showStreetView?: boolean;
}) {
  const apiKey = typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    : null;

  const mapsUrl = lat && lng
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : `https://www.google.com/maps/search/${encodeURIComponent(naslov)}`;

  if (!lat || !lng || !apiKey) {
    return (
      <div className="print:hidden">
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          className="block text-center text-sm text-[#2d6a4f] hover:underline py-3 border border-gray-100 rounded-lg bg-gray-50">
          Odpri v Google Maps
        </a>
      </div>
    );
  }

  const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=600x200&scale=2&maptype=hybrid&markers=color:red%7C${lat},${lng}&key=${apiKey}`;

  return (
    <div className="print:hidden space-y-2">
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={staticUrl}
          alt={`Satelitski posnetek: ${naslov}`}
          className="w-full h-[160px] object-cover rounded-lg"
          loading="lazy"
        />
      </a>
      <p className="text-[10px] text-gray-400">Vir: Google Maps · Satelitski posnetek</p>
    </div>
  );
}

function ServicesSection() {
  const cards = [
    {
      title: "Kredit za prenovo",
      desc: "Primerjajte ponudbe bank za stanovanjski kredit",
    },
    {
      title: "Zavarovanje nepremičnine",
      desc: "Zavarovajte svojo naložbo po ugodni ceni",
    },
    {
      title: "Energetska sanacija",
      desc: "Preverite subvencije Eko sklada za energetsko prenovo",
    },
  ];

  return (
    <section>
      <Label>Uredite z enim klikom</Label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.title}
            className="rounded-md border border-gray-100 bg-white p-5 shadow-sm"
          >
            <h5 className="font-medium text-sm text-gray-800">{c.title}</h5>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              {c.desc}
            </p>
            <span className="inline-block mt-3 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-400">
              Kmalu
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
