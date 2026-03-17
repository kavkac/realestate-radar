"use client";

import { useState } from "react";

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
  A1: "bg-green-700",
  A2: "bg-green-600",
  B1: "bg-emerald-500",
  B2: "bg-lime-500",
  C: "bg-yellow-500 text-gray-900",
  D: "bg-orange-500",
  E: "bg-orange-600",
  F: "bg-red-600",
  G: "bg-red-800",
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
          <div>
            <h3 className="text-lg font-semibold print:text-[#2d6a4f]">
              {naslov}
            </h3>
            <p className="text-sm text-green-200 print:text-gray-500 mt-0.5">
              KO / stavba / del: {idStr}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            title="Natisni poročilo"
            className="print:hidden flex-shrink-0 rounded border border-white/20 bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            aria-label="Natisni poročilo o nepremičnini"
          >
            Natisni
          </button>
        </div>
      </div>

      <div className="p-6 space-y-8">
        <BuildingSection stavba={stavba} />

        {/* Priključki */}
        <section>
          <Label>Priključki</Label>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <span><Check on={stavba.prikljucki.elektrika} /> Elektrika</span>
            <span><Check on={stavba.prikljucki.plin} /> Plin</span>
            <span><Check on={stavba.prikljucki.vodovod} /> Vodovod</span>
            <span><Check on={stavba.prikljucki.kanalizacija} /> Kanalizacija</span>
          </div>
        </section>

        {/* Multi-unit selector */}
        {isMultiUnit && !activePart && (
          <section>
            <Label>Deli stavbe ({deliStavbe.length})</Label>
            <p className="text-sm text-gray-500 mb-3">
              Izberite enoto za podroben pregled.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {deliStavbe.map((d) => (
                <button
                  key={d.stDela}
                  onClick={() => setSelectedDel(d.stDela)}
                  className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-left hover:border-[#2d6a4f] hover:shadow-sm transition-all"
                >
                  <div className="text-gray-800">
                    <span className="font-medium">Del {d.stDela}</span>
                    {d.vrsta && (
                      <span className="ml-1.5 text-gray-500">
                        &mdash; {d.vrsta}
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 text-right tabular-nums">
                    {d.povrsina != null && <span>{d.povrsina} m&sup2;</span>}
                    {d.uporabnaPovrsina != null && (
                      <span className="ml-2 text-xs text-gray-400">
                        (upor. {d.uporabnaPovrsina} m&sup2;)
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Multi-unit: selected detail */}
        {isMultiUnit && activePart && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <Label>Del stavbe {activePart.stDela}</Label>
              <button
                onClick={() => setSelectedDel(null)}
                className="text-sm text-[#2d6a4f] hover:underline"
              >
                &larr; Nazaj na seznam
              </button>
            </div>
            <PartDetail part={activePart} />
            <div className="mt-8 space-y-8">
              <ParceleSection parcele={parcele} />
              <RenVrednostSection data={renVrednost} />
              <VrednostnaAnalizaSection data={etnAnaliza} />
              <EnergyCertificateSection data={energetskaIzkaznica} />
              <EnergetskiIzracunSection energetskaIzkaznica={energetskaIzkaznica} />
              <MaintenanceSection stavba={stavba} part={activePart} />
              <ServicesSection />
            </div>
          </section>
        )}

        {/* Single unit or filtered */}
        {!isMultiUnit && filteredParts.length > 0 && (
          <section>
            <Label>
              {filteredParts.length === 1
                ? `Del stavbe ${filteredParts[0].stDela}`
                : `Deli stavbe (${filteredParts.length})`}
            </Label>
            {filteredParts.map((d) => (
              <PartDetail key={d.stDela} part={d} />
            ))}
          </section>
        )}

        {!isMultiUnit && (
          <div className="space-y-8">
            <ParceleSection parcele={parcele} />
            <RenVrednostSection data={renVrednost} />
            <VrednostnaAnalizaSection data={etnAnaliza} />
            <EnergyCertificateSection data={energetskaIzkaznica} />
            <EnergetskiIzracunSection energetskaIzkaznica={energetskaIzkaznica} />
            <MaintenanceSection
              stavba={stavba}
              part={filteredParts[0] ?? null}
            />
            <ServicesSection />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Shared components ---

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
      {children}
    </h4>
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
      <span className="text-gray-500 text-xs">{label}</span>
      <p className="font-medium text-gray-800">{value}</p>
    </div>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("sl-SI");
}

// --- Sections ---

function BuildingSection({ stavba }: { stavba: PropertyCardProps["stavba"] }) {
  return (
    <section>
      <Label>Podatki o stavbi</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <Field label="Leto izgradnje" value={stavba.letoIzgradnje} />
        <Field label="Obnova fasade" value={stavba.letoObnove.fasade} />
        <Field label="Obnova strehe" value={stavba.letoObnove.strehe} />
        <Field label="Etaže" value={stavba.steviloEtaz} />
        <Field label="Stanovanj" value={stavba.steviloStanovanj} />
        <Field
          label="Bruto površina"
          value={stavba.povrsina != null ? `${stavba.povrsina} m²` : null}
        />
        <Field label="Tip stavbe" value={stavba.tip} />
        <Field label="Konstrukcija" value={stavba.konstrukcija} />
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
          value={part.povrsina != null ? `${part.povrsina} m²` : null}
        />
        <Field
          label="Uporabna površina"
          value={
            part.uporabnaPovrsina != null
              ? `${part.uporabnaPovrsina} m²`
              : null
          }
        />
        <Field label="Vrsta rabe" value={part.vrsta} />
        <Field label="Obnova instalacij" value={part.letoObnoveInstalacij} />
        <Field label="Obnova oken" value={part.letoObnoveOken} />
        {part.dvigalo && <Field label="Dvigalo" value="Da" />}
      </div>

      {part.prostori.length > 0 && (
        <div>
          <SubLabel>Prostori</SubLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-4 font-medium">Vrsta prostora</th>
                <th className="pb-2 text-right font-medium">Površina</th>
              </tr>
            </thead>
            <tbody>
              {part.prostori.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 pr-4 text-gray-700">{r.vrsta}</td>
                  <td className="py-2 text-right tabular-nums text-gray-700">
                    {r.povrsina != null ? `${r.povrsina} m²` : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EnergyCertificateSection({ data }: { data: EnergyData | null }) {
  return (
    <section>
      <Label>Energetska izkaznica</Label>
      {data ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span
              className={`inline-flex items-center justify-center rounded px-4 py-2 text-lg font-bold text-white ${ENERGY_COLORS[data.razred] ?? "bg-gray-400"}`}
            >
              {data.razred}
            </span>
            <div className="text-sm text-gray-500">
              <p>Veljavna do {data.veljaDo}</p>
              {data.tip && <p className="mt-0.5">Tip: {data.tip}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <Field
              label="Potrebna toplota"
              value={
                data.potrebnaTopota != null
                  ? `${data.potrebnaTopota} kWh/m²a`
                  : null
              }
            />
            <Field
              label="Dovedena energija"
              value={
                data.dovedenaEnergija != null
                  ? `${data.dovedenaEnergija} kWh/m²a`
                  : null
              }
            />
            <Field
              label="Električna energija"
              value={
                data.elektricnaEnergija != null
                  ? `${data.elektricnaEnergija} kWh/m²a`
                  : null
              }
            />
            <Field
              label="Primarna energija"
              value={
                data.primaryEnergy != null
                  ? `${data.primaryEnergy} kWh/m²a`
                  : null
              }
            />
            <Field
              label={"CO\u2082 emisije"}
              value={data.co2 != null ? `${data.co2} kg/m²a` : null}
            />
            <Field
              label="Kondicionirana površina"
              value={
                data.kondicionirana != null
                  ? `${data.kondicionirana} m²`
                  : null
              }
            />
            <Field label="Datum izdaje" value={data.datumIzdaje} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">
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
      <Label>Zemljišče</Label>
      <table className="w-full text-sm">
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
            <tr key={i} className="border-b border-gray-50 last:border-0">
              <td className="py-2 pr-4">{p.parcelnaStevila}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {p.povrsina != null ? `${p.povrsina} m²` : "\u2014"}
              </td>
              <td className="py-2 pr-4">{p.vrstaRabe ?? "\u2014"}</td>
              <td className="py-2 text-right tabular-nums">
                {p.boniteta != null ? p.boniteta : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RenVrednostSection({ data }: { data?: RenVrednost | null }) {
  if (!data) return null;
  return (
    <section>
      <Label>{"Posplošena tržna vrednost (REN)"}</Label>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Field
          label="Vrednost"
          value={`${data.vrednost.toLocaleString("sl-SI")} \u20AC`}
        />
        <Field label="Datum ocene" value={data.datumOcene} />
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
      <Label>Energetska analiza</Label>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-4 font-medium">Ukrep</th>
                <th className="pb-2 pr-4 text-right font-medium">
                  Ocena stroška
                </th>
                <th className="pb-2 text-right font-medium">ROI (let)</th>
              </tr>
            </thead>
            <tbody>
              {improvements.map((imp) => {
                const roi =
                  savingsB2 > 0 ? imp.midCost / savingsB2 : null;
                return (
                  <tr
                    key={imp.name}
                    className="border-b border-gray-50 last:border-0"
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
      <Label>Vrednostna analiza (ETN)</Label>
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
        <Field label="Št. transakcij" value={data.steviloTransakcij} />
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
        borderColor: "border-l-gray-300",
        pillClass: "bg-gray-100 text-gray-600",
      });
    }
  }

  return (
    <section>
      <Label>Vzdrževalni posegi</Label>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          Ni nujnih vzdrževalnih posegov
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.name}
              className={`flex items-center justify-between rounded border border-gray-100 border-l-4 ${item.borderColor} bg-white px-4 py-3 text-sm`}
            >
              <div className="text-gray-700">
                <span className="font-medium">{item.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  (starost: {item.age} let / življenjska doba: {item.lifespan}{" "}
                  let)
                </span>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${item.pillClass}`}
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
      <Label>Storitve</Label>
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
