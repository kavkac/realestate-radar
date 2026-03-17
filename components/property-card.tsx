"use client";

import React, { useState } from "react";
import { CreditCalculator } from "./credit-calculator";

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
  lat?: number | null;
  lng?: number | null;
  requestedDel?: number;
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
  stavba,
  deliStavbe,
  energetskaIzkaznica,
  parcele,
  renVrednost,
  etnAnaliza,
  lat,
  lng,
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
          <div>
            <h3 className="text-2xl font-semibold print:text-[#2d6a4f]">
              {naslov}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-green-200 print:text-gray-500">
                Pregled podatkov o nepremičnini
              </p>
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-medium tracking-wide uppercase text-white/80 print:border-gray-300 print:text-gray-500">
                Uradni podatki
              </span>
            </div>
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

      {/* Aerial map - full width on mobile, hidden on desktop (shown in right col) */}
      <div className="lg:hidden border-b border-gray-100">
        <AerialMap lat={lat} lng={lng} naslov={naslov} />
      </div>

      <div className="lg:flex overflow-hidden">
        {/* Left column: main data (60% on desktop) */}
        <div className="lg:w-[60%] min-w-0 p-6 space-y-8">
          {/* L1: Ključni podatki */}
          <KljucniPodatki stavba={stavba} />

          {/* L2: Tehnični izpis */}
          <BuildingSection stavba={stavba} />

          {/* L2: Stanovanja in prostori */}
          {isMultiUnit && !activePart && (
            <section>
              <Label vir="Kataster nepremičnin · GURS">Stanovanja in prostori ({deliStavbe.length})</Label>
              <p className="text-sm text-gray-500 mb-3">
                Izberite enoto za podroben pregled.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {deliStavbe.map((d) => (
                  <button
                    key={d.stDela}
                    onClick={() => setSelectedDel(d.stDela)}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-left hover:border-[#2d6a4f] hover:shadow-sm transition-all"
                  >
                    <div className="text-gray-800 min-w-0">
                      <span className="font-medium">Enota {d.stDela}</span>
                      {d.vrsta && (
                        <span className="ml-1.5 text-gray-500">
                          &mdash; {d.vrsta}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-500 tabular-nums ml-auto flex items-center gap-2">
                      {d.povrsina != null && <span>{fmtDec(d.povrsina)} m&sup2;</span>}
                      {d.uporabnaPovrsina != null && (
                        <span className="text-xs text-gray-400">
                          (upor. {fmtDec(d.uporabnaPovrsina)} m&sup2;)
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {isMultiUnit && activePart && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <Label>Enota {activePart.stDela}</Label>
                <button
                  onClick={() => setSelectedDel(null)}
                  className="text-sm text-[#2d6a4f] hover:underline"
                >
                  &larr; Nazaj na seznam
                </button>
              </div>
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
          <EnergetskiIzracunSection energetskaIzkaznica={energetskaIzkaznica} />

          {/* L4: Vrednost in lastništvo (collapsible) */}
          <CollapsibleValueSection>
            <RenVrednostSection data={renVrednost} />
            <VrednostnaAnalizaSection data={etnAnaliza} />
            <LastnistvoSection data={currentPart?.lastnistvo} />
            <ParceleSection parcele={parcele} />
          </CollapsibleValueSection>

          {/* Storitve */}
          <ServicesSection />
        </div>

        {/* Right column: aerial map (40% on desktop) */}
        <div className="lg:w-[40%] min-w-0 overflow-hidden lg:border-l lg:border-gray-100 p-6 space-y-6 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <AerialMap lat={lat} lng={lng} naslov={naslov} />
        </div>
      </div>

      {/* Credit calculator - full width after all property data */}
      <div className="border-t border-gray-100 p-6">
        <CreditCalculator />
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
          <form onSubmit={handleSubmit} className="flex gap-2 max-w-sm">
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
      <span className="text-xs font-medium tracking-wider text-gray-500 uppercase">{label}</span>
      <p className="text-sm text-gray-900">{value}</p>
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

function KljucniPodatki({ stavba }: { stavba: PropertyCardProps["stavba"] }) {
  const boxes: { label: string; value: string }[] = [];

  if (stavba.letoIzgradnje) {
    boxes.push({ label: "Leto izgradnje", value: String(stavba.letoIzgradnje) });
  }
  if (stavba.steviloEtaz) {
    boxes.push({ label: "Etaže", value: String(stavba.steviloEtaz) });
  }
  if (stavba.povrsina) {
    boxes.push({ label: "Površina", value: `${fmtDec(stavba.povrsina)} m\u00B2` });
  }
  if (stavba.tip) {
    boxes.push({ label: "Tip stavbe", value: stavba.tip });
  }

  if (boxes.length === 0) return null;

  return (
    <section>
      <Label vir="Kataster nepremičnin · GURS">Ključni podatki</Label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {boxes.map((b) => (
          <div
            key={b.label}
            className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center"
          >
            <p className={`font-bold text-gray-900 leading-tight ${b.value.length > 10 ? "text-base" : b.value.length > 6 ? "text-xl" : "text-2xl"}`}>{b.value}</p>
            <p className="text-xs font-medium tracking-wider text-gray-500 uppercase mt-1">{b.label}</p>
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
        <Field label="Leto izgradnje" value={stavba.letoIzgradnje} />
        <Field label="Obnova fasade" value={stavba.letoObnove.fasade} />
        <Field label="Obnova strehe" value={stavba.letoObnove.strehe} />
        <Field label="Etaže" value={stavba.steviloEtaz} />
        <Field label="Stanovanj" value={stavba.steviloStanovanj} />
        <Field
          label="Bruto površina"
          value={stavba.povrsina != null ? `${fmtDec(stavba.povrsina)} m\u00B2` : null}
        />
        <Field label="Tip stavbe" value={stavba.tip} />
        <Field label="Konstrukcija" value={stavba.konstrukcija} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600 mt-4">
        <span><Check on={stavba.prikljucki.elektrika} /> Elektrika</span>
        <span><Check on={stavba.prikljucki.plin} /> Plin</span>
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
        <Field label="Namembnost (KN)" value={part.vrsta} />
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
      )}
    </div>
  );
}

function EnergyCertificateSection({ data }: { data: EnergyData | null }) {
  return (
    <section>
      <Label vir="Register energetskih izkaznic · MOP">Poraba energije</Label>
      {data ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span
              className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-2xl font-bold ${ENERGY_COLORS[data.razred] ?? "bg-gray-100 text-gray-800"}`}
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
      <Label vir="Zemljiški kataster · GURS">Zemljišče</Label>
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
    </section>
  );
}

function LastnistvoSection({ data }: { data?: LastnistvoRecord[] }) {
  if (!data || data.length === 0) return null;
  return (
    <section>
      <Label vir="Zemljiška knjiga · GURS">Lastništvo</Label>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-gray-500 text-xs tracking-wide">
            <th className="pb-2 pr-4 font-medium">Tip lastnika</th>
            <th className="pb-2 pr-4 font-medium">Delež</th>
            <th className="pb-2 pr-4 font-medium">Vrsta pravice</th>
            <th className="pb-2 font-medium">Datum vpisa</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
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
        borderColor: "border-l-green-400",
        pillClass: "bg-green-50 text-green-700",
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

function CollapsibleValueSection({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-t border-gray-100 pt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left group"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-800">Vrednost in lastništvo</h3>
          <p className="text-xs text-gray-400 mt-0.5">Ocenjena vrednost, transakcije, lastništvo, parcele</p>
        </div>
        <span className="text-gray-400 text-lg ml-4 group-hover:text-gray-600 transition-colors">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="mt-6 space-y-8">{children}</div>}
    </div>
  );
}

function AerialMap({
  lat,
  lng,
  naslov,
}: {
  lat?: number | null;
  lng?: number | null;
  naslov: string;
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
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-sm text-[#2d6a4f] hover:underline py-3 border border-gray-100 rounded-lg bg-gray-50"
        >
          Odpri v Google Maps
        </a>
      </div>
    );
  }

  const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=600x200&scale=2&maptype=hybrid&markers=color:red%7C${lat},${lng}&key=${apiKey}`;
  const streetViewEmbedUrl = `https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${lat},${lng}&fov=80&pitch=5&source=outdoor`;

  return (
    <div className="print:hidden space-y-2">
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={staticUrl}
          alt={`Zračni posnetek: ${naslov}`}
          className="w-full h-[160px] object-cover rounded-lg"
          loading="lazy"
        />
      </a>
      <div className="relative rounded-lg overflow-hidden">
        <iframe
          src={streetViewEmbedUrl}
          className="w-full h-[220px] border-0"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={`Street View: ${naslov}`}
        />
        <p className="text-[10px] text-gray-400 text-right pr-1 pt-1">Povlecite za rotacijo</p>
      </div>
      <p className="text-[10px] text-gray-400">Vir: Google Maps &middot; GURS koordinate</p>
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
