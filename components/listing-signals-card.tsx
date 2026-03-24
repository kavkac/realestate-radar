"use client";

/**
 * listing-signals-card.tsx
 *
 * Prikaže kvalitativne signale pridobljene iz oglasnih opisov.
 * Vsak signal ima badge "📋 Oglas (datum)" — jasno označen vir.
 * Prikazuje se SAMO kjer uradnega vira (GURS/EIZ) ni.
 */

import type { ListingSignals } from "@/lib/listing-nlp";

interface Props {
  signals: ListingSignals;
  datum: string | null; // ISO date, npr. "2026-03-24"
  /** Polja ki so že pokrita z uradnimi viri — ne prikazujemo duplikatov */
  officialFields?: Set<string>;
}

function Badge({ datum }: { datum: string | null }) {
  const label = datum
    ? `📋 Oglas · ${new Date(datum).toLocaleDateString("sl-SI", { day: "numeric", month: "short", year: "numeric" })}`
    : "📋 Oglas";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-300">
      {label}
    </span>
  );
}

function Row({ icon, label, value, datum }: { icon: string; label: string; value: string; datum: string | null }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-1.5 text-sm text-gray-700">
        <span>{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-right">
        <span className="text-gray-900">{value}</span>
        <Badge datum={datum} />
      </div>
    </div>
  );
}

const POGLED_LABEL: Record<string, string> = {
  alpe: "Pogled na Alpe",
  gore: "Pogled na gore",
  morje: "Pogled na morje",
  reka: "Pogled na reko",
  jezero: "Pogled na jezero",
  park: "Pogled na park",
  panorama: "Panoramski pogled",
  mesto: "Pogled na mesto",
};

const ORI_LABEL: Record<string, string> = {
  J: "Jug", JV: "Jugovzhod", JZ: "Jugozahod",
  S: "Sever", SV: "Severovzhod", SZ: "Severozahod",
  V: "Vzhod", Z: "Zahod",
};

export function ListingSignalsCard({ signals: s, datum, officialFields = new Set() }: Props) {
  const rows: { icon: string; label: string; value: string; key: string }[] = [];

  // Orientacija — samo kjer GURS nima
  if (s.orientacija && !officialFields.has("orientacija")) {
    rows.push({
      icon: "🧭", key: "orientacija",
      label: "Orientacija",
      value: s.orientacija.map(o => ORI_LABEL[o] ?? o).join(", "),
    });
  }

  // Pogled
  if (s.pogled && !officialFields.has("pogled")) {
    rows.push({
      icon: "🏔️", key: "pogled",
      label: POGLED_LABEL[s.pogled] ?? "Pogled",
      value: "Navedeno v oglasu — bo potrjeno z LiDAR",
    });
  }

  // Energetski sistem
  if (s.toplotnaCarpalka && !officialFields.has("ogrevanje")) {
    rows.push({ icon: "♨️", key: "tc", label: "Toplotna črpalka", value: "Da" });
  }
  if (s.talnoGretje && !officialFields.has("talnoGretje")) {
    rows.push({ icon: "🌡️", key: "talno", label: "Talno gretje", value: "Da" });
  }
  if (s.rekuperator && !officialFields.has("rekuperator")) {
    rows.push({ icon: "💨", key: "rek", label: "Rekuperator", value: "Da" });
  }
  if (s.soncniPaneli) {
    rows.push({ icon: "☀️", key: "solar", label: "Sončni paneli / predpriprava", value: "Da" });
  }
  if (s.evPolnilnica) {
    rows.push({ icon: "⚡", key: "ev", label: "EV polnilnica / predpriprava", value: "Da" });
  }

  // Gradnja — samo kjer GURS nima ali je drugačen
  if (s.gradnja && !officialFields.has("gradnja")) {
    const gradnjaLabel: Record<string, string> = {
      opeka: "Opečnata", beton: "Betonska", les: "Lesena",
      montazna: "Montažna", kamen: "Kamnita",
    };
    rows.push({
      icon: "🧱", key: "gradnja",
      label: "Gradnja",
      value: gradnjaLabel[s.gradnja] ?? s.gradnja,
    });
  }

  // Stanje
  if (s.stanje && !officialFields.has("stanje")) {
    const stanjeLabel: Record<string, string> = {
      kljuc_v_roke: "Ključ v roke",
      vseljivo_takoj: "Vseljivo takoj",
      prenovljeno: "Prenovljeno",
      za_renovacijo: "Potrebuje renovacijo",
    };
    rows.push({
      icon: "🔑", key: "stanje",
      label: "Stanje",
      value: s.stanje === "prenovljeno" && s.letoObnove
        ? `Prenovljeno ${s.letoObnove}`
        : stanjeLabel[s.stanje],
    });
  }

  // Prostori ki jih GURS nima
  if (s.stKopalnic && s.stKopalnic > 0) {
    rows.push({ icon: "🚿", key: "kop", label: "Kopalnice", value: `${s.stKopalnic}` });
  }
  if (s.imaAtrij) rows.push({ icon: "🌿", key: "atrij", label: "Atrij", value: "Da" });
  if (s.imaBasen) rows.push({ icon: "🏊", key: "bazen", label: "Bazen", value: "Da" });
  if (s.stParkingMest && s.stParkingMest > 0) {
    rows.push({ icon: "🅿️", key: "park", label: "Parkirna mesta", value: `${s.stParkingMest}` });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-4 mt-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-orange-800">Podatki iz oglasa</span>
        <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded">
          Ni uradno verificirano
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <Row key={r.key} icon={r.icon} label={r.label} value={r.value} datum={datum} />
        ))}
      </div>
      <p className="text-[11px] text-orange-600 mt-2">
        Podatki so bili navedeni v prodajnem oglasu. Lastnik jih lahko potrdi ali popravi.
      </p>
    </div>
  );
}
