"use client";

import { useState, useEffect } from "react";

interface Prostor {
  vrsta: string;
  povrsina: number | null;
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
    prikljucki: {
      elektrika: boolean;
      plin: boolean;
      vodovod: boolean;
      kanalizacija: boolean;
    };
  };
  deliStavbe: DelStavbe[];
  energetskaIzkaznica: EnergyData | null;
  parcele?: Parcela[];
  renVrednost?: RenVrednost | null;
  etnAnaliza?: EtnAnaliza | null;
  requestedDel?: number;
}

const ENERGY_COLORS: Record<string, string> = {
  A1: "bg-green-600",
  A2: "bg-green-500",
  B1: "bg-lime-500",
  B2: "bg-lime-400",
  C: "bg-yellow-400 text-black",
  D: "bg-amber-400 text-black",
  E: "bg-orange-500",
  F: "bg-red-500",
  G: "bg-red-700",
};

function Check({ on }: { on: boolean }) {
  return (
    <span className={on ? "text-green-600" : "text-red-400"}>
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
  requestedDel,
}: PropertyCardProps) {
  const [selectedDel, setSelectedDel] = useState<number | null>(null);

  const filteredParts =
    requestedDel != null
      ? deliStavbe.filter((d) => d.stDela === requestedDel)
      : deliStavbe;

  const isMultiUnit = !requestedDel && deliStavbe.length > 1;
  const activePart =
    selectedDel != null
      ? deliStavbe.find((d) => d.stDela === selectedDel) ?? null
      : null;

  const idStr = [
    enolicniId.koId,
    enolicniId.stStavbe,
    selectedDel ?? enolicniId.stDelaStavbe,
  ]
    .filter((v) => v != null)
    .join(" / ");

  // Structured data (schema.org/RealEstateListing)
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
    ...(stavba.povrsina && { floorSize: { "@type": "QuantitativeValue", value: stavba.povrsina, unitText: "m2" } }),
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden text-left print:shadow-none print:border-0">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Header */}
      <div className="bg-[#2d6a4f] px-6 py-4 text-white print:bg-white print:text-black print:border-b-2 print:border-[#2d6a4f]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold print:text-[#2d6a4f]">{naslov}</h3>
            <p className="text-sm text-green-200 print:text-gray-500">KO / stavba / del: {idStr}</p>
          </div>
          <button
            onClick={() => window.print()}
            title="Natisni poročilo"
            className="print:hidden flex-shrink-0 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            aria-label="Natisni poročilo o nepremičnini"
          >
            🖨️ Natisni
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <BuildingSection stavba={stavba} />

        {/* Priključki */}
        <section>
          <SectionTitle>Priključki</SectionTitle>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              <Check on={stavba.prikljucki.elektrika} /> Elektrika
            </span>
            <span>
              <Check on={stavba.prikljucki.plin} /> Plin
            </span>
            <span>
              <Check on={stavba.prikljucki.vodovod} /> Vodovod
            </span>
            <span>
              <Check on={stavba.prikljucki.kanalizacija} /> Kanalizacija
            </span>
          </div>
        </section>

        {/* Multi-unit: selectable list */}
        {isMultiUnit && !activePart && (
          <section>
            <SectionTitle>
              Deli stavbe ({deliStavbe.length}) — izberite enoto
            </SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {deliStavbe.map((d) => (
                <button
                  key={d.stDela}
                  onClick={() => setSelectedDel(d.stDela)}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm text-left hover:border-[#2d6a4f] hover:bg-[#2d6a4f]/5 transition-colors"
                >
                  <div>
                    <span className="font-medium">Del stavbe {d.stDela}</span>
                    {d.vrsta && (
                      <span className="ml-2 text-muted-foreground">
                        — {d.vrsta}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-right">
                    {d.povrsina != null && <span>{d.povrsina} m&sup2;</span>}
                    {d.uporabnaPovrsina != null && (
                      <span className="ml-2 text-xs">
                        (upor. {d.uporabnaPovrsina} m&sup2;)
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Multi-unit: selected unit detail */}
        {isMultiUnit && activePart && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Del stavbe {activePart.stDela}</SectionTitle>
              <button
                onClick={() => setSelectedDel(null)}
                className="text-sm text-[#2d6a4f] hover:underline"
              >
                &larr; Nazaj na seznam
              </button>
            </div>
            <PartDetail part={activePart} />
            <div className="mt-6 space-y-6">
              <ParceleSection parcele={parcele} />
              <RenVrednostSection data={renVrednost} />
              <VrednostnaAnalizaSection data={etnAnaliza} />
              <EnergyCertificateSection data={energetskaIzkaznica} />
              <EnergetskiIzracunSection energetskaIzkaznica={energetskaIzkaznica} />
              <VzdrževalniPosegiSection stavba={stavba} part={activePart} />
              <AffiliateSectionPlaceholder />
            </div>
          </section>
        )}

        {/* Single unit or filtered */}
        {!isMultiUnit && filteredParts.length > 0 && (
          <section>
            <SectionTitle>
              {filteredParts.length === 1
                ? `Del stavbe ${filteredParts[0].stDela}`
                : `Deli stavbe (${filteredParts.length})`}
            </SectionTitle>
            {filteredParts.map((d) => (
              <PartDetail key={d.stDela} part={d} />
            ))}
          </section>
        )}

        {!isMultiUnit && (
          <>
            <ParceleSection parcele={parcele} />
            <RenVrednostSection data={renVrednost} />
            <VrednostnaAnalizaSection data={etnAnaliza} />
            <EnergyCertificateSection data={energetskaIzkaznica} />
            <EnergetskiIzracunSection energetskaIzkaznica={energetskaIzkaznica} />
            <VzdrževalniPosegiSection
              stavba={stavba}
              part={filteredParts[0] ?? null}
            />
            <AffiliateSectionPlaceholder />
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-sm font-semibold text-[#2d6a4f] uppercase tracking-wide mb-3">
      {children}
    </h4>
  );
}

function BuildingSection({ stavba }: { stavba: PropertyCardProps["stavba"] }) {
  return (
    <section>
      <SectionTitle>Podatki o stavbi</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Field label="Leto izgradnje" value={stavba.letoIzgradnje} />
        <Field label="Obnova fasade" value={stavba.letoObnove.fasade} />
        <Field label="Obnova strehe" value={stavba.letoObnove.strehe} />
        <Field label="Etaže" value={stavba.steviloEtaz} />
        <Field label="Stanovanj" value={stavba.steviloStanovanj} />
        <Field
          label="Bruto površina"
          value={
            stavba.povrsina != null ? `${stavba.povrsina} m\u00B2` : null
          }
        />
        <Field label="Tip stavbe" value={stavba.tip} />
        <Field label="Konstrukcija" value={stavba.konstrukcija} />
      </div>
    </section>
  );
}

function PartDetail({ part }: { part: DelStavbe }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Field label="Številka dela" value={part.stDela} />
        <Field
          label="Površina"
          value={part.povrsina != null ? `${part.povrsina} m\u00B2` : null}
        />
        <Field
          label="Uporabna površina"
          value={
            part.uporabnaPovrsina != null
              ? `${part.uporabnaPovrsina} m\u00B2`
              : null
          }
        />
        <Field label="Vrsta rabe" value={part.vrsta} />
        <Field label="Obnova instalacij" value={part.letoObnoveInstalacij} />
        <Field label="Obnova oken" value={part.letoObnoveOken} />
        {part.dvigalo && <Field label="Dvigalo" value="Da" />}
      </div>

      {/* Room breakdown */}
      {part.prostori.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Prostori
          </h5>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Vrsta prostora</th>
                  <th className="pb-2 text-right">Površina</th>
                </tr>
              </thead>
              <tbody>
                {part.prostori.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{r.vrsta}</td>
                    <td className="py-1.5 text-right">
                      {r.povrsina != null
                        ? `${r.povrsina} m\u00B2`
                        : "\u2014"}
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

function EnergyCertificateSection({ data }: { data: EnergyData | null }) {
  return (
    <section>
      <SectionTitle>Energetska izkaznica</SectionTitle>
      {data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-base font-bold text-white ${ENERGY_COLORS[data.razred] ?? "bg-gray-400"}`}
            >
              {data.razred}
            </span>
            <div className="text-sm text-muted-foreground">
              <p>Veljavna do {data.veljaDo}</p>
              {data.tip && <p>Tip: {data.tip}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <Field
              label="Potrebna toplota"
              value={
                data.potrebnaTopota != null
                  ? `${data.potrebnaTopota} kWh/m\u00B2a`
                  : null
              }
            />
            <Field
              label="Dovedena energija"
              value={
                data.dovedenaEnergija != null
                  ? `${data.dovedenaEnergija} kWh/m\u00B2a`
                  : null
              }
            />
            <Field
              label="Električna energija"
              value={
                data.elektricnaEnergija != null
                  ? `${data.elektricnaEnergija} kWh/m\u00B2a`
                  : null
              }
            />
            <Field
              label="Primarna energija"
              value={
                data.primaryEnergy != null
                  ? `${data.primaryEnergy} kWh/m\u00B2a`
                  : null
              }
            />
            <Field
              label="CO\u2082 emisije"
              value={data.co2 != null ? `${data.co2} kg/m\u00B2a` : null}
            />
            <Field
              label="Kondicionirana površina"
              value={
                data.kondicionirana != null
                  ? `${data.kondicionirana} m\u00B2`
                  : null
              }
            />
            <Field label="Datum izdaje" value={data.datumIzdaje} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Ni energetske izkaznice
        </p>
      )}
    </section>
  );
}

function ParceleSection({ parcele }: { parcele?: Parcela[] }) {
  if (!parcele || parcele.length === 0) return null;
  return (
    <section>
      <SectionTitle>Zemljišče</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4">Parcela</th>
              <th className="pb-2 pr-4 text-right">Površina</th>
              <th className="pb-2 pr-4">Vrsta rabe</th>
              <th className="pb-2 text-right">Boniteta</th>
            </tr>
          </thead>
          <tbody>
            {parcele.map((p, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5 pr-4">{p.parcelnaStevila}</td>
                <td className="py-1.5 pr-4 text-right">
                  {p.povrsina != null ? `${p.povrsina} m\u00B2` : "\u2014"}
                </td>
                <td className="py-1.5 pr-4">{p.vrstaRabe ?? "\u2014"}</td>
                <td className="py-1.5 text-right">
                  {p.boniteta != null ? p.boniteta : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RenVrednostSection({ data }: { data?: RenVrednost | null }) {
  if (!data) return null;
  return (
    <section>
      <SectionTitle>Posplošena tržna vrednost (REN)</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field
          label="Vrednost"
          value={`${data.vrednost.toLocaleString("sl-SI")} \u20AC`}
        />
        <Field label="Datum ocene" value={data.datumOcene} />
      </div>
    </section>
  );
}

// --- Energy class heating needs (kWh/m2a) ---
const ENERGY_CLASS_HEATING: Record<string, number> = {
  A1: 10, A2: 25, B1: 50, B2: 75, C: 110, D: 150, E: 200, F: 250, G: 300,
};
const HEATING_PRICE_EUR = 0.12;

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
      costRange: `${fmt(fasadaArea * 80)} - ${fmt(fasadaArea * 120)} \u20AC`,
      midCost: fasadaArea * 100,
    },
    {
      name: "Menjava oken",
      costRange: `${fmt(windowCount * 400)} - ${fmt(windowCount * 800)} \u20AC`,
      midCost: windowCount * 600,
    },
    {
      name: "Toplotna \u010Drpalka",
      costRange: "8.000 - 15.000 \u20AC",
      midCost: 11500,
    },
    {
      name: "Stre\u0161na izolacija",
      costRange: `${fmt(roofArea * 40)} - ${fmt(roofArea * 80)} \u20AC`,
      midCost: roofArea * 60,
    },
  ];

  return (
    <section>
      <SectionTitle>Energetska analiza</SectionTitle>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Field
            label="Letni stro\u0161ek ogrevanja"
            value={`${fmt(annualCost)} \u20AC`}
          />
          <Field
            label="Prihranek do B2"
            value={savingsB2 > 0 ? `${fmt(savingsB2)} \u20AC/leto` : "Ni prihranka"}
          />
          <Field
            label="Prihranek do A2"
            value={savingsA2 > 0 ? `${fmt(savingsA2)} \u20AC/leto` : "Ni prihranka"}
          />
        </div>

        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Predlagane izbolj\u0161ave
          </h5>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Ukrep</th>
                  <th className="pb-2 pr-4 text-right">Ocena stro\u0161ka</th>
                  <th className="pb-2 text-right">ROI (let)</th>
                </tr>
              </thead>
              <tbody>
                {improvements.map((imp) => {
                  const roi = savingsB2 > 0 ? imp.midCost / savingsB2 : null;
                  return (
                    <tr key={imp.name} className="border-b last:border-0">
                      <td className="py-1.5 pr-4">{imp.name}</td>
                      <td className="py-1.5 pr-4 text-right">{imp.costRange}</td>
                      <td className="py-1.5 text-right">
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

  const trendIcon =
    data.trend === "rast"
      ? "\u2191"
      : data.trend === "padec"
        ? "\u2193"
        : data.trend === "stabilno"
          ? "\u2192"
          : null;

  const trendColor =
    data.trend === "rast"
      ? "text-green-600"
      : data.trend === "padec"
        ? "text-red-600"
        : "text-yellow-600";

  return (
    <section>
      <SectionTitle>Vrednostna analiza (ETN)</SectionTitle>
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Field
            label="Povpre\u010Dna cena/m\u00B2"
            value={`${data.povprecnaCenaM2.toLocaleString("sl-SI")} \u20AC`}
          />
          <Field
            label="Min cena/m\u00B2"
            value={`${data.minCenaM2.toLocaleString("sl-SI")} \u20AC`}
          />
          <Field
            label="Max cena/m\u00B2"
            value={`${data.maxCenaM2.toLocaleString("sl-SI")} \u20AC`}
          />
          <Field
            label="\u0160t. transakcij"
            value={data.steviloTransakcij}
          />
          {data.ocenjenaTrznaVrednost != null && (
            <Field
              label="Ocenjena tr\u017Ena vrednost"
              value={`${data.ocenjenaTrznaVrednost.toLocaleString("sl-SI")} \u20AC`}
            />
          )}
          {data.trend && (
            <div>
              <span className="text-muted-foreground">Trend</span>
              <p className={`font-medium ${trendColor}`}>
                {trendIcon} {data.trend === "rast" ? "Rast" : data.trend === "padec" ? "Padec" : "Stabilno"}
                {data.zadnjeLeto != null && data.predLeto != null && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({data.predLeto.toLocaleString("sl-SI")} → {data.zadnjeLeto.toLocaleString("sl-SI")} \u20AC/m\u00B2)
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const MAINTENANCE_ITEMS = [
  { name: "Fasada", lifespan: 30, key: "fasade" as const },
  { name: "Stre\u0161na kritina", lifespan: 40, key: "strehe" as const },
  { name: "Instalacije", lifespan: 30, key: "instalacije" as const },
  { name: "Okna", lifespan: 25, key: "okna" as const },
];

function VzdrževalniPosegiSection({
  stavba,
  part,
}: {
  stavba: PropertyCardProps["stavba"];
  part: DelStavbe | null;
}) {
  const currentYear = 2026;
  const baseYear = stavba.letoIzgradnje;
  if (!baseYear) return null;

  const items: { name: string; age: number; lifespan: number; urgency: string; color: string }[] = [];

  for (const m of MAINTENANCE_ITEMS) {
    let yearInstalled: number | null = null;
    if (m.key === "fasade") {
      yearInstalled = stavba.letoObnove.fasade ?? baseYear;
    } else if (m.key === "strehe") {
      yearInstalled = stavba.letoObnove.strehe ?? baseYear;
    } else if (m.key === "instalacije") {
      yearInstalled = part?.letoObnoveInstalacij ?? baseYear;
    } else if (m.key === "okna") {
      yearInstalled = part?.letoObnoveOken ?? baseYear;
    }
    if (!yearInstalled) continue;

    const age = currentYear - yearInstalled;
    if (age >= m.lifespan) {
      items.push({ name: m.name, age, lifespan: m.lifespan, urgency: "Nujno", color: "text-red-600 bg-red-50" });
    } else if (age >= m.lifespan * 0.85) {
      items.push({ name: m.name, age, lifespan: m.lifespan, urgency: "Priporo\u010Deno", color: "text-amber-600 bg-amber-50" });
    } else if (age >= m.lifespan * 0.70) {
      items.push({ name: m.name, age, lifespan: m.lifespan, urgency: "Planirati", color: "text-blue-600 bg-blue-50" });
    }
  }

  return (
    <section>
      <SectionTitle>Vzdr\u017Eevalni posegi</SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-green-600 italic">
          Ni nujnih vzdr\u017Eevalnih posegov
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.name}
              className={`flex items-center justify-between rounded-lg border px-4 py-2 text-sm ${item.color}`}
            >
              <div>
                <span className="font-medium">{item.name}</span>
                <span className="ml-2 text-xs opacity-75">
                  (starost: {item.age} let / \u017Eivljenjska doba: {item.lifespan} let)
                </span>
              </div>
              <span className="font-semibold">{item.urgency}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AffiliateSectionPlaceholder() {
  const cards = [
    {
      icon: "\uD83C\uDFE6",
      title: "Kredit za prenovo",
      desc: "Primerjajte ponudbe bank za stanovanjski kredit",
    },
    {
      icon: "\uD83D\uDD12",
      title: "Zavarovanje nepre\u010Dnine",
      desc: "Zavarovajte svojo nalo\u017Ebo po ugodni ceni",
    },
    {
      icon: "\u26A1",
      title: "Energetska sanacija",
      desc: "Preverite subvencije Eko sklada za energetsko prenovo",
    },
  ];

  return (
    <section>
      <SectionTitle>Storitve</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.title}
            className="rounded-lg border p-4 text-center space-y-2"
          >
            <div className="text-3xl">{c.icon}</div>
            <h5 className="font-semibold text-sm">{c.title}</h5>
            <p className="text-xs text-muted-foreground">{c.desc}</p>
            <button
              disabled
              className="mt-2 inline-flex items-center rounded-md bg-gray-100 px-3 py-1 text-xs font-medium text-gray-400 cursor-not-allowed"
            >
              Kmalu
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("sl-SI");
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
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium">{value}</p>
    </div>
  );
}
