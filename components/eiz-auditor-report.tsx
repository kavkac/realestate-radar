"use client";

/**
 * EIZ Auditor Report — UI for certified energy auditors
 *
 * Shows pre-filled data package with full provenance per field.
 * Auditor can override any value and export to PDF/Excel.
 *
 * Color coding:
 *   🟢 high confidence — from official registers (GURS, cert)
 *   🟡 medium — from typed values (TABULA), should confirm
 *   🔴 low — statistical prior, verify on site
 *   ⚫ missing — auditor must fill in
 */

import React, { useState, useCallback } from "react";
import type { EizPrefillReport, PrefillField, DataSource, Confidence } from "@/lib/eiz-prefill";

// ─── Source labels ────────────────────────────────────────────────────────────
// Uradni registri — podatki so neposredno iz javnih registrov, brez izpeljave
const OFFICIAL_SOURCES = new Set<DataSource>(["GURS_REN", "GURS_EVS", "GURS_KN"]);

const SOURCE_LABEL: Record<DataSource, string> = {
  GURS_REN:          "GURS · Register nepremičnin",
  GURS_EVS:          "GURS · Evidenca stavb",
  GURS_KN:           "GURS · KN / eProstor",
  TABULA_SLO:        "TABULA SLO",
  OPEN_METEO_ERA5:   "Open-Meteo ERA5",
  ARSO_JRC:          "ARSO / JRC",
  DH_SPATIAL:        "DH omrežje (prostorski sloj)",
  MAPILLARY_ML:      "Mapillary ML",
  STATISTICAL_PRIOR: "Statistični prior",
  USER_INPUT:        "Vnesel lastnik",
  AUDITOR_INPUT:     "Vnos energetičarja",
};

const SOURCE_COLOR: Record<DataSource, string> = {
  GURS_REN:          "bg-blue-50 text-blue-800 border-blue-400",
  GURS_EVS:          "bg-blue-50 text-blue-800 border-blue-400",
  GURS_KN:           "bg-blue-50 text-blue-800 border-blue-400",
  TABULA_SLO:        "bg-indigo-50 text-indigo-700 border-indigo-200",
  OPEN_METEO_ERA5:   "bg-teal-50 text-teal-700 border-teal-200",
  ARSO_JRC:          "bg-teal-50 text-teal-700 border-teal-200",
  DH_SPATIAL:        "bg-purple-50 text-purple-700 border-purple-200",
  MAPILLARY_ML:      "bg-violet-50 text-violet-700 border-violet-200",
  STATISTICAL_PRIOR: "bg-amber-50 text-amber-700 border-amber-200",
  USER_INPUT:        "bg-green-50 text-green-700 border-green-200",
  AUDITOR_INPUT:     "bg-gray-100 text-gray-600 border-gray-200",
};

const CONFIDENCE_DOT: Record<Confidence, { dot: string; label: string }> = {
  high:    { dot: "bg-emerald-500", label: "visoko zaupanje" },
  medium:  { dot: "bg-amber-400",   label: "srednje zaupanje" },
  low:     { dot: "bg-orange-400",  label: "nizko — verificirajte" },
  missing: { dot: "bg-gray-300",    label: "manjka — vnesite" },
};

const ENERGY_CLASS_COLORS: Record<string, string> = {
  "A+": "bg-green-600 text-white",
  "A":  "bg-green-500 text-white",
  "B":  "bg-lime-500 text-white",
  "C":  "bg-yellow-400 text-gray-900",
  "D":  "bg-orange-400 text-white",
  "E":  "bg-orange-500 text-white",
  "F":  "bg-red-500 text-white",
  "G":  "bg-red-700 text-white",
  "?":  "bg-gray-200 text-gray-500",
};

// ─── Field row ────────────────────────────────────────────────────────────────
function FieldRow({
  label,
  field,
  unit,
  override,
  onOverride,
}: {
  label: string;
  field: PrefillField<any>;
  unit?: string;
  override?: string;
  onOverride: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const conf = CONFIDENCE_DOT[field.confidence];
  const hasOverride = override !== undefined && override !== "";
  const displayValue = hasOverride ? override : field.value != null ? String(field.value) : "—";

  return (
    <div className={`grid grid-cols-[180px_1fr_auto] gap-2 items-start py-2 border-b border-gray-50 last:border-0 ${field.verifyOnSite ? "bg-amber-50/30" : ""}`}>
      {/* Label + confidence */}
      <div className="flex items-start gap-1.5 min-w-0">
        <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${conf.dot}`} title={conf.label} />
        <span className="text-xs text-gray-700 leading-tight">{label}</span>
        {field.verifyOnSite && (
          <span className="flex-shrink-0 text-[9px] text-amber-600 font-medium mt-0.5">↗ teren</span>
        )}
      </div>

      {/* Value + source */}
      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            type="text"
            defaultValue={hasOverride ? override : field.value != null ? String(field.value) : ""}
            onBlur={(e) => { onOverride(e.target.value); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { onOverride((e.target as HTMLInputElement).value); setEditing(false); } }}
            className="w-full text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-left w-full group"
          >
            <span className={`text-sm font-medium ${hasOverride ? "text-blue-700" : field.confidence === "missing" ? "text-gray-400 italic" : "text-gray-900"}`}>
              {displayValue}
              {unit && displayValue !== "—" ? <span className="text-gray-400 font-normal ml-0.5">{unit}</span> : null}
              {hasOverride && <span className="ml-1 text-[10px] text-blue-500">(override)</span>}
            </span>
            <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-100 text-xs">✏</span>
          </button>
        )}
        {field.note && (
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{field.note}</p>
        )}
      </div>

      {/* Source badge(s) */}
      <div className="flex flex-col items-end gap-0.5">
        {(field.sources ?? [field.source]).some(s => OFFICIAL_SOURCES.has(s)) && (
          <span className="text-[8px] text-blue-600 font-semibold uppercase tracking-wide flex items-center gap-0.5">
            🏛 Uradni register
          </span>
        )}
        <div className="flex flex-col items-end gap-0.5">
          {(field.sources ?? [field.source]).map((src, i) => (
            <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${SOURCE_COLOR[src]}`}>
              {SOURCE_LABEL[src]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────
function Section({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <span>{icon}</span>
          <span>{title}</span>
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 py-1">{children}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function EizAuditorReport({ report }: { report: EizPrefillReport }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const setField = useCallback((key: string, val: string) => {
    setOverrides(prev => ({ ...prev, [key]: val }));
  }, []);

  const ov = (key: string) => overrides[key];

  const ec = report.calculatedResults.energyClass;
  const ecColor = ENERGY_CLASS_COLORS[ec] ?? ENERGY_CLASS_COLORS["?"];

  return (
    <div className="max-w-3xl mx-auto font-sans text-sm">
      {/* Header */}
      <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Podloge za energetsko izkaznico</h1>
            <p className="text-gray-500 text-xs mt-0.5">{report.address}</p>
            <p className="text-gray-400 text-[10px] mt-0.5">EID stavbe: {report.eidStavba} · Generirano: {new Date(report.generatedAt).toLocaleDateString("sl-SI")}</p>
          </div>
          <div className="text-center flex-shrink-0">
            <div className={`inline-flex items-center justify-center w-14 h-14 rounded-lg text-2xl font-black ${ecColor}`}>
              {ec}
            </div>
            <p className="text-[9px] text-gray-400 mt-1">ocena</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-100">
          {(["high","medium","low","missing"] as Confidence[]).map(c => (
            <span key={c} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className={`w-2 h-2 rounded-full ${CONFIDENCE_DOT[c].dot}`} />
              {CONFIDENCE_DOT[c].label}
            </span>
          ))}
          <span className="flex items-center gap-1 text-[10px] text-amber-600">
            ↗ teren = verificirajte na terenu
          </span>
        </div>
      </div>

      {/* 1. Identification */}
      <Section title="1. Identifikacija" icon="🏠">
        <FieldRow label="EID stavbe" field={report.identification.eidStavba} override={ov("eid")} onOverride={v => setField("eid",v)} />
        <FieldRow label="Naslov" field={report.identification.address} override={ov("addr")} onOverride={v => setField("addr",v)} />
        <FieldRow label="Leto izgradnje" field={report.identification.yearBuilt} override={ov("year")} onOverride={v => setField("year",v)} />
        <FieldRow label="Material konstrukcije" field={report.identification.material} override={ov("mat")} onOverride={v => setField("mat",v)} />
        <FieldRow label="Tip stavbe" field={report.identification.buildingType} override={ov("type")} onOverride={v => setField("type",v)} />
        <FieldRow label="Število etaž" field={report.identification.floors} override={ov("floors")} onOverride={v => setField("floors",v)} />
        <FieldRow label="Število stanovanj" field={report.identification.dwellings} override={ov("dwell")} onOverride={v => setField("dwell",v)} />
      </Section>

      {/* 2. Geometry */}
      <Section title="2. Geometrija" icon="📐">
        <FieldRow label="Kondicionirana površina" field={report.geometry.conditionedAreaM2} unit="m²" override={ov("g_area")} onOverride={v => setField("g_area",v)} />
        <FieldRow label="Tlorisna površina" field={report.geometry.footprintM2} unit="m²" override={ov("g_fp")} onOverride={v => setField("g_fp",v)} />
        <FieldRow label="Obod tlorisa" field={report.geometry.perimeterM} unit="m" override={ov("g_perim")} onOverride={v => setField("g_perim",v)} />
        <FieldRow label="Ogrevani volumen" field={report.geometry.heatedVolumeM3} unit="m³" override={ov("g_vol")} onOverride={v => setField("g_vol",v)} />
        <FieldRow label="Površina strehe" field={report.geometry.roofAreaM2} unit="m²" override={ov("g_roof")} onOverride={v => setField("g_roof",v)} />
        <FieldRow label="A/V razmernik" field={report.geometry.svRatio} unit="m²/m³" override={ov("g_sv")} onOverride={v => setField("g_sv",v)} />
        <FieldRow label="Povp. višina etaže" field={report.geometry.avgFloorHeightM} unit="m" override={ov("g_h")} onOverride={v => setField("g_h",v)} />
        <FieldRow label="Orientacija glavne fasade" field={report.geometry.orientation} override={ov("g_orient")} onOverride={v => setField("g_orient",v)} />
        <FieldRow label="Lega stavbe" field={report.geometry.buildingPosition} override={ov("g_pos")} onOverride={v => setField("g_pos",v)} />
      </Section>

      {/* 3. Climate */}
      <Section title="3. Klimatski podatki" icon="🌡️">
        <FieldRow label="Klimatska cona" field={report.climate.climateZone} override={ov("c_zone")} onOverride={v => setField("c_zone",v)} />
        <FieldRow label="Projektna T (zunaj)" field={report.climate.designTempC} unit="°C" override={ov("c_t")} onOverride={v => setField("c_t",v)} />
        <FieldRow label="HDD (ogrev. stopinjdni)" field={report.climate.hdd} unit="Kd/a" override={ov("c_hdd")} onOverride={v => setField("c_hdd",v)} />
        <FieldRow label="Sončno jug" field={report.climate.solarSouth} unit="kWh/m²a" override={ov("c_ss")} onOverride={v => setField("c_ss",v)} />
        <FieldRow label="Sončno vzhod/zahod" field={report.climate.solarEast} unit="kWh/m²a" override={ov("c_sew")} onOverride={v => setField("c_sew",v)} />
        <FieldRow label="Sončno sever" field={report.climate.solarNorth} unit="kWh/m²a" override={ov("c_sn")} onOverride={v => setField("c_sn",v)} />
        <FieldRow label="Sončno horizontalno" field={report.climate.solarHorizontal} unit="kWh/m²a" override={ov("c_sh")} onOverride={v => setField("c_sh",v)} />
      </Section>

      {/* 4. Thermal envelope */}
      <Section title="4. Toplotna lupina" icon="🧱">
        <FieldRow label="U stena" field={report.thermalEnvelope.uWall} unit="W/m²K" override={ov("e_uw")} onOverride={v => setField("e_uw",v)} />
        <FieldRow label="U streha" field={report.thermalEnvelope.uRoof} unit="W/m²K" override={ov("e_ur")} onOverride={v => setField("e_ur",v)} />
        <FieldRow label="U tla" field={report.thermalEnvelope.uFloor} unit="W/m²K" override={ov("e_uf")} onOverride={v => setField("e_uf",v)} />
        <FieldRow label="U okna (Uw)" field={report.thermalEnvelope.uWindow} unit="W/m²K" override={ov("e_uwnd")} onOverride={v => setField("e_uwnd",v)} />
        <FieldRow label="g-vrednost oken" field={report.thermalEnvelope.gValue} override={ov("e_g")} onOverride={v => setField("e_g",v)} />
        <FieldRow label="Delež oken" field={report.thermalEnvelope.windowRatioPct} unit="%" override={ov("e_wr")} onOverride={v => setField("e_wr",v)} />
        <FieldRow label="Površina oken" field={report.thermalEnvelope.windowAreaM2} unit="m²" override={ov("e_wa")} onOverride={v => setField("e_wa",v)} />
        <FieldRow label="Toplotni mostovi (ψ)" field={report.thermalEnvelope.thermalBridgesPsiWmK} unit="W/mK" override={ov("e_psi")} onOverride={v => setField("e_psi",v)} />
        <FieldRow label="Obnova fasade" field={report.thermalEnvelope.renovationFacadeYear} override={ov("e_rf")} onOverride={v => setField("e_rf",v)} />
        <FieldRow label="Obnova strehe" field={report.thermalEnvelope.renovationRoofYear} override={ov("e_rr")} onOverride={v => setField("e_rr",v)} />
        <FieldRow label="Obnova oken" field={report.thermalEnvelope.renovationWindowYear} override={ov("e_rw")} onOverride={v => setField("e_rw",v)} />
      </Section>

      {/* 5. Ventilation */}
      <Section title="5. Prezračevanje" icon="💨">
        <FieldRow label="Tip sistema" field={report.ventilation.systemType} override={ov("v_type")} onOverride={v => setField("v_type",v)} />
        <FieldRow label="n_inf (infiltracija)" field={report.ventilation.nInf} unit="h⁻¹" override={ov("v_ninf")} onOverride={v => setField("v_ninf",v)} />
        <FieldRow label="n₅₀ (blower door)" field={report.ventilation.n50} unit="h⁻¹" override={ov("v_n50")} onOverride={v => setField("v_n50",v)} />
        <FieldRow label="Izkoristek rekuperacije" field={report.ventilation.heatRecoveryEff} override={ov("v_hrec")} onOverride={v => setField("v_hrec",v)} />
      </Section>

      {/* 6. Heating */}
      <Section title="6. Ogrevanje" icon="🔥">
        <FieldRow label="Tip sistema" field={report.heating.systemType} override={ov("h_type")} onOverride={v => setField("h_type",v)} />
        <FieldRow label="Sezonski izkoristek" field={report.heating.seasonalEfficiency} override={ov("h_eff")} onOverride={v => setField("h_eff",v)} />
        <FieldRow label="Faktor primarne energije" field={report.heating.primaryEnergyFactor} override={ov("h_pef")} onOverride={v => setField("h_pef",v)} />
        <FieldRow label="Oddajnik (radiatorji/talno)" field={report.heating.radiatorType} override={ov("h_rad")} onOverride={v => setField("h_rad",v)} />
        <FieldRow label="Operater DH" field={report.heating.dhOperator} override={ov("h_dh")} onOverride={v => setField("h_dh",v)} />
      </Section>

      {/* 7. DHW */}
      <Section title="7. Topla sanitarna voda (TSV)" icon="🚿">
        <FieldRow label="Tip sistema" field={report.dhw.systemType} override={ov("dhw_type")} onOverride={v => setField("dhw_type",v)} />
        <FieldRow label="Izkoristek" field={report.dhw.efficiency} override={ov("dhw_eff")} onOverride={v => setField("dhw_eff",v)} />
        <FieldRow label="Letna potreba TSV" field={report.dhw.annualNeedKwhM2} unit="kWh/m²a" override={ov("dhw_need")} onOverride={v => setField("dhw_need",v)} />
      </Section>

      {/* 8. Results */}
      <Section title="8. Rezultati (EN 13790)" icon="📊">
        <div className="py-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Ogrevalna potreba", value: report.calculatedResults.heatingNeedQnhKwhM2, unit: "kWh/m²a" },
            { label: "Primarna energija", value: report.calculatedResults.primaryEnergyKwhM2, unit: "kWh/m²a" },
            { label: "CO₂ emisije", value: report.calculatedResults.co2KgM2, unit: "kg/m²a" },
          ].map(r => (
            <div key={r.label} className="text-center p-2 bg-gray-50 rounded">
              <div className="text-lg font-bold text-gray-900">{r.value}</div>
              <div className="text-[10px] text-gray-400">{r.unit}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{r.label}</div>
            </div>
          ))}
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded font-black text-lg ${ecColor}`}>{ec}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Energetski razred</div>
          </div>
        </div>
        <p className="text-[10px] text-amber-600 py-1">
          ⚠ Rezultati so ocena na podlagi predizpolnjenih vrednosti. Posodobijo se avtomatično ko spremenite vhodne parametre.
        </p>
      </Section>

      {/* 9. Auditor checklist */}
      <Section title="9. Checklist za terenski ogled" icon="✅">
        <div className="py-1 space-y-1.5">
          {report.auditorChecklist.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                item.action === "measure"  ? "bg-red-100 text-red-700" :
                item.action === "verify"   ? "bg-amber-100 text-amber-700" :
                item.action === "fill_in"  ? "bg-gray-100 text-gray-600" :
                "bg-blue-100 text-blue-700"
              }`}>
                {item.action === "measure" ? "izmeri" : item.action === "verify" ? "preveri" : item.action === "fill_in" ? "vnesi" : "potrdi"}
              </span>
              <div>
                <span className="font-medium text-gray-800">{item.field}</span>
                <span className="text-gray-500 ml-1">{item.note}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Export buttons */}
      <div className="flex gap-2 mt-4 mb-2">
        <button
          onClick={() => window.print()}
          className="flex-1 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors"
        >
          🖨 Natisni / PDF
        </button>
        <button
          onClick={() => {
            const data = JSON.stringify({ report, overrides }, null, 2);
            const blob = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `eiz-podloge-${report.eidStavba}.json`;
            a.click();
          }}
          className="flex-1 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors"
        >
          ⬇ Izvozi JSON
        </button>
      </div>

      {/* Disclaimer */}
      <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-[10px] text-amber-800 leading-relaxed">{report.disclaimer}</p>
      </div>
    </div>
  );
}
