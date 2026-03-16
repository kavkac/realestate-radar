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

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden text-left">
      {/* Header */}
      <div className="bg-[#2d6a4f] px-6 py-4 text-white">
        <h3 className="text-lg font-semibold">{naslov}</h3>
        <p className="text-sm text-green-200">KO / stavba / del: {idStr}</p>
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
              <EnergyCertificateSection data={energetskaIzkaznica} />
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
            <EnergyCertificateSection data={energetskaIzkaznica} />
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
