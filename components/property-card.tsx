"use client";

import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { CreditCalculator } from "./credit-calculator";
import type { SeizmicniPodatki, PoplavnaNevarnost } from "@/lib/arso-api";
import { izracunajOcenaStanja } from "@/lib/gurs-api";

const CadastralMap = dynamic(() => import("./cadastral-map"), { ssr: false });

// Info tooltip — prikaže razlagalni tekst ob hover
function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold hover:bg-gray-300 transition-colors leading-none cursor-help ml-1"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label="Več informacij"
      >
        i
      </button>
      {visible && (
        <span className="absolute z-50 top-1/2 -translate-y-1/2 left-full ml-2 w-56 bg-gray-800 text-white text-[11px] rounded px-3 py-2 shadow-lg pointer-events-none leading-relaxed whitespace-normal">
          {text}
          <span className="absolute top-1/2 -translate-y-1/2 right-full border-4 border-transparent border-r-gray-800" />
        </span>
      )}
    </span>
  );
}

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
  vrednotenje?: {
    posplosenaVrednost: number | null;
    vrednostNaM2: number | null;
    idModel: string | null;
    letoIzgradnje: number | null;
    povrsina: number | null;
  } | null;
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
    gasInfrastructure?: { found: boolean; distanceM: number | null; confidence: string } | null;
    visina?: number | null;
    tipPolozaja?: "samostojna" | "vogalna" | "vmesna vrstna" | null;
    orientacija?: "S" | "SV" | "V" | "JV" | "J" | "JZ" | "Z" | "SZ" | null;
    kompaktnost?: number | null;
    obrisGeom?: { type: "Polygon"; coordinates: number[][][] } | null;
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
  seizmicniPodatki?: SeizmicniPodatki | null;
  poplavnaNevarnost?: PoplavnaNevarnost | null;
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

// ─────────────────────────────────────────────────────────────
// COLLAPSIBLE SECTION WRAPPER
// ─────────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  vir,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  vir?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">{title}</span>
          {badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">{badge}</span>}
          {vir && <span className="text-[10px] text-gray-400 font-normal normal-case">{vir}</span>}
        </div>
        <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
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
  seizmicniPodatki,
  poplavnaNevarnost,
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
            <h1 className="text-2xl sm:text-3xl font-bold print:text-[#2d6a4f] break-words leading-tight">
              {naslov}
            </h1>
            <p className="text-sm text-green-200 print:text-gray-500 mt-1">
              Pregled podatkov o nepremičnini
            </p>
          </div>
          <button
            onClick={() => window.print()}
            title="Izvozi poročilo o nepremičnini"
            className="print:hidden flex-shrink-0 rounded border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors whitespace-nowrap shadow-sm"
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

      {/* 2-stolpčni layout: levi stolpec + desni sidebar */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">

        {/* ── LEVI STOLPEC — primarna vsebina ── */}
        <div className="w-full lg:flex-1 min-w-0 space-y-0">

          {/* 1. Ključni podatki — vedno odprto */}
          <div className="px-5 py-5 border-b border-gray-100">
            <KljucniPodatki stavba={stavba} deliStavbe={deliStavbe} />
          </div>

          {/* 2. O stavbi — zložljivo, privzeto ZAPRTO */}
          <CollapsibleSection title="O stavbi" vir="Kataster nepremičnin · GURS" defaultOpen={false}>
            <BuildingSection stavba={stavba} />
          </CollapsibleSection>

          {/* Stanovanja in prostori (multi-unit selector) */}
          {isMultiUnit && !activePart && (
            <div className="px-5 py-5 border-b border-gray-100">
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
                      className={`rounded-md text-left cursor-pointer transition-all ${
                        selectedDel === d.stDela
                          ? "bg-green-50 border border-gray-200 border-l-4 border-l-[#2d6a4f] pl-3 py-3 pr-4"
                          : "bg-white border border-gray-100 px-4 py-3 hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-gray-800">Enota {d.stDela}</span>
                      </div>
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
            </div>
          )}

          {isMultiUnit && activePart && (
            <div className="px-5 py-5 border-b border-gray-100">
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
            </div>
          )}

          {!isMultiUnit && filteredParts.length > 0 && (
            <div className="px-5 py-5 border-b border-gray-100">
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
            </div>
          )}

          {/* 3. Stanje — vedno odprto */}
          <div className="px-5 py-5 border-b border-gray-100">
            <MaintenanceSection stavba={stavba} part={currentPart} />
          </div>

          {/* 4. Energetsko stanje — vedno odprto */}
          <div className="px-5 py-5 border-b border-gray-100">
            <EnergyCertificateSection data={energetskaIzkaznica} stavba={stavba} part={currentPart} lat={lat} lng={lng} />
          </div>

          {/* 5. Predlagani ukrepi — zložljivo, privzeto ODPRTO */}
          {stavba && (() => {
            const hasUnit = !!(activePart || requestedDel != null);
            const unitArea = currentPart?.uporabnaPovrsina ?? currentPart?.povrsina ?? null;
            const totalArea = stavba.povrsina ?? null;
            const stStan = stavba.steviloStanovanj;
            let delezSkupnih: string | null = null;
            if (hasUnit) {
              if (unitArea && totalArea && totalArea > 0) {
                const d = Math.round(totalArea / unitArea);
                delezSkupnih = d > 1 ? `1/${d}` : null;
              } else if (stStan && stStan > 1) {
                delezSkupnih = `1/${stStan}`;
              }
            }
            const varstvo = jeVVarstveniConi(lat, lng);
            const ukrepi = predlagajUkrepe(stavba, currentPart, delezSkupnih, null, varstvo);
            if (ukrepi.length === 0) return null;
            return (
              <CollapsibleSection title="Predlagani ukrepi" vir="ZRMK/IZS referenčne cene 2024" defaultOpen={true}>
                <EnergetskiUkrepiSection
                  ukrepi={ukrepi}
                  delez={delezSkupnih}
                  varstvo={varstvo}
                  lat={lat}
                  lng={lng}
                  isMultiUnit={isMultiUnit}
                  hasSelectedUnit={hasUnit}
                  unitLabel={currentPart ? `Del ${currentPart.stDela}` : null}
                />
              </CollapsibleSection>
            );
          })()}

          {/* 6. Stroški ogrevanja — samo če imamo EIZ podatke */}
          {!(isMultiUnit && !(!!activePart || requestedDel != null)) &&
           energetskaIzkaznica?.potrebnaTopota != null &&
           energetskaIzkaznica?.kondicionirana != null && (
            <div className="px-5 py-5 border-b border-gray-100">
              <EnergetskiIzracunSection
                energetskaIzkaznica={energetskaIzkaznica}
                unitArea={currentPart?.uporabnaPovrsina ?? currentPart?.povrsina ?? null}
                isMultiUnit={isMultiUnit}
                hasSelectedUnit={!!activePart || requestedDel != null}
                unitLabel={currentPart ? `Del ${currentPart.stDela}` : null}
              />
            </div>
          )}

          {/* 7. Zavarovanje nepremičnine — zložljivo, privzeto ZAPRTO */}
          <CollapsibleSection title="Zavarovanje nepremičnine" vir="ARSO · Eurocode 8" defaultOpen={false}>
            <ZavarovanjeSection
              naslov={naslov}
              stavba={stavba}
              seizmicniPodatki={seizmicniPodatki ?? null}
              etaze={stavba.steviloEtaz}
              poplavnaNevarnost={poplavnaNevarnost ?? null}
              unitArea={activePart?.uporabnaPovrsina ?? activePart?.povrsina ?? null}
            />
          </CollapsibleSection>

          {/* 8. Tržne transakcije (ETN) — zložljivo, privzeto ZAPRTO */}
          {etnAnaliza && (
            <CollapsibleSection title="Tržne transakcije" vir="ETN · GURS" defaultOpen={false}>
              <VrednostnaAnalizaSection data={etnAnaliza} />
            </CollapsibleSection>
          )}

          {/* Ocenjena vrednost — premaknjeno v desni sidebar */}

          {/* 9. Storitve — vedno odprto */}
          <div className="px-5 py-5 border-b border-gray-100">
            <ServicesSection />
          </div>

          {/* Izračunaj kredit */}
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

        {/* ── DESNI SIDEBAR — referenčni podatki ── */}
        <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 space-y-3 lg:sticky lg:top-4 p-4 lg:pl-0 lg:pr-4 lg:pt-4">

          {/* 1. Katastrski načrt z uradnimi mejami parcel (GURS WFS) */}
          {lat && lng && (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <CadastralMap
                lat={lat} lng={lng} naslov={naslov}
                koId={enolicniId.koId} stStavbe={enolicniId.stStavbe}
                obrisGeom={stavba?.obrisGeom ?? null}
                parcelGeoms={parcele ?? null}
              />
              <div className="px-3 py-1.5 bg-white border-t border-gray-100 flex gap-4 text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 bg-red-500 opacity-60 rounded-sm" /> Stavba (KN)</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t-2 border-dashed border-blue-600" /> Parcela (KN)</span>
                <span className="ml-auto">Vir: GURS DOF · KN</span>
              </div>
            </div>
          )}

          {/* Street View */}
          {lat && lng && (
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 py-3">
                <StreetViewEmbed lat={lat} lng={lng} naslov={naslov} />
              </div>
            </div>
          )}

          {/* 2. Ocenjena vrednost */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <OcenaVrednostiSection
              renVrednost={renVrednost}
              currentPartVrednotenje={currentPart?.vrednotenje}
              deliStavbe={deliStavbe}
              hasSelectedUnit={!!(activePart || requestedDel != null)}
            />
          </div>

          {/* 3. Lastništvo */}
          {(() => {
            const lastnistvoData = isMultiUnit && !activePart
              ? null
              : (currentPart?.lastnistvo ?? (deliStavbe.length === 1 ? deliStavbe[0].lastnistvo : null));
            if (isMultiUnit && !activePart) {
              return (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                  <LastnistvoMultiSection deliStavbe={deliStavbe} />
                </div>
              );
            }
            return (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <LastnistvoSection data={lastnistvoData ?? []} />
              </div>
            );
          })()}

          {/* 3. Parcele */}
          {parcele && parcele.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <ParceleSection parcele={parcele} />
            </div>
          )}

          {/* 4. O naslovu — referenčni podatki */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">O naslovu</p>
            <div className="space-y-1 text-xs text-gray-600">
              {lat != null && lng != null && (
                <p>Koordinate: {lat.toFixed(6)}, {lng.toFixed(6)}</p>
              )}
              <p>KO ID: {enolicniId.koId}</p>
              <p>Št. stavbe: {enolicniId.stStavbe}</p>
              {enolicniId.stDelaStavbe != null && (
                <p>Št. dela stavbe: {enolicniId.stDelaStavbe}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CC 4.0 attribution footer */}
      <div className="text-[10px] text-gray-300 px-6 py-3 border-t border-gray-100 text-center">
        Podatki: GURS (Kataster nepremičnin, Zemljiška knjiga, ETN) &middot; MOP (Register energetskih izkaznic) &middot; Licenca: CC BY 4.0
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
    <div className="border-b border-gray-100 pb-1 mb-3">
      <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
        {children}
      </h4>
      {vir && (
        <p className="text-xs text-gray-400 italic mt-0.5">Vir: {vir}</p>
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
      <p className="text-sm text-gray-800">{value}</p>
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

function PropertySummary({ stavba, deliStavbe: _deliStavbe, energetskaIzkaznica }: {
  stavba: PropertyCardProps["stavba"];
  deliStavbe: PropertyCardProps["deliStavbe"];
  energetskaIzkaznica: PropertyCardProps["energetskaIzkaznica"];
}) {
  if (!stavba || !stavba.letoIzgradnje) return null;

  const conditionOcena = izracunajOcenaStanja({
    letoIzgradnje: stavba.letoIzgradnje,
    letoObnove: stavba.letoObnove,
    konstrukcija: stavba.konstrukcija,
  });

  // Kratka energetska oznaka
  let energetskiRazredStr = "";
  if (energetskaIzkaznica?.razred) {
    energetskiRazredStr = `Energetski razred: ${energetskaIzkaznica.razred}.`;
  } else if (stavba.letoIzgradnje) {
    // Algoritmična ocena — samo razred
    const algoOcena = oceniEnergetskiRazred(stavba);
    if (algoOcena) energetskiRazredStr = `Algoritmični energetski razred: ${algoOcena.razred}.`;
  }

  const conditionStr = conditionOcena
    ? `Ocena stanja: ${conditionOcena.ocena}/100 (${conditionOcena.razred}).`
    : null;

  const povzetekStr = [conditionStr, energetskiRazredStr].filter(Boolean).join(" ");
  if (!povzetekStr) return null;

  return (
    <div className="text-sm text-gray-600 leading-relaxed border-l-4 border-gray-200 pl-4 py-1">
      <p>{povzetekStr}</p>
      <p className="text-[10px] text-gray-400 mt-1">Ocena na podlagi podatkov Katastra nepremičnin · GURS</p>
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
            <p className="text-4xl font-bold text-gray-900 tabular-nums whitespace-nowrap">{s.value}</p>
            <p className="text-xs text-gray-400 mt-1.5 uppercase tracking-wide">{s.label}</p>
          </div>
        ))}
      </div>
      {/* ConditionScoreBar skrita — algoritmična ocena zaenkrat ni prikazana */}
    </section>
  );
}

const CONDITION_COLORS = {
  green: { bar: "bg-green-500", text: "text-green-700", bg: "bg-green-50" },
  lime: { bar: "bg-lime-500", text: "text-lime-700", bg: "bg-lime-50" },
  amber: { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  orange: { bar: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50" },
  red: { bar: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
};

function ConditionScoreBar({ stavba }: { stavba: PropertyCardProps["stavba"] }) {
  const ocena = izracunajOcenaStanja({
    letoIzgradnje: stavba.letoIzgradnje,
    letoObnove: stavba.letoObnove,
    konstrukcija: stavba.konstrukcija,
  });
  if (!ocena) return null;
  const c = CONDITION_COLORS[ocena.color];
  return (
    <div className={`rounded-lg p-3 ${c.bg} mt-4`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600">Ocena stanja stavbe</span>
        <span className={`text-sm font-bold ${c.text}`}>{ocena.ocena}/100 — {ocena.razred.charAt(0).toUpperCase() + ocena.razred.slice(1)}</span>
      </div>
      <div className="w-full bg-white rounded-full h-2 overflow-hidden">
        <div className={`${c.bar} h-2 rounded-full transition-all`} style={{ width: `${ocena.ocena}%` }} />
      </div>
      <p className="text-xs text-gray-500 mt-1.5">{ocena.opis}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">Formula: ISO 15686-7 · prilagojeno za Slovenijo</p>
    </div>
  );
}

function BuildingSection({ stavba }: { stavba: PropertyCardProps["stavba"] }) {
  return (
    <section>
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
        {(() => {
          const g = stavba.gasInfrastructure;
          if (stavba.prikljucki.plin) return <span><Check on={true} /> Plin <span className="ml-1 text-xs text-gray-400">KN · GURS</span></span>;
          if (g?.confidence === "high") return <span><Check on={true} /> Plin <span className="ml-1 text-xs text-gray-400">ZK GJI ~{g.distanceM}m</span></span>;
          if (g?.confidence === "medium") return <span className="text-gray-500">~ Plin v bližini <span className="text-xs text-gray-400">ZK GJI ~{g.distanceM}m</span></span>;
          if (g?.confidence === "low") return <span className="text-gray-400">~ Plin v okolici <span className="text-xs">ZK GJI ~{g.distanceM}m</span></span>;
          return <span><Check on={false} /> Plin</span>;
        })()}
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
        {/* Namembnost (KN) hidden - WFS vrača napačne vrednosti; prikazati ko bo KN bulk import */}
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
              {part.prostori.filter(r => r.povrsina == null || r.povrsina > 0).map((r, i) => (
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
  // Enakomerni koraki: 20, 30, 40, 50, 60, 70, 80, 90, 100
  const classes = [
    { label: "A1", color: "#1a9f3f", w: 20 },
    { label: "A2", color: "#4caf50", w: 30 },
    { label: "B1", color: "#8bc34a", w: 40 },
    { label: "B2", color: "#c0ca33", w: 50 },
    { label: "C",  color: "#f0b429", w: 60 },
    { label: "D",  color: "#ffa000", w: 70 },
    { label: "E",  color: "#e65100", w: 80 },
    { label: "F",  color: "#d32f2f", w: 90 },
    { label: "G",  color: "#8b0000", w: 100 },
  ];

  return (
    <div className="my-3 w-full max-w-[320px] flex flex-col gap-[2px]">
      {classes.map((c) => {
        const isActive = c.label === razred;
        return (
          <div key={c.label} style={{ width: `${c.w}%` }}>
            <div
              style={{
                backgroundColor: isActive ? c.color : `${c.color}55`,
                height: isActive ? "26px" : "19px",
                clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)",
                display: "flex",
                alignItems: "center",
                paddingLeft: isActive ? "8px" : "4px",
                paddingRight: "16px",
                justifyContent: "space-between",
                boxShadow: isActive ? `0 1px 6px ${c.color}55` : "none",
              }}
            >
              <span style={{ fontSize: "10px", color: isActive ? "#fff" : "transparent", fontWeight: 700 }}>▶</span>
              <span style={{
                fontSize: isActive ? "12px" : "10px",
                fontWeight: "700",
                color: isActive ? "#fff" : c.color,
                lineHeight: 1,
              }}>
                {c.label}
              </span>
            </div>
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
  gasInfrastructure?: { found: boolean; distanceM: number | null; confidence: string } | null;
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

  // Faza 1 - Standard (PURES 2010 / EN ISO 52000): samo leto izgradnje
  let scoreBaza = 0;
  if (leto < 1946)      { scoreBaza = 95; dejavnikiBaza.push(`Zgrajeno pred 1946 - brez toplotne zaščite`); }
  else if (leto < 1960) { scoreBaza = 88; dejavnikiBaza.push(`Zgrajeno ${leto} - predvojna gradnja`); }
  else if (leto < 1974) { scoreBaza = 82; dejavnikiBaza.push(`Zgrajeno ${leto} - pred energetsko krizo`); }
  else if (leto < 1980) { scoreBaza = 74; dejavnikiBaza.push(`Zgrajeno ${leto} - začetek toplotne izolacije`); }
  else if (leto < 1988) { scoreBaza = 68; dejavnikiBaza.push(`Zgrajeno ${leto} - minimalni standardi`); }
  else if (leto < 1994) { scoreBaza = 60; dejavnikiBaza.push(`Zgrajeno ${leto} - JUS standardi`); }
  else if (leto < 2002) { scoreBaza = 52; dejavnikiBaza.push(`Zgrajeno ${leto} - delna toplotna izolacija`); }
  else if (leto < 2006) { scoreBaza = 42; dejavnikiBaza.push(`Zgrajeno ${leto} - PURES 2002`); }
  else if (leto < 2010) { scoreBaza = 36; dejavnikiBaza.push(`Zgrajeno ${leto} - PURES 2002 (strožji)`); }
  else if (leto < 2013) { scoreBaza = 28; dejavnikiBaza.push(`Zgrajeno ${leto} - PURES 2010`); }
  else if (leto < 2016) { scoreBaza = 22; dejavnikiBaza.push(`Zgrajeno ${leto} - PURES 2010 (strožji)`); }
  else if (leto < 2021) { scoreBaza = 15; dejavnikiBaza.push(`Zgrajeno ${leto} - nizko-energijska gradnja`); }
  else                  { scoreBaza = 8;  dejavnikiBaza.push(`Zgrajeno ${leto} - skoraj nič-energijska gradnja`); }

  // Faza 2 - Prilagoditve (naš algoritem): vse korekcije v točkah (negativno = boljše)
  let adj = 0;

  const letaFasade = stavba.letoObnove.fasade;
  if (letaFasade) {
    const starost = zdaj - letaFasade;
    if (starost <= 5)       { adj -= 22; dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade} - nova toplotna izolacija`); }
    else if (starost <= 10) { adj -= 18; dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade} - dobra toplotna izolacija`); }
    else if (starost <= 20) { adj -= 10; dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade} - delna izboljšava`); }
    else                    { adj -= 4;  dejavnikiPrilagoditve.push(`Fasada obnovljena ${letaFasade}`); }
  }

  const letaStrehe = stavba.letoObnove.strehe;
  if (letaStrehe) {
    const starost = zdaj - letaStrehe;
    if (starost <= 5)       { adj -= 10; dejavnikiPrilagoditve.push(`Streha obnovljena ${letaStrehe} - nova toplotna zaščita`); }
    else if (starost <= 15) { adj -= 7;  dejavnikiPrilagoditve.push(`Streha obnovljena ${letaStrehe}`); }
    else                    { adj -= 3;  dejavnikiPrilagoditve.push(`Streha obnovljena ${letaStrehe}`); }
  }

  const letaOken = part?.letoObnoveOken;
  if (letaOken) {
    const starost = zdaj - letaOken;
    if (starost <= 5)       { adj -= 10; dejavnikiPrilagoditve.push(`Okna obnovljena ${letaOken} - energijsko varčna okna`); }
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
      dejavnikiPrilagoditve.push(`Pritlična enota - večje toplotne izgube skozi tla`);
    } else if (etaza === skupajEtaz) {
      adj += 5;
      dejavnikiPrilagoditve.push(`Enota v zadnji etaži - večje toplotne izgube skozi streho`);
    } else {
      adj -= 2;
      dejavnikiPrilagoditve.push(`Enota v srednji etaži - manjše toplotne izgube`);
    }
  }

  // Višina stavbe
  const visina = stavba.visina;
  if (visina != null && visina > 0) {
    if (visina > 20) {
      adj += 3;
      dejavnikiPrilagoditve.push(`Visoka stavba (${visina.toFixed(0)} m) - večji A/V razmernik`);
    } else if (visina < 7) {
      adj += 2;
      dejavnikiPrilagoditve.push(`Nizka stavba (${visina.toFixed(0)} m) - neugodna oblika`);
    }
  }

  // Tip položaja - izpostavljenost zunanjim stenam
  const tip = stavba.tipPolozaja;
  if (tip === "vmesna vrstna") {
    adj -= 8;
    dejavnikiPrilagoditve.push(`Vmesna vrstna stavba - 2 izpostavljeni fasadi, manj toplotnih izgub`);
  } else if (tip === "vogalna") {
    adj -= 4;
    dejavnikiPrilagoditve.push(`Vogalna stavba - 3 izpostavljene fasade`);
  } else if (tip === "samostojna") {
    adj += 5;
    dejavnikiPrilagoditve.push(`Samostojna stavba - 4 izpostavljene fasade, večje toplotne izgube`);
  }

  const konstr = stavba.konstrukcija?.toLowerCase() ?? "";
  if (konstr.includes("mont") || konstr.includes("panel")) {
    adj += 8;
    dejavnikiPrilagoditve.push(`Montažna konstrukcija - nižja toplotna masa`);
  } else if (konstr.includes("les")) {
    adj += 5;
    dejavnikiPrilagoditve.push(`Lesena konstrukcija`);
  } else if (konstr.includes("masivna") || konstr.includes("opeka") || konstr.includes("beton")) {
    adj -= 3;
    dejavnikiPrilagoditve.push(`Masivna konstrukcija - dobra toplotna masa`);
  }

  // Fix 1: Uporabi ZK GJI gasInfrastructure (zanesljiv) pred prikljucki.plin (nezanesljiv)
  const imaPlin = stavba.prikljucki?.plin || stavba.gasInfrastructure?.confidence === "high" || false;
  if (!imaPlin) {
    adj += 5;
    dejavnikiPrilagoditve.push(`Brez plinskega priključka - verjetno električno ogrevanje`);
  }

  // Kompaktnost (1.27 = kvadrat, višje = manj kompaktno, slabše)
  const k = stavba.kompaktnost;
  if (k != null) {
    if (k < 1.4) { adj -= 4; dejavnikiPrilagoditve.push(`Kompaktna oblika stavbe - manjše toplotne izgube`); }
    else if (k > 2.0) { adj += 5; dejavnikiPrilagoditve.push(`Podolgovata oblika stavbe - večje toplotne izgube`); }
    else if (k > 1.7) { adj += 2; dejavnikiPrilagoditve.push(`Nekoliko podolgovata oblika stavbe`); }
  }

  // Orientacija
  const or = stavba.orientacija;
  if (or === "J" || or === "JZ" || or === "JV") {
    adj -= 3;
    dejavnikiPrilagoditve.push(`${or} orientacija - pasivni solarni prispevek`);
  } else if (or === "S" || or === "SV" || or === "SZ") {
    adj += 3;
    dejavnikiPrilagoditve.push(`${or} orientacija - manj solarnih dobitkov`);
  }

  const stDejavnikov = [letaFasade, letaStrehe, letaOken, letaInstalacij].filter(Boolean).length;
  // Algoritmična ocena brez uradne EIZ ne more biti "visoko zaupanje"
  const zaupanje = stDejavnikov >= 1 ? "srednje" : "nizko";

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
  visoko: "Ocena temelji na uradni energetski izkaznici.",
  srednje: "Ocena na podlagi gradbenega obdobja, evidentiranih obnov, konstrukcije, lege enote in tipa stavbe. Ni uradna energetska izkaznica.",
  nizko: "Ocena temelji samo na letu izgradnje — podatkov o prenovah ni. Napaka ocene je visoka. Ni uradna energetska izkaznica.",
} as const;

const zaupanjeLabel = {
  visoko: "Uradna izkaznica",
  srednje: "Algoritmična ocena",
  nizko: "Nizka zanesljivost",
} as const;

// --- Energetski ukrepi ---

interface Ukrep {
  naziv: string;
  nivo: "enota" | "skupno" | "stavba"; // enota=individualno, skupno=skupni deli, stavba=cela stavba (ne per-unit)
  opis: string;
  strosekMin: number;
  strosekMax: number;
  skupniStrosekMin?: number; // za deljene ukrepe: skupni strošek objekta
  skupniStrosekMax?: number;
  osnova: string;
  prioriteta: "visoka" | "srednja" | "nizka";
  dobaPovrnitveMin: number;
  dobaPovrnitveMax: number;
  varstvoCene?: boolean; // true = cene prilagojene za kulturno dediščino
  vrednostDvig?: number; // % ocenjenega dviga vrednosti nepremičnine po izvedbi
  kategorija: "vzdrzevanje" | "energetika";
}

function izracunajROI(ukrep: string, strosekSrednji: number, povrsina: number | null): { min: number; max: number } {
  const p = povrsina ?? 60;
  switch (ukrep) {
    case "okna":
      return { min: Math.round(strosekSrednji / (p * 12)), max: Math.round(strosekSrednji / (p * 8)) };
    case "fasada":
      // ~120 kWh/m²/yr × 25% redukcija × 0.10 €/kWh = 3 €/m²/yr prihranek
      return { min: Math.round(strosekSrednji / (p * 3.5)), max: Math.round(strosekSrednji / (p * 2)) };
    case "streha":
      // ~120 kWh/m²/yr × 15% redukcija × 0.10 €/kWh = 1.8 €/m²/yr prihranek
      return { min: Math.round(strosekSrednji / (p * 2.5)), max: Math.round(strosekSrednji / (p * 1.5)) };
    case "ogrevanje":
      return { min: Math.round(strosekSrednji / 400), max: Math.round(strosekSrednji / 200) };
    default:
      return { min: Math.round(strosekSrednji / 300), max: Math.round(strosekSrednji / 150) };
  }
}

// Varstvo kulturne dediščine - geometrijska detekcija
const VARSTVENA_OBMOCJA = [
  { naziv: "Ljubljana - Staro mestno jedro (EUP LJ-411)", latMin: 46.044, latMax: 46.052, lngMin: 14.500, lngMax: 14.513 },
  { naziv: "Ljubljana - Mestni trg in okolica", latMin: 46.046, latMax: 46.051, lngMin: 14.503, lngMax: 14.511 },
  { naziv: "Piran - Staro mestno jedro", latMin: 45.525, latMax: 45.532, lngMin: 13.566, lngMax: 13.577 },
  { naziv: "Ptuj - Zgodovinsko mestno jedro", latMin: 46.418, latMax: 46.423, lngMin: 15.868, lngMax: 15.880 },
  { naziv: "Kranj - Staro mestno jedro", latMin: 46.237, latMax: 46.242, lngMin: 14.354, lngMax: 14.363 },
  { naziv: "Maribor - Staro mestno jedro", latMin: 46.556, latMax: 46.562, lngMin: 15.644, lngMax: 15.652 },
];

function jeVVarstveniConi(lat: number | null | undefined, lng: number | null | undefined): { varuje: boolean; naziv: string | null } {
  if (!lat || !lng) return { varuje: false, naziv: null };
  for (const obmocje of VARSTVENA_OBMOCJA) {
    if (lat >= obmocje.latMin && lat <= obmocje.latMax && lng >= obmocje.lngMin && lng <= obmocje.lngMax) {
      return { varuje: true, naziv: obmocje.naziv };
    }
  }
  return { varuje: false, naziv: null };
}

function predlagajUkrepe(
  stavba: PropertyCardProps["stavba"],
  part: PropertyCardProps["deliStavbe"][number] | null | undefined,
  delez: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _ocena: any,
  varstvo: { varuje: boolean; naziv: string | null } = { varuje: false, naziv: null }
): Ukrep[] {
  const ukrepi: Ukrep[] = [];
  const zdaj = new Date().getFullYear();

  const delezNum = delez ? (() => {
    const [s, i] = delez.split("/").map(Number);
    return i ? s / i : 1;
  })() : null;

  // Za enoto: uporabna površina enote; za celoten objekt: bruto površina stavbe
  const povrsina = part?.uporabnaPovrsina ?? part?.povrsina ?? stavba?.povrsina ?? null;

  // 1. OKNA
  const letaOken = part?.letoObnoveOken;
  const starOken = letaOken ? zdaj - letaOken : (stavba?.letoIzgradnje ? zdaj - stavba.letoIzgradnje : 999);
  if (starOken > 20) {
    // Varstvo kulturne dediščine: lesena okna po meri, 2-3× dražja
    const okenCenaMin = varstvo.varuje ? 900 : 450;
    const okenCenaMax = varstvo.varuje ? 1400 : 650;
    const stMin = povrsina ? Math.round(povrsina * 0.15 * okenCenaMin) : (varstvo.varuje ? 5000 : 2500);
    const stMax = povrsina ? Math.round(povrsina * 0.15 * okenCenaMax) : (varstvo.varuje ? 9000 : 4000);
    const stSrednji = Math.round((stMin + stMax) / 2);
    const roi = izracunajROI("okna", stSrednji, povrsina);
    const opisOkna = varstvo.varuje
      ? `Stavba je v varstvenem območju (${varstvo.naziv}). Zamenjava oken zahteva soglasje ZVKDS. Dovoljeni so samo leseni okvirji z enakim profilom in delitvijo kot originalni.`
      : letaOken
        ? `Okna so bila nazadnje obnovljena ${letaOken} (${zdaj - letaOken} let). Energijsko varčna okna (Uw ≤ 0,9 W/m²K) zmanjšajo toplotne izgube za 15-25%.`
        : `Okna niso bila obnovljena. Energijsko varčna okna zmanjšajo toplotne izgube za 15-25%.`;
    ukrepi.push({
      naziv: "Zamenjava oken in balkonskih vrat",
      nivo: "enota" as const,  // okna = individualna odločitev lastnika enote
      opis: opisOkna,
      strosekMin: stMin,
      strosekMax: stMax,
      osnova: varstvo.varuje
        ? `Lesena okna po meri (ZVKDS smernice) × ${okenCenaMin}-${okenCenaMax} €/m²`
        : `Ocena: ~15% stanovanjske površine (${povrsina ? Math.round(povrsina * 0.15) + ' m²' : 'neznano'}) × 450-650 €/m²`,
      prioriteta: roi.min <= 10 ? "visoka" : roi.min <= 20 ? "srednja" : "nizka",
      dobaPovrnitveMin: roi.min,
      dobaPovrnitveMax: roi.max,
      varstvoCene: varstvo.varuje,
      vrednostDvig: 3,
      kategorija: "energetika",
    });
  }

  // 2. INSTALACIJE
  const letaInst = part?.letoObnoveInstalacij;
  const starInst = letaInst ? zdaj - letaInst : (stavba?.letoIzgradnje ? zdaj - stavba.letoIzgradnje : 999);
  if (starInst > 25) {
    const stMin = 6000;
    const stMax = 14000;
    const stSrednji = Math.round((stMin + stMax) / 2);
    const roi = izracunajROI("ogrevanje", stSrednji, povrsina);
    ukrepi.push({
      naziv: "Posodobitev ogrevalnega sistema",
      nivo: "stavba",
      opis: letaInst
        ? `Instalacije so bile nazadnje obnovljene ${letaInst}. Sodobna toplotna črpalka ali kondenzacijski kotel zmanjša porabo energije za ogrevanje za 30-50%.`
        : `Ogrevalni sistem ni bil obnovljen. Posodobitev bistveno zmanjša stroške ogrevanja.`,
      strosekMin: stMin,
      strosekMax: stMax,
      osnova: "Toplotna črpalka zrak-voda: 8.000-12.000 €; kondenzacijski kotel: 3.500-6.000 €",
      prioriteta: roi.min <= 10 ? "visoka" : roi.min <= 20 ? "srednja" : "nizka",
      dobaPovrnitveMin: roi.min,
      dobaPovrnitveMax: roi.max,
      vrednostDvig: 4,
      kategorija: "energetika",
    });
  }

  // 3. FASADA
  const LIFESPAN_FASADE = 30;
  const letaFasade = stavba?.letoObnove?.fasade;
  const starFasade = letaFasade ? zdaj - letaFasade : (stavba?.letoIzgradnje ? zdaj - stavba.letoIzgradnje : 999);
  const fasadaNujno = starFasade > LIFESPAN_FASADE;
  if (starFasade > 25) {
    const visinaMerov = stavba?.visina && stavba.visina > 0 ? stavba.visina : 12;
    const ocenjenaPovFasade = povrsina ? Math.round(Math.sqrt(povrsina) * 4 * visinaMerov) : 400;
    // Varstvo: apnena malta, tradicionalni materiali → 180-280 €/m² (vs 80-130 €/m²)
    const fasadaCenaMin = varstvo.varuje ? 180 : 80;
    const fasadaCenaMax = varstvo.varuje ? 280 : 130;
    const skupniMin = Math.round(ocenjenaPovFasade * fasadaCenaMin);
    const skupniMax = Math.round(ocenjenaPovFasade * fasadaCenaMax);
    const stSrednji = Math.round((skupniMin + skupniMax) / 2);
    const delezMin = delezNum ? Math.round(skupniMin * delezNum) : null;
    const delezMax = delezNum ? Math.round(skupniMax * delezNum) : null;
    // Bug 3 fix: ROI temelji na deležu stroška, ne skupnem
    const delezStrosekSrednji = delezNum ? Math.round(stSrednji * delezNum) : stSrednji;
    const roi = izracunajROI("fasada", delezStrosekSrednji, povrsina);
    const opisFasada = varstvo.varuje
      ? `POZOR - Stavba se nahaja v varstvenem območju kulturne dediščine (${varstvo.naziv}). Obnova fasade zahteva predhodno soglasje ZVKDS. Dovoljeni so samo materiali, ki ohranjajo historični izgled (apnena malta, tradicionalne barve). Kontaktirajte Zavod za varstvo kulturne dediščine: zvkds@zvkds.si`
      : `Celostna obnova fasade z mineralnimi ploščami (λ ≤ 0,035 W/mK, debelina ≥ 15 cm). ${letaFasade ? `Fasada je bila nazadnje obnovljena ${letaFasade}. ` : ""}Ukrep zmanjša potrebo po ogrevanju za 20-40%.`;
    ukrepi.push({
      naziv: varstvo.varuje ? "Obnova fasade po ZVKDS smernicah" : fasadaNujno ? "Obnova fasade" : "Toplotna izolacija fasade (ETICS sistem)",
      nivo: "skupno",
      opis: opisFasada,
      // Bug 4 fix: ko je enota izbrana, strosekMin/Max = vaš delež; skupni strošek objekta shranimo ločeno
      strosekMin: delezMin ?? skupniMin,
      strosekMax: delezMax ?? skupniMax,
      skupniStrosekMin: skupniMin,
      skupniStrosekMax: skupniMax,
      osnova: `Ocenjena površina fasade: ~${ocenjenaPovFasade} m² × ${fasadaCenaMin}-${fasadaCenaMax} €/m²${varstvo.varuje ? " (apnena malta, ZVKDS materiali)" : ""}`,
      prioriteta: fasadaNujno ? "visoka" : (roi.min <= 10 ? "visoka" : roi.min <= 20 ? "srednja" : "nizka"),
      dobaPovrnitveMin: roi.min,
      dobaPovrnitveMax: roi.max,
      varstvoCene: varstvo.varuje,
      vrednostDvig: varstvo.varuje ? 8 : 6,
      kategorija: fasadaNujno ? "vzdrzevanje" : "energetika",
    });
  }

  // 4. STREHA
  const LIFESPAN_STREHE = 40;
  const letaStrehe = stavba?.letoObnove?.strehe;
  const starStrehe = letaStrehe ? zdaj - letaStrehe : (stavba?.letoIzgradnje ? zdaj - stavba.letoIzgradnje : 999);
  const strehaNujno = starStrehe > LIFESPAN_STREHE;
  if (starStrehe > 30) {
    const stMin = 15000;
    const stMax = 40000;
    const stSrednji = Math.round((stMin + stMax) / 2);
    const strehaDelezMin = delezNum ? Math.round(stMin * delezNum) : null;
    const strehaDelezMax = delezNum ? Math.round(stMax * delezNum) : null;
    // Bug 3 fix: ROI temelji na deležu stroška, ne skupnem
    const strehaDelezSrednji = delezNum ? Math.round(stSrednji * delezNum) : stSrednji;
    const roi = izracunajROI("streha", strehaDelezSrednji, povrsina);
    const area = stavba?.povrsina ?? 80;
    // Ko je kritina dotrajana (>40 let), dodamo vzdrževalni ukrep zamenjave kritine PRED izolacijo
    if (strehaNujno) {
      ukrepi.push({
        naziv: "Zamenjava strešne kritine",
        nivo: "skupno" as const,
        kategorija: "vzdrzevanje" as const,
        opis: `Strešna kritina je stara ${starStrehe} let (življenjska doba: 40 let). Zamenjava kritine je nujna za ohranitev vodotesnosti in preprečitev poškodb konstrukcije.`,
        strosekMin: delezNum ? Math.round(200 * area * delezNum) : Math.round(200 * area),
        strosekMax: delezNum ? Math.round(350 * area * delezNum) : Math.round(350 * area),
        skupniStrosekMin: Math.round(200 * area),
        skupniStrosekMax: Math.round(350 * area),
        osnova: "ZRMK referenčne cene 2024: 200–350 €/m² (streha)",
        prioriteta: "visoka" as const,
        dobaPovrnitveMin: 999,
        dobaPovrnitveMax: 999,
        varstvoCene: varstvo.varuje,
        vrednostDvig: 5,
      });
    }
    ukrepi.push({
      naziv: "Toplotna izolacija strehe / podstrešja",
      nivo: "skupno",
      opis: `Izolacija podstrešja ali strešne konstrukcije (mineralna volna ≥ 30 cm). ${letaStrehe ? `Streha je bila nazadnje obnovljena ${letaStrehe}. ` : ""}Ukrep zmanjša toplotne izgube skozi streho za 30-50%.`,
      // Bug 4 fix: ko je enota izbrana, strosekMin/Max = vaš delež; skupni shranimo ločeno
      strosekMin: strehaDelezMin ?? stMin,
      strosekMax: strehaDelezMax ?? stMax,
      skupniStrosekMin: stMin,
      skupniStrosekMax: stMax,
      osnova: `Glede na velikost stavbe: 15.000-40.000 €`,
      prioriteta: roi.min <= 10 ? "visoka" : roi.min <= 20 ? "srednja" : "nizka",
      dobaPovrnitveMin: roi.min,
      dobaPovrnitveMax: roi.max,
      vrednostDvig: 5,
      kategorija: "energetika",
    });
  }

  return ukrepi;
}

function UkrepKartica({ u, delez, hasSelectedUnit, isLast }: { u: Ukrep; delez: string | null; hasSelectedUnit: boolean | undefined; isLast: boolean }) {
  const [osnOdprta, setOsnOdprta] = React.useState(false);

  const borderColor = u.prioriteta === "visoka" ? "#ef4444" : u.prioriteta === "srednja" ? "#f59e0b" : "#d1d5db";
  const prioritetaLabel = u.prioriteta === "visoka" ? "↑ prednostno" : u.prioriteta === "srednja" ? "priporočeno" : "opcijsko";
  const prioritetaTextColor = u.prioriteta === "visoka" ? "text-red-600" : u.prioriteta === "srednja" ? "text-amber-600" : "text-gray-400";

  const showDelez = u.nivo === "skupno" && hasSelectedUnit && delez && u.skupniStrosekMin != null;

  return (
    <div
      className={`border border-gray-100 rounded bg-white overflow-hidden${isLast ? "" : " mb-3"}`}
      style={{ borderLeftWidth: "4px", borderLeftColor: borderColor }}
    >
      <div className="p-3">
        {/* Naziv + prioriteta */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-sm font-medium text-gray-800">{u.naziv}</p>
            {u.varstvoCene && (
              <p className="text-xs text-purple-600 mt-0.5">🏛 Cene prilagojene za varstvo kulturne dediščine</p>
            )}
          </div>
          <span className={`text-xs flex-shrink-0 mt-0.5 ${prioritetaTextColor}`}>{prioritetaLabel}</span>
        </div>

        {/* Opis */}
        <p className="text-xs text-gray-500 mb-2">{u.opis}</p>

        {/* Strošek + ROI - linearen prikaz */}
        {showDelez ? (
          <div className="space-y-1">
            <div>
              <span className="text-xs text-gray-400">Skupni strošek objekta: </span>
              <span className="text-xs text-gray-400">
                {u.skupniStrosekMin!.toLocaleString("sl-SI")}-{u.skupniStrosekMax!.toLocaleString("sl-SI")} €
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500">Vaš delež ({delez}): </span>
              <span className="text-sm font-semibold text-gray-800">
                {u.strosekMin.toLocaleString("sl-SI")}-{u.strosekMax.toLocaleString("sl-SI")} €
              </span>
            </div>
            {u.dobaPovrnitveMin > 50 && u.varstvoCene ? (
              <p className="text-xs text-purple-700">Vzdrževalna obveznost - preverite subvencije (EkoSklad, EU skladi)</p>
            ) : u.dobaPovrnitveMin > 50 ? (
              <p className="text-xs text-gray-500">Doba povrnitve (vaš delež): &gt; 50 let - priporočljivo preveriti razpoložljive subvencije</p>
            ) : (
              <p className="text-xs text-gray-400">Doba povrnitve (vaš delež): ~{u.dobaPovrnitveMin}-{u.dobaPovrnitveMax} let</p>
            )}
            {u.vrednostDvig && (
              <p className="text-xs text-green-700">Ocenjeni vpliv na vrednost: +{u.vrednostDvig}% (po izvedbi)</p>
            )}
          </div>
        ) : (
          <div>
            <span className="text-xs text-gray-400">{u.nivo === "skupno" ? "Skupni strošek" : "Ocena stroška"}: </span>
            <span className="text-sm font-medium text-gray-800">
              {u.strosekMin.toLocaleString("sl-SI")}-{u.strosekMax.toLocaleString("sl-SI")} €
            </span>
            {u.dobaPovrnitveMin > 50 && u.varstvoCene ? (
              <p className="text-xs text-purple-700 mt-0.5">Vzdrževalna obveznost - preverite subvencije (EkoSklad, EU skladi)</p>
            ) : u.dobaPovrnitveMin > 50 ? (
              <p className="text-xs text-gray-500 mt-0.5">Doba povrnitve: &gt; 50 let - priporočljivo preveriti razpoložljive subvencije</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">Doba povrnitve: ~{u.dobaPovrnitveMin}-{u.dobaPovrnitveMax} let</p>
            )}
            {u.vrednostDvig && (
              <p className="text-xs text-green-700 mt-1">Ocenjeni vpliv na vrednost: +{u.vrednostDvig}% (po izvedbi)</p>
            )}
          </div>
        )}

        {/* Metodologija - skrita za collapse */}
        <div className="mt-2 pt-2 border-t border-gray-50">
          <button
            onClick={() => setOsnOdprta(!osnOdprta)}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            {osnOdprta ? "▲ Skrij metodologijo" : "▼ Metodologija in osnova"}
          </button>
          {osnOdprta && (
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{u.osnova}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function EnergetskiUkrepiSection({ ukrepi, delez, lat, lng, isMultiUnit, hasSelectedUnit, unitLabel, varstvo }: { ukrepi: Ukrep[]; delez: string | null; lat?: number | null; lng?: number | null; isMultiUnit?: boolean; hasSelectedUnit?: boolean; unitLabel?: string | null; varstvo?: { varuje: boolean; naziv: string | null } }) {
  const varstvoInfo = varstvo ?? jeVVarstveniConi(lat, lng);
  if (ukrepi.length === 0) return null;

  const vidniUkrepi = ukrepi.filter(u => {
    if (!isMultiUnit) return true;
    if (u.nivo === "skupno") return true;
    if (u.nivo === "enota") return !!hasSelectedUnit;
    if (u.nivo === "stavba") return !hasSelectedUnit;
    return true;
  });

  const vzdrzevalni = vidniUkrepi.filter(u => u.kategorija === "vzdrzevanje");
  const energetski = vidniUkrepi.filter(u => u.kategorija === "energetika");

  const multiUnitSuffix = isMultiUnit
    ? ` — ${hasSelectedUnit && unitLabel ? `za ${unitLabel}` : "za celoten objekt"}`
    : "";

  return (
    <section className="mt-4 pt-4 border-t border-gray-100 space-y-6">
      {varstvoInfo.varuje && (
        <div className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded px-3 py-2">
          <span className="text-purple-600 text-xs mt-0.5">🏛</span>
          <div>
            <p className="text-xs font-medium text-purple-800">Varstvo kulturne dediščine</p>
            <p className="text-xs text-purple-700">{varstvoInfo.naziv} — Za vsak poseg v zunanjost stavbe je potrebno predhodno soglasje Zavoda za varstvo kulturne dediščine Slovenije (ZVKDS).</p>
            <p className="text-xs text-purple-700 mt-1">
              Tel: <a href="tel:+38614244200" className="underline">01 424 42 00</a>
              {" · "}
              <a href="mailto:gp.zvkds@gov.si" className="underline">gp.zvkds@gov.si</a>
              {" · "}
              <a href="https://www.zvkds.si" target="_blank" rel="noopener noreferrer" className="underline">zvkds.si</a>
            </p>
          </div>
        </div>
      )}

      {vzdrzevalni.length > 0 && (
        <div>
          <div className="border-b border-red-100 pb-1 mb-3">
            <h4 className="text-xs font-semibold text-red-700 uppercase tracking-widest">
              Predlagani vzdrževalni ukrepi
              {isMultiUnit && (
                <span className="text-red-400 font-normal ml-1 normal-case tracking-normal">
                  {multiUnitSuffix}
                </span>
              )}
            </h4>
            <p className="text-xs text-gray-400 italic mt-0.5">Vir: Kataster nepremičnin · GURS</p>
          </div>
          <div>
            {vzdrzevalni.map((u, i) => (
              <UkrepKartica
                key={i}
                u={u}
                delez={delez}
                hasSelectedUnit={hasSelectedUnit}
                isLast={i === vzdrzevalni.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {energetski.length > 0 && (
        <div>
          <div className="border-b border-gray-100 pb-1 mb-3">
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
              Predlagani energetski ukrepi
              {isMultiUnit && (
                <span className="text-gray-400 font-normal ml-1 normal-case tracking-normal">
                  {multiUnitSuffix}
                </span>
              )}
            </h4>
            <p className="text-xs text-gray-400 italic mt-0.5">Vir: ZRMK/IZS referenčne cene 2024</p>
          </div>
          <div>
            {energetski.map((u, i) => (
              <UkrepKartica
                key={i}
                u={u}
                delez={delez}
                hasSelectedUnit={hasSelectedUnit}
                isLast={i === energetski.length - 1}
              />
            ))}
          </div>
          <InfoTooltip text="Stroški so okvirne ocene na podlagi ZRMK/IZS referenčnih cen 2024. Niso uradna ponudba izvajalca." />
        </div>
      )}
    </section>
  );
}

function EnergyCertificateSection({ data, stavba, part, lat, lng }: {
  data: EnergyData | null;
  stavba: PropertyCardProps["stavba"];
  part?: PropertyCardProps["deliStavbe"][number] | null;
  lat?: number | null;
  lng?: number | null;
}) {
  // 1. Prava EIZ ima prednost - uradna izkaznica iz registra
  if (data?.razred) {
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
            <Field label="Potrebna toplota" value={data.potrebnaTopota != null ? `${fmtDec(data.potrebnaTopota)} kWh/m²a` : null} />
            <Field label="Dovedena energija" value={data.dovedenaEnergija != null ? `${fmtDec(data.dovedenaEnergija)} kWh/m²a` : null} />
            <Field label="Električna energija" value={data.elektricnaEnergija != null ? `${fmtDec(data.elektricnaEnergija)} kWh/m²a` : null} />
            <Field label="Primarna energija" value={data.primaryEnergy != null ? `${fmtDec(data.primaryEnergy)} kWh/m²a` : null} />
            <Field label="CO₂ emisije" value={data.co2 != null ? `${fmtDec(data.co2)} kg/m²a` : null} />
            <Field label="Kondicionirana površina" value={data.kondicionirana != null ? `${fmtDec(data.kondicionirana)} m²` : null} />
            <Field label="Datum izdaje" value={data.datumIzdaje ?? null} />
          </div>
        </div>
      </section>
    );
  }

  // 2. Ni uradne izkaznice - poskusi algoritmično oceno
  const ocena = stavba ? oceniEnergetskiRazred(stavba, part) : null;

  if (!ocena) return (
    <section>
      <Label vir="Register energetskih izkaznic · MOP">Poraba energije</Label>
      <p className="text-sm text-gray-400 italic">
        Energetska izkaznica za to nepremičnino ni vpisana v register.
      </p>
    </section>
  );

  // 3. Algoritmična ocena
    const zc = zaupanjeColor[ocena.zaupanje];
    return (
      <section>
        <div className="mb-4 pb-4 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700">Uradna energetska izkaznica ni na voljo</p>
          <p className="text-xs text-gray-400 mt-0.5">Objekt ni vpisan v register energetskih izkaznic (MOPE).</p>
        </div>
        <div className="border-b border-gray-100 pb-1 mb-3">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
            Energetsko stanje
          </h4>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-gray-400">Vir: Ocena · multi-faktorski algoritem</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${
              ocena.zaupanje === 'visoko' ? 'bg-green-50 text-green-700' :
              ocena.zaupanje === 'srednje' ? 'bg-amber-50 text-amber-700' :
              'bg-gray-100 text-gray-500'
            }`}>
              {zaupanjeLabel[ocena.zaupanje]}
            </span>
          </div>
        </div>
        <span className="inline-flex items-center text-xs text-gray-400 mb-3">
          Algoritmična ocena<InfoTooltip text={zaupanjeBesedilo[ocena.zaupanje]} />
        </span>
        {/* Sekcija 1: Standard */}
        <div className="mb-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Osnova · PURES 2010 / EN ISO 52000</p>
          <p className="text-sm text-gray-600">{ocena.dejavnikiBaza[0]}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
            <span>Razred po standardu (PURES 2010): <strong className="text-gray-800">{ocena.razredBazni}</strong></span>
            <span className="text-gray-300">→</span>
            <span>Ocenjeni razred z algoritmom: <strong className="text-gray-800">{ocena.razred}</strong></span>
          </div>
        </div>
        {/* EnergyMeter prikaže končni razred */}
        <EnergyMeter razred={ocena.razred} />
        {/* Sekcija 2: Prilagoditve */}
        {ocena.dejavnikiPrilagoditve.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
              Upoštevani dejavniki
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

function ParceleSection({ parcele }: { parcele?: Parcela[] }) {
  if (!parcele || parcele.length === 0) return null;
  // Dedupliciraj po parcelni številki
  const unique = parcele.filter((p, i, arr) =>
    arr.findIndex(x => x.parcelnaStevila === p.parcelnaStevila) === i
  );
  return (
    <section>
      <Label vir="Zemljiški kataster · GURS">Zemljišče</Label>
      <div className="space-y-1.5">
        {unique.map((p, i) => (
          <div key={i} className="flex items-baseline justify-between py-1.5 border-b border-gray-50 last:border-0 text-sm">
            <span className="font-medium text-gray-700">{p.parcelnaStevila}</span>
            <div className="text-right text-gray-600 text-xs space-y-0.5">
              {p.povrsina != null && <div>{fmtDec(p.povrsina)} m²</div>}
              {p.vrstaRabe && <div className="text-gray-400">{p.vrstaRabe}</div>}
              {p.boniteta != null && <div className="text-gray-400">Bon. {fmtDec(p.boniteta)}</div>}
            </div>
          </div>
        ))}
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
  const all = deliStavbe
    .flatMap(d => (d.lastnistvo ?? []).map(l => ({ ...l, enota: d.stDela })))
    .sort((a, b) => a.enota - b.enota);
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
      <div className="space-y-1">
        <div className="grid grid-cols-3 gap-2 pb-1 border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400 font-medium">
          <span>Enota</span>
          <span>Tip lastnika</span>
          <span className="text-right">Delež</span>
        </div>
        {vidniLastniki.map((r, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 py-1.5 border-b border-gray-50 last:border-0 text-sm text-gray-700">
            <span className="text-gray-400">{r.enota}</span>
            <span>{r.tipOsebe}</span>
            <span className="text-right tabular-nums">{r.delez}</span>
          </div>
        ))}
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
  if (!data || data.length === 0) return (
    <section>
      <Label vir="Zemljiška knjiga · GURS">Lastništvo</Label>
      <p className="text-xs text-gray-400 italic">Podatki o lastništvu niso javno dostopni za to nepremičnino.</p>
      <a
        href="https://www.e-sodstvo.si/ekn/SredisnjiRegister?action=ZacetnaStran"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
      >
        Preveri lastništvo v Zemljiški knjigi →
      </a>
    </section>
  );
  const vidniLastniki = showAllLastniki ? data : data.slice(0, MAX_VISIBLE_LASTNIKI);
  const jePokritih = data.length > MAX_VISIBLE_LASTNIKI;
  return (
    <section>
      <Label vir="Zemljiška knjiga · GURS">Lastništvo</Label>
      <p className="text-xs text-gray-500 mb-3">{fmtLastniki(data.length)}</p>
      <div className="space-y-1">
        {vidniLastniki.map((r, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 text-sm">
            <div className="flex-1 min-w-0">
              <span className="text-gray-700">{r.tipOsebe}</span>
              {r.nazivPravneOsebe && (
                <span className="block text-xs text-gray-400 truncate">{r.nazivPravneOsebe}</span>
              )}
              {r.datumVpisa && (
                <span className="block text-xs text-gray-400">{fmtDate(r.datumVpisa)}</span>
              )}
            </div>
            <span className="tabular-nums text-gray-600 font-medium ml-3 flex-shrink-0">{r.delez}</span>
          </div>
        ))}
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
      <span className="inline-flex items-center text-xs text-gray-400 mt-2">Vir: Zemljiška knjiga · GURS<InfoTooltip text="Lastniki so prikazani kot tip osebe (fizična/pravna) in delež. Osebna imena niso prikazana v skladu z GDPR." /></span>
    </section>
  );
}

function OcenaVrednostiSection({
  renVrednost,
  currentPartVrednotenje,
  deliStavbe,
  hasSelectedUnit,
}: {
  renVrednost?: { vrednost: number; datumOcene: string } | null;
  currentPartVrednotenje?: { posplosenaVrednost: number | null; vrednostNaM2: number | null } | null;
  deliStavbe: PropertyCardProps["deliStavbe"];
  hasSelectedUnit: boolean;
}) {
  // Per-unit: izbrana enota z vrednotenjem
  if (hasSelectedUnit && currentPartVrednotenje?.posplosenaVrednost != null) {
    const posplosenaVrednost = currentPartVrednotenje.posplosenaVrednost!;
    const vrednostNaM2 = currentPartVrednotenje.vrednostNaM2;
    return (
      <section>
        <Label vir="Množično vrednotenje · GURS · EV_SLO">Ocenjena vrednost enote</Label>
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 mb-4">
          <p className="text-2xl font-bold text-gray-800">
            {posplosenaVrednost.toLocaleString("sl-SI")} €
          </p>
          {vrednostNaM2 != null && (
            <p className="text-xs text-gray-500 mt-0.5">
              {vrednostNaM2.toLocaleString("sl-SI")} €/m²
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            Posplošena tržna vrednost — GURS množično vrednotenje. Ni enako tržni ceni.
          </p>
        </div>
      </section>
    );
  }

  // Building-level: cela stavba z renVrednost
  if (!hasSelectedUnit && renVrednost) {
    const evSkupaj = deliStavbe.reduce(
      (sum, d) => sum + (d.vrednotenje?.posplosenaVrednost ?? 0),
      0,
    );
    return (
      <section>
        <Label vir="Množično vrednotenje · GURS">Ocenjena vrednost stavbe</Label>
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 mb-4">
          <p className="text-2xl font-bold text-gray-800">
            {renVrednost.vrednost.toLocaleString("sl-SI")} €
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Vir: GURS množično vrednotenje
            {renVrednost.datumOcene ? ` — ${renVrednost.datumOcene}` : ""}
          </p>
          {evSkupaj > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Skupna vrednost enot (EV): {evSkupaj.toLocaleString("sl-SI")} € — informativno
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            Posplošena tržna vrednost — GURS množično vrednotenje. Ni enako tržni ceni.
          </p>
        </div>
      </section>
    );
  }

  // Ni podatkov
  return (
    <section>
      <Label vir="Množično vrednotenje · GURS">Ocenjena vrednost</Label>
      <p className="text-sm text-gray-400">
        Vrednostni podatek za to nepremičnino ni na voljo v evidenci GURS.
      </p>
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
  unitArea,
  isMultiUnit,
  hasSelectedUnit,
  unitLabel,
}: {
  energetskaIzkaznica: EnergyData | null;
  unitArea?: number | null;
  isMultiUnit?: boolean;
  hasSelectedUnit?: boolean;
  unitLabel?: string | null;
}) {
  if (
    !energetskaIzkaznica ||
    energetskaIzkaznica.potrebnaTopota == null ||
    energetskaIzkaznica.kondicionirana == null
  )
    return null;

  const heatingNeed = energetskaIzkaznica.potrebnaTopota;
  const totalArea = energetskaIzkaznica.kondicionirana;

  // Če je izbrana enota v večstanovanjskem objektu → skaliraj na površino enote
  const useUnitArea = isMultiUnit && hasSelectedUnit && unitArea && unitArea > 0;
  const area = useUnitArea ? unitArea! : totalArea;
  const contextLabel = isMultiUnit
    ? hasSelectedUnit && unitLabel
      ? `za ${unitLabel}`
      : "za celoten objekt"
    : null;

  const annualCost = heatingNeed * area * HEATING_PRICE_EUR;

  // Cilji po razredih (kWh/m²a) - PURES 2010
  const RAZREDI: { razred: string; target: number }[] = [
    { razred: "B1", target: 50 },
    { razred: "A2", target: 25 },
    { razred: "A1", target: 10 },
  ];
  // Prikaži 2 naslednja boljša razreda od trenutnega
  const boljsiRazredi = RAZREDI.filter(r => r.target < heatingNeed).slice(0, 2);
  return (
    <section>
      <Label vir="Register energetskih izkaznic · MOP">
        Stroški ogrevanja{contextLabel ? <span className="font-normal text-gray-400 ml-1 text-sm">({contextLabel})</span> : null}
      </Label>
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <Field
            label="Letni strošek ogrevanja"
            value={`${fmt(annualCost)} \u20AC`}
          />
          {boljsiRazredi.length === 0 ? (
            <Field label="Energetski razred" value="✓ Vrhunska učinkovitost" />
          ) : (
            <>
              {boljsiRazredi.map(r => {
                const savings = annualCost - r.target * area * HEATING_PRICE_EUR;
                return <Field key={r.razred} label={`Prihranek do ${r.razred}`} value={`${fmt(savings)} €/leto`} />;
              })}
            </>
          )}
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
    jeOcena: boolean;
  }[] = [];



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

    // Ko ni podatka o obnovi, privzamemo leto izgradnje — komponenta je stara kolikor stavba
    const jeOcena = !letoObnove;
    const effLetoObnove = letoObnove ?? baseYear;
    const age = currentYear - effLetoObnove;
    if (age >= m.lifespan) {
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "Nujno",
        borderColor: "border-l-red-500",
        pillClass: "bg-red-50 text-red-700",
        jeOcena,
      });
    } else if (age >= m.lifespan * 0.85) {
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "Priporočeno",
        borderColor: "border-l-amber-400",
        pillClass: "bg-amber-50 text-amber-700",
        jeOcena,
      });
    } else if (age >= m.lifespan * 0.7) {
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "Planirati",
        borderColor: "border-l-green-400",
        pillClass: "bg-green-50 text-green-700",
        jeOcena,
      });
    } else if (jeOcena) {
      // Ni podatka in ni urgentno — prikaži z nizko prioriteto
      items.push({
        name: m.name,
        age,
        lifespan: m.lifespan,
        urgency: "V redu",
        borderColor: "border-l-gray-200",
        pillClass: "bg-gray-50 text-gray-500",
        jeOcena,
      });
    }
  }

  return (
    <section>
      <Label vir="Kataster nepremičnin · GURS">Kdaj je potrebno vzdrževanje</Label>
      {items.length === 0 ? (
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
                  ({item.age}/{item.lifespan} let{item.jeOcena ? ", ocena" : ""})
                </span>
              </div>
              <span
                className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${item.pillClass}`}
              >
                {item.urgency}
              </span>
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
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!lat || !lng || !apiKey) { setAvailable(false); return; }
    // Metadata API — brezplačen, preveri ali Street View pokriva to lokacijo
    fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&source=outdoor&radius=50&key=${apiKey}`)
      .then(r => r.json())
      .then(d => setAvailable(d.status === "OK"))
      .catch(() => setAvailable(false));
  }, [lat, lng, apiKey]);

  if (!lat || !lng || !apiKey) return null;

  if (available === null) return (
    <div className="print:hidden h-[200px] rounded-lg bg-gray-50 flex items-center justify-center text-xs text-gray-400">Nalagam Street View…</div>
  );

  if (!available) return (
    <div className="print:hidden rounded-lg bg-gray-50 border border-gray-100 py-4 px-3 text-center">
      <p className="text-xs text-gray-400">Street View pogled za ta objekt ni na voljo.</p>
    </div>
  );

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

// ─────────────────────────────────────────────────────────────
// ZAVAROVANJE NEPREMIČNINE
// ─────────────────────────────────────────────────────────────

interface PotresnoTveganje {
  razredRanljivosti: "A" | "B" | "C" | "D";
  tveganje: "nizko" | "zmerno" | "srednje" | "visoko" | "zelo visoko";
  tveganjeTocke: number;
  opisRanljivosti: string;
  priporocenaVsota: number;
  letnaPremijaOcena: { min: number; max: number };
}

function izracunajPotresnoTveganje(
  stavba: PropertyCardProps["stavba"],
  seizmicni: SeizmicniPodatki,
  unitArea?: number | null,
): PotresnoTveganje {
  const leto = stavba.letoIzgradnje ?? 1980;
  const konstr = (stavba.konstrukcija ?? "").toLowerCase();
  const jeMontatna = konstr.includes("mont") || konstr.includes("panel");
  const jeLeseena = konstr.includes("les");
  const jeMasivna = konstr.includes("masivna") || konstr.includes("opeka") || konstr.includes("beton");

  // EMS-98 razred ranljivosti
  let razredRanljivosti: "A" | "B" | "C" | "D";
  let opisRanljivosti: string;

  if (leto >= 2009) {
    razredRanljivosti = "D";
    opisRanljivosti = "Moderna gradnja po Eurocode 8 (2009+)";
  } else if ((jeLeseena || jeMontatna) && leto < 1964) {
    razredRanljivosti = "A";
    opisRanljivosti = "Lesena ali montažna gradnja, pred 1964";
  } else if (
    ((jeMasivna || (!jeLeseena && !jeMontatna)) && leto < 1964) ||
    (jeMontatna && leto >= 1964 && leto < 1987)
  ) {
    razredRanljivosti = "B";
    opisRanljivosti = jeMasivna && leto < 1964
      ? "Masivna gradnja, pred 1964"
      : "Montažna gradnja, 1964–1987";
  } else if (
    ((jeMasivna || (!jeLeseena && !jeMontatna)) && leto >= 1964 && leto < 2009) ||
    (jeMontatna && leto >= 1987 && leto < 2009)
  ) {
    razredRanljivosti = "C";
    opisRanljivosti = jeMontatna
      ? "Montažna gradnja, po 1987"
      : "Masivna gradnja, 1964–2009";
  } else {
    // Fallback: stara gradnja brez specifičnih podatkov
    if (leto < 1964) {
      razredRanljivosti = "B";
      opisRanljivosti = "Starejša gradnja, pred 1964";
    } else if (leto < 2009) {
      razredRanljivosti = "C";
      opisRanljivosti = "Gradnja 1964–2009";
    } else {
      razredRanljivosti = "D";
      opisRanljivosti = "Moderna gradnja po 2009";
    }
  }

  // Točke tveganja
  const bazaTocke: Record<string, number> = { "I": 1, "II": 3, "III": 5, "IV": 8 };
  const ranljivostMod: Record<string, number> = { "A": 2, "B": 1, "C": 0, "D": -1 };
  const etaze = stavba.steviloEtaz ?? 1;
  const etazeMod = etaze >= 5 ? 1 : etaze >= 3 ? 0.5 : 0;
  const tveganjeTockeRaw = (bazaTocke[seizmicni.cona] ?? 3) + ranljivostMod[razredRanljivosti] + etazeMod;
  const tveganjeTocke = Math.min(10, Math.max(1, Math.round(tveganjeTockeRaw)));

  const tveganje: PotresnoTveganje["tveganje"] =
    tveganjeTocke <= 2 ? "nizko"
    : tveganjeTocke <= 4 ? "zmerno"
    : tveganjeTocke <= 6 ? "srednje"
    : tveganjeTocke <= 8 ? "visoko"
    : "zelo visoko";

  // Priporočena zavarovalna vsota — unitArea ima prednost pred stavba.povrsina
  const povrsina = unitArea ?? stavba.povrsina ?? 80;
  const ocenjenVrednost = povrsina * 1800;
  const priporocenaVsota = Math.round(ocenjenVrednost * 1.1);

  // Letna premija
  const stopnja = tveganjeTocke <= 3 ? 0.0008 : tveganjeTocke <= 6 ? 0.0015 : 0.0025;
  const letnaPremijaOcena = {
    min: Math.round(priporocenaVsota * stopnja * 0.8),
    max: Math.round(priporocenaVsota * stopnja * 1.3),
  };

  return { razredRanljivosti, tveganje, tveganjeTocke, opisRanljivosti, priporocenaVsota, letnaPremijaOcena };
}

function TveganjeProgressBar({ tocke }: { tocke: number }) {
  const color =
    tocke <= 3 ? "bg-green-500"
    : tocke <= 6 ? "bg-orange-400"
    : tocke <= 8 ? "bg-red-500"
    : "bg-red-800";
  const width = `${tocke * 10}%`;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
      <div className={`h-2.5 rounded-full transition-all ${color}`} style={{ width }} />
    </div>
  );
}

interface ZavarovalniskiTip {
  id: "potresno" | "pozarno" | "poplavno" | "odgovornost";
  naziv: string;
  opis: string;
  vsota: number;
  premijaMin: number;
  premijaMax: number;
  osnova: string;
}

const PONUDNIKI = [
  { naziv: "Triglav",            logo: "TR", mod: 0.95 },
  { naziv: "Zavarovalnica Sava", logo: "SA", mod: 1.05 },
  { naziv: "Generali",           logo: "GE", mod: 1.15 },
  { naziv: "Allianz SI",         logo: "AL", mod: 1.00 },
] as const;

function ZavarovanjeSection({
  naslov,
  stavba,
  seizmicniPodatki,
  poplavnaNevarnost,
  unitArea,
}: {
  naslov: string;
  stavba: PropertyCardProps["stavba"];
  seizmicniPodatki: SeizmicniPodatki | null | undefined;
  etaze?: number | null;
  poplavnaNevarnost?: PoplavnaNevarnost | null;
  unitArea?: number | null;
}) {
  const seizmicni: SeizmicniPodatki = seizmicniPodatki ?? { pga: 0.125, cona: "III", opisCone: "Srednja potresna nevarnost" };
  const potresno = izracunajPotresnoTveganje(stavba, seizmicni, unitArea);
  const priporocenaVsota = potresno.priporocenaVsota;

  const konstr = (stavba.konstrukcija ?? "").toLowerCase();
  const jeMasivna = konstr.includes("masivna") || konstr.includes("opeka") || konstr.includes("beton");
  const pozarnaStopnja = jeMasivna ? 0.0005 : 0.0008;
  const imaPoplavo = poplavnaNevarnost && poplavnaNevarnost.stopnja !== "ni";
  const jeVecStanovanjska = (stavba.steviloStanovanj ?? 1) > 1;
  const povrsina = unitArea ?? stavba.povrsina ?? 80;

  // Ogrevanje iz GURS plin podatka — readonly, brez dropdowna
  const imaPlinZavar = stavba.prikljucki?.plin || stavba.gasInfrastructure?.confidence === "high" || false;
  const ogrevanje = imaPlinZavar ? "Centralno (plin)" : "Električno / drugo";

  const vsiTipi: ZavarovalniskiTip[] = [
    {
      id: "potresno",
      naziv: "Potresno zavarovanje",
      opis: "Krije škodo na nepremičnini zaradi potresa.",
      vsota: priporocenaVsota,
      premijaMin: potresno.letnaPremijaOcena.min,
      premijaMax: potresno.letnaPremijaOcena.max,
      osnova: `Cona ${seizmicni.cona}, ranljivost ${potresno.razredRanljivosti}, ${povrsina} m²`,
    },
    {
      id: "pozarno",
      naziv: "Požarno in splošno zavarovanje",
      opis: "Krije požar, strelo, eksplozijo, vlom.",
      vsota: priporocenaVsota,
      premijaMin: Math.round(priporocenaVsota * pozarnaStopnja * 0.8),
      premijaMax: Math.round(priporocenaVsota * pozarnaStopnja * 1.3),
      osnova: `Gradbena vrednost 1.800 €/m² × ${povrsina} m²`,
    },
    ...(imaPoplavo ? [{
      id: "poplavno" as const,
      naziv: "Poplavno zavarovanje",
      opis: "Krije škodo zaradi poplav in zemeljskih plazov.",
      vsota: priporocenaVsota,
      premijaMin: Math.round(priporocenaVsota * 0.0008),
      premijaMax: Math.round(priporocenaVsota * 0.002),
      osnova: poplavnaNevarnost?.opis ?? "Poplavna nevarnost po ARSO",
    }] : []),
    ...(jeVecStanovanjska ? [{
      id: "odgovornost" as const,
      naziv: "Zavarovanje odgovornosti",
      opis: "Za škodo tretjim osebam (skupni deli stavbe).",
      vsota: 500000,
      premijaMin: 30,
      premijaMax: 60,
      osnova: "Standardna vsota za stavbe s skupnimi deli",
    }] : []),
  ];

  const [selectedTypes, setSelectedTypes] = useState<string[]>(["potresno", "pozarno"]);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Step 2
  const [tipStrehe, setTipStrehe] = useState("dvokapnica");
  const [alarm, setAlarm] = useState("brez");
  const [skode, setSkode] = useState("0");
  const [placilo, setPlacilo] = useState("letno");
  // Uredljivi podatki iz registrov (korak 1) — prednapolnjeni iz GURS, user lahko popravi
  const [editMode, setEditMode] = useState(false);
  const [editPovrsina, setEditPovrsina] = useState(String(povrsina));
  const [editLetoIzgradnje, setEditLetoIzgradnje] = useState(String(stavba.letoIzgradnje ?? ""));
  const [editKonstrukcija, setEditKonstrukcija] = useState(stavba.konstrukcija ?? "");
  const [editOgrevanje, setEditOgrevanje] = useState(ogrevanje);

  // Step 3
  const [selectedPonudnik, setSelectedPonudnik] = useState<string | null>(null);
  const [ime, setIme] = useState("");
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const toggleType = (id: string) => {
    setSelectedTypes(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const selectedTipi = vsiTipi.filter(t => selectedTypes.includes(t.id));

  const tipaStreheMod = tipStrehe === "ravna" ? 1.15 : 1.0;
  const alarmMod = alarm === "alarm+resetke" ? 0.90 : alarm === "alarm" ? 0.95 : 1.0;
  const skodeMod = skode === "2+" ? 1.35 : skode === "1" ? 1.15 : 1.0;
  const mesecnoMod = placilo === "mesecno" ? 1.03 : 1.0;
  const skupniMod = tipaStreheMod * alarmMod * skodeMod * mesecnoMod;

  const handleSend = async () => {
    setSendStatus("sending");
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone: tel, naslov, ponudnik: selectedPonudnik, tipi: selectedTypes }),
      });
      setSendStatus("sent");
      setTimeout(() => {
        setModalOpen(false); setSendStatus("idle"); setSelectedPonudnik(null);
        setIme(""); setEmail(""); setTel(""); setCurrentStep(1);
      }, 2000);
    } catch {
      setSendStatus("error");
    }
  };

  const selectClass = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white";
  const showTipStrehe = selectedTypes.includes("potresno") || selectedTypes.includes("pozarno");
  const showAlarm = selectedTypes.includes("pozarno");

    // Underwriting dejavniki per tip
  const letoIzgradnje = stavba.letoIzgradnje ?? null;
  const konstrukcija = stavba.konstrukcija ?? "Ni podatka";
  const etaze = stavba.steviloEtaz ?? 1;

  const underwriting: Record<string, { label: string; value: string; rizik?: "visok" | "srednji" | "nizek" }[]> = {
    potresno: [
      { label: "Seizmična cona", value: `${seizmicni.cona} (PGA ${seizmicni.pga}g)`, rizik: seizmicni.cona === "IV" ? "visok" : seizmicni.cona === "III" ? "srednji" : "nizek" },
      { label: "Ranljivost stavbe", value: `Razred ${potresno.razredRanljivosti} — ${potresno.opisRanljivosti}`, rizik: potresno.razredRanljivosti === "A" ? "visok" : potresno.razredRanljivosti === "B" ? "srednji" : "nizek" },
      { label: "Leto izgradnje", value: letoIzgradnje ? String(letoIzgradnje) : "Ni podatka" },
      { label: "Konstrukcija", value: konstrukcija },
      { label: "Etaže", value: String(etaze) },
      { label: "Površina", value: `${povrsina} m²` },
      { label: "Zavarovalniška vsota", value: `${priporocenaVsota.toLocaleString("sl-SI")} €` },
    ],
    pozarno: [
      { label: "Tip konstrukcije", value: jeMasivna ? "Masivna (opeka/beton)" : "Lahka (les/montažna)", rizik: jeMasivna ? "nizek" : "srednji" },
      { label: "Ogrevanje", value: ogrevanje, rizik: imaPlinZavar ? "srednji" : "nizek" },
      { label: "Leto izgradnje", value: letoIzgradnje ? String(letoIzgradnje) : "Ni podatka" },
      { label: "Površina", value: `${povrsina} m²` },
      { label: "Zavarovalniška vsota", value: `${priporocenaVsota.toLocaleString("sl-SI")} €` },
    ],
    poplavno: [
      { label: "Poplavna nevarnost (ARSO)", value: poplavnaNevarnost?.opis ?? `Stopnja: ${poplavnaNevarnost?.stopnja}`, rizik: "visok" },
      { label: "Površina", value: `${povrsina} m²` },
      { label: "Zavarovalniška vsota", value: `${priporocenaVsota.toLocaleString("sl-SI")} €` },
    ],
    odgovornost: [
      { label: "Tip objekta", value: "Večstanovanjska stavba" },
      { label: "Število stanovanj", value: String(stavba.steviloStanovanj ?? "—") },
      { label: "Zavarovalniška vsota", value: "500.000 €" },
    ],
  };

  return (
    <section className="space-y-2">

      {/* Kartice tipov z underwriting podatki */}
      <div className="space-y-3">
        {vsiTipi.map((tip) => {
          const checked = selectedTypes.includes(tip.id);
          const uw = underwriting[tip.id] ?? [];
          return (
            <div key={tip.id} className={`rounded-lg border transition-all ${checked ? "border-[#2d6a4f] shadow-sm" : "border-gray-200"}`}>
              {/* Header — klikabilen za toggle */}
              <button
                onClick={() => toggleType(tip.id)}
                className={`w-full text-left px-4 py-3 rounded-t-lg flex items-start gap-3 transition-colors ${checked ? "bg-green-50" : "bg-white hover:bg-gray-50"}`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${checked ? "bg-[#2d6a4f] border-[#2d6a4f]" : "border-gray-300 bg-white"}`}>
                  {checked && <span className="text-white text-[10px] font-bold leading-none">&#10003;</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-800">{tip.naziv}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{tip.opis}</p>
                  <div className="flex flex-wrap gap-x-4 mt-1 text-xs text-gray-600">
                    <span>Vsota: <strong>{tip.vsota.toLocaleString("sl-SI")} &euro;</strong></span>
                    <span>Premija: ~<strong>{tip.premijaMin.toLocaleString("sl-SI")} – {tip.premijaMax.toLocaleString("sl-SI")} &euro;/leto</strong></span>
                  </div>
                </div>
              </button>
              {/* Underwriting dejavniki — vedno vidni */}
              <div className={`border-t px-4 py-3 rounded-b-lg ${checked ? "border-green-200 bg-white" : "border-gray-100 bg-gray-50"}`}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Dejavniki tveganja</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {uw.map((r, i) => (
                    <div key={i} className="flex items-baseline gap-1.5">
                      <span className="text-[11px] text-gray-500 flex-shrink-0">{r.label}:</span>
                      <span className={`text-[11px] font-medium flex-1 ${r.rizik === "visok" ? "text-red-600" : r.rizik === "srednji" ? "text-amber-600" : "text-gray-700"}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>



      <button
        disabled={selectedTypes.length === 0}
        onClick={() => { setCurrentStep(1); setModalOpen(true); }}
        className="w-full rounded-lg bg-[#2d6a4f] px-4 py-3 text-sm font-semibold text-white hover:bg-[#245a42] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Pridobi ponudbo za izbrano ({selectedTypes.length}) &rarr;
      </button>

      <p className="text-[11px] text-gray-400">Izra&#269;uni so indikativni &middot; Vir: ARSO &middot; Eurocode 8 &middot; EMS-98</p>

      {/* MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg relative my-8">

            {/* Header + stepper */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div className="flex-1">
                <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Zavarovanje nepremi&#269;nine</p>
                <div className="flex gap-3">
                  {([1, 2, 3] as const).map(s => (
                    <div key={s} className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                        currentStep === s ? "bg-[#2d6a4f] text-white" :
                        currentStep > s ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-400"
                      }`}>{s}</div>
                      <span className={`text-xs ${currentStep === s ? "text-gray-700 font-medium" : "text-gray-400"}`}>
                        {s === 1 ? "Pregled" : s === 2 ? "Podatki" : "Ponudniki"}
                      </span>
                      {s < 3 && <span className="text-gray-200">&rsaquo;</span>}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => { setModalOpen(false); setCurrentStep(1); }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1 ml-4" aria-label="Zapri">
                &#x2715;
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">

              {/* KORAK 1 */}
              {currentStep === 1 && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Zavarujete</p>
                    <div className="flex flex-wrap gap-2">
                      {vsiTipi.map(tip => {
                        const sel = selectedTypes.includes(tip.id);
                        return (
                          <button key={tip.id} onClick={() => toggleType(tip.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                              sel ? "bg-[#2d6a4f] border-[#2d6a4f] text-white" : "border-gray-200 text-gray-400 line-through bg-gray-50"
                            }`}>
                            {sel && <span>&#10003;</span>}
                            {tip.naziv.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                    {selectedTypes.length === 0 && <p className="text-xs text-red-500 mt-1">Izberite vsaj en tip zavarovanja.</p>}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Podatki o nepremičnini</p>
                      <button onClick={() => setEditMode(!editMode)} className="text-xs text-[#2d6a4f] hover:underline font-medium">
                        {editMode ? "Zapri urejanje" : "Uredi podatke"}
                      </button>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-100 text-sm">
                      {/* Naslov — vedno readonly */}
                      <div className="flex justify-between px-4 py-2">
                        <span className="text-gray-500 shrink-0 mr-3">Naslov</span>
                        <span className="text-gray-800 font-medium text-right">{naslov || "—"}</span>
                      </div>
                      {/* Površina */}
                      <div className="flex justify-between items-center px-4 py-2">
                        <span className="text-gray-500 shrink-0 mr-3">Površina</span>
                        {editMode ? (
                          <div className="flex items-center gap-1">
                            <input type="number" value={editPovrsina} onChange={e => setEditPovrsina(e.target.value)}
                              className="w-20 border border-gray-300 rounded px-2 py-0.5 text-sm text-right" />
                            <span className="text-gray-500 text-sm">m²</span>
                          </div>
                        ) : <span className="text-gray-800 font-medium">{editPovrsina} m²</span>}
                      </div>
                      {/* Leto izgradnje */}
                      <div className="flex justify-between items-center px-4 py-2">
                        <span className="text-gray-500 shrink-0 mr-3">Leto izgradnje</span>
                        {editMode ? (
                          <input type="number" value={editLetoIzgradnje} onChange={e => setEditLetoIzgradnje(e.target.value)}
                            className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm text-right" />
                        ) : <span className="text-gray-800 font-medium">{editLetoIzgradnje || "—"}</span>}
                      </div>
                      {/* Konstrukcija */}
                      <div className="flex justify-between items-center px-4 py-2">
                        <span className="text-gray-500 shrink-0 mr-3">Konstrukcija</span>
                        {editMode ? (
                          <select value={editKonstrukcija} onChange={e => setEditKonstrukcija(e.target.value)}
                            className="border border-gray-300 rounded px-2 py-0.5 text-sm bg-white">
                            <option value="Masivna">Masivna (opeka)</option>
                            <option value="Armiran beton">Armiran beton</option>
                            <option value="Montažna">Montažna</option>
                            <option value="Lesena">Lesena</option>
                            <option value="Jeklo">Jeklo</option>
                          </select>
                        ) : <span className="text-gray-800 font-medium text-right">{editKonstrukcija || "—"}</span>}
                      </div>
                      {/* Seizmična cona — vedno readonly */}
                      <div className="flex justify-between px-4 py-2">
                        <span className="text-gray-500 shrink-0 mr-3">Seizmična cona</span>
                        <span className="text-gray-800 font-medium">{seizmicni.cona} (PGA {seizmicni.pga}g)</span>
                      </div>
                      {/* Ogrevanje */}
                      <div className="flex justify-between items-center px-4 py-2">
                        <span className="text-gray-500 shrink-0 mr-3">Ogrevanje</span>
                        {editMode ? (
                          <select value={editOgrevanje} onChange={e => setEditOgrevanje(e.target.value)}
                            className="border border-gray-300 rounded px-2 py-0.5 text-sm bg-white">
                            <option value="Centralno (plin)">Centralno (plin)</option>
                            <option value="Električno / drugo">Električno / drugo</option>
                            <option value="Daljinsko ogrevanje">Daljinsko ogrevanje</option>
                            <option value="Lesna biomasa">Lesna biomasa</option>
                            <option value="Toplotna črpalka">Toplotna črpalka</option>
                          </select>
                        ) : <span className="text-gray-800 font-medium">{editOgrevanje}</span>}
                      </div>
                    </div>
                    {editMode && <p className="text-[11px] text-amber-600 mt-1.5">Urejate podatke — spremembe vplivajo samo na izračun premije.</p>}
                    {!editMode && <p className="text-[11px] text-gray-400 mt-1.5">Vir: Kataster nepremičnin · ARSO · GURS</p>}
                  </div>

                  {selectedTipi.length > 0 && (
                    <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3">
                      <p className="text-xs text-green-700 font-semibold mb-1">Skupna indikativna premija za izbrane tipe</p>
                      <p className="text-lg font-bold text-green-800">
                        {selectedTipi.reduce((s, t) => s + t.premijaMin, 0).toLocaleString("sl-SI")} &euro; &ndash;{" "}
                        {selectedTipi.reduce((s, t) => s + t.premijaMax, 0).toLocaleString("sl-SI")} &euro;/leto
                      </p>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button disabled={selectedTypes.length === 0} onClick={() => setCurrentStep(2)}
                      className="rounded-lg bg-[#2d6a4f] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#245a42] disabled:opacity-40 transition-colors">
                      Naprej &rarr;
                    </button>
                  </div>
                </>
              )}

              {/* KORAK 2 */}
              {currentStep === 2 && (
                <>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Dodatni podatki za natan&#269;en izra&#269;un</p>
                  <div className="space-y-3">
                    {showTipStrehe && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Tip strehe</label>
                        <select value={tipStrehe} onChange={e => setTipStrehe(e.target.value)} className={selectClass}>
                          <option value="dvokapnica">Dvokapnica</option>
                          <option value="ravna">Ravna streha (+15%)</option>
                          <option value="mansarda">Mansarda</option>
                          <option value="enokapnica">Enokapnica</option>
                        </select>
                      </div>
                    )}
                    {showAlarm && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Protivlomna za&#353;&#269;ita</label>
                        <select value={alarm} onChange={e => setAlarm(e.target.value)} className={selectClass}>
                          <option value="brez">Brez</option>
                          <option value="alarm">Alarmni sistem (&minus;5%)</option>
                          <option value="resetke">Re&#353;etke na oknih</option>
                          <option value="alarm+resetke">Alarm + re&#353;etke (&minus;10%)</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">&#352;kode zadnjih 5 let</label>
                      <select value={skode} onChange={e => setSkode(e.target.value)} className={selectClass}>
                        <option value="0">Ni prijavljenih &#353;kod</option>
                        <option value="1">1 &#353;koda (+15%)</option>
                        <option value="2+">2 ali ve&#269; &#353;kod (+35%)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Pla&#269;ilo premije</label>
                      <select value={placilo} onChange={e => setPlacilo(e.target.value)} className={selectClass}>
                        <option value="letno">Letno</option>
                        <option value="mesecno">Mese&#269;no (+3%)</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="text-[11px] text-blue-500 uppercase tracking-wide mb-0.5">Prilagojena skupna premija</p>
                    <p className="text-lg font-bold text-blue-800">
                      {Math.round(selectedTipi.reduce((s, t) => s + t.premijaMin, 0) * skupniMod).toLocaleString("sl-SI")} &euro; &ndash;{" "}
                      {Math.round(selectedTipi.reduce((s, t) => s + t.premijaMax, 0) * skupniMod).toLocaleString("sl-SI")} &euro;/leto
                    </p>
                    <p className="text-[11px] text-blue-400 mt-0.5">Posodobljeno glede na va&#353;e podatke</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <button onClick={() => setCurrentStep(1)} className="text-sm text-gray-500 hover:text-gray-700">&larr; Nazaj</button>
                    <button onClick={() => setCurrentStep(3)}
                      className="rounded-lg bg-[#2d6a4f] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#245a42] transition-colors">
                      Primerjaj ponudnike &rarr;
                    </button>
                  </div>
                </>
              )}

              {/* KORAK 3 */}
              {currentStep === 3 && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Primerjava ponudnikov</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Prikazano za: {selectedTipi.map(t => t.naziv.split(" ")[0]).join(", ")}
                    </p>
                  </div>

                  <div className="space-y-3">
                    {PONUDNIKI.map(p => {
                      const perType = selectedTipi.map(tip => ({
                        naziv: tip.naziv,
                        min: Math.round(tip.premijaMin * p.mod * skupniMod),
                        max: Math.round(tip.premijaMax * p.mod * skupniMod),
                      }));
                      const skupajMin = perType.reduce((s, t) => s + t.min, 0);
                      const skupajMax = perType.reduce((s, t) => s + t.max, 0);
                      const isSelected = selectedPonudnik === p.naziv;

                      return (
                        <div key={p.naziv} className={`rounded-lg border px-4 py-3 transition-all ${
                          isSelected ? "border-[#2d6a4f] bg-green-50" : "border-gray-200 bg-white"
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">{p.logo}</div>
                              <span className="text-sm font-semibold text-gray-800">{p.naziv}</span>
                            </div>
                            <button onClick={() => setSelectedPonudnik(isSelected ? null : p.naziv)}
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                isSelected ? "bg-[#2d6a4f] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}>
                              {isSelected ? "\u2713 Izbran" : "Izberi"}
                            </button>
                          </div>
                          <div className="space-y-1">
                            {perType.map(t => (
                              <div key={t.naziv} className="flex justify-between text-xs text-gray-500">
                                <span>{t.naziv.split(" ")[0]}:</span>
                                <span className="tabular-nums">{t.min.toLocaleString("sl-SI")} &euro; &ndash; {t.max.toLocaleString("sl-SI")} &euro;</span>
                              </div>
                            ))}
                            <div className="flex justify-between text-sm font-semibold text-gray-800 border-t border-gray-100 pt-1 mt-1">
                              <span>Skupaj:</span>
                              <span className="tabular-nums">{skupajMin.toLocaleString("sl-SI")} &euro; &ndash; {skupajMax.toLocaleString("sl-SI")} &euro;/leto</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedPonudnik && (
                    <div className="space-y-3 border-t border-gray-100 pt-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                        Kontaktni podatki za ponudbo od {selectedPonudnik}
                      </p>
                      <input type="text" placeholder="Ime in priimek" value={ime} onChange={e => setIme(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <input type="tel" placeholder="Telefonska &#353;tevilka" value={tel} onChange={e => setTel(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                        Demo: podatki shranjeni za testiranje. Dejanska sklenitev prihaja.
                      </div>
                      {sendStatus === "sent" && (
                        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 font-medium">
                          Zahtevek poslan. Kontaktirali vas bomo.
                        </div>
                      )}
                      {sendStatus === "error" && (
                        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                          Pri&#353;lo je do napake. Poskusite znova.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button onClick={() => setCurrentStep(2)} className="text-sm text-gray-500 hover:text-gray-700">&larr; Nazaj</button>
                    {selectedPonudnik && (
                      <button onClick={handleSend} disabled={sendStatus === "sending" || sendStatus === "sent"}
                        className="rounded-lg bg-gray-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 transition-colors">
                        {sendStatus === "sending" ? "Po&#353;iljam..." : "Skleni \u2192"}
                      </button>
                    )}
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ServicesSection() {
  const cards = [
    { title: "Kredit za prenovo", desc: "Primerjajte ponudbe bank za stanovanjski kredit" },
    { title: "Zavarovanje nepremičnine", desc: "Zavarovajte svojo naložbo po ugodni ceni" },
    { title: "Energetska sanacija", desc: "Preverite subvencije Eko sklada za energetsko prenovo" },
  ];
  return (
    <section>
      <Label>Uredite z enim klikom</Label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.title} className="rounded-md border border-gray-100 bg-white p-5 shadow-sm">
            <h5 className="font-medium text-sm text-gray-800">{c.title}</h5>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{c.desc}</p>
            <span className="inline-block mt-3 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-400">Kmalu</span>
          </div>
        ))}
      </div>
    </section>
  );
}
