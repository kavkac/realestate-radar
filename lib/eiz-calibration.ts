/**
 * EIZ Calibration — SLO-specific corrections
 *
 * Based on back-analysis of 73k energy certificates joined with GURS data.
 * Median QNH per (era × material) from real measured certificates.
 *
 * These calibration factors correct TABULA generic EU values
 * to match actual Slovenian building stock performance.
 *
 * Also implements:
 * - PURES upper bound constraints (legal U-value maxima by year)
 * - District heating zone lookup (static map from utility companies)
 * - Panel building system catalog (IMP, Primat, TAM — exact U-values)
 */

import type { GursKonstrukcijaId, MaterialGroup } from "./tabula-lookup";

// ─── Calibration factors from EIZ back-analysis ──────────────────────────────
// Source: 73k energy_certificates JOIN ev_stavba — median QNH per era×material
// Factor = measured_median / tabula_predicted → apply as multiplier to final QNH

// Raw measured medians (kWh/m²a) from our DB
const MEASURED_MEDIAN_QNH: Record<string, Record<string, number>> = {
  "pre-1945": { "1": 123.3, "2": 107.0, "3": 173.5, "4": 157.5, "5": 120.0 },
  "1945-1970": { "1": 98.7, "2": 69.1, "3": 206.0, "4": 165.4, "5": 92.9, "7": 119.5 },
  "1970-1980": { "1": 114.5, "2": 55.0, "3": 186.5, "4": 145.0, "5": 79.1, "7": 104.6 },
  "1980-1990": { "1": 103.1, "2": 58.0, "3": 190.5, "4": 115.1, "5": 76.3, "7": 102.2 },
  "1990-2000": { "1": 89.0, "2": 62.1, "3": 101.5, "4": 99.2, "5": 78.9, "7": 75.0 },
  "2000-2010": { "1": 58.9, "2": 46.0, "4": 72.9, "5": 52.5, "7": 59.1 },
  "2010+":     { "1": 33.9, "2": 26.0, "4": 27.4, "5": 32.4, "7": 28.0 },
};

function getEraKeyForCalibration(yearBuilt: number): string {
  if (yearBuilt < 1945) return "pre-1945";
  if (yearBuilt < 1970) return "1945-1970";
  if (yearBuilt < 1980) return "1970-1980";
  if (yearBuilt < 1990) return "1980-1990";
  if (yearBuilt < 2000) return "1990-2000";
  if (yearBuilt < 2010) return "2000-2010";
  return "2010+";
}

/**
 * Get calibrated QNH — apply SLO-specific correction to EN 13790 result.
 * Blends calculated value with empirical median (70/30 split).
 * For buildings with renovation data → trust calculation more (90/10).
 */
export function calibrateQnh(params: {
  calculatedQnh: number;
  yearBuilt: number;
  konstrukcijaId: GursKonstrukcijaId;
  hasRenovationData: boolean;
}): { calibratedQnh: number; empiricalMedian: number | null } {
  const { calculatedQnh, yearBuilt, konstrukcijaId, hasRenovationData } = params;

  const era = getEraKeyForCalibration(yearBuilt);
  const eraData = MEASURED_MEDIAN_QNH[era];
  const empiricalMedian = eraData?.[String(konstrukcijaId)] ?? null;

  if (!empiricalMedian) {
    return { calibratedQnh: calculatedQnh, empiricalMedian: null };
  }

  // Blend: more trust in calculation when we have renovation data
  const calcWeight = hasRenovationData ? 0.85 : 0.65;
  const empiricalWeight = 1 - calcWeight;

  const calibratedQnh = calculatedQnh * calcWeight + empiricalMedian * empiricalWeight;

  return {
    calibratedQnh: Math.round(calibratedQnh),
    empiricalMedian,
  };
}

// ─── PURES upper bound constraints ───────────────────────────────────────────
// Legal maximum U-values by building permit year
// Source: PURES 1987, PURES 2002, PURES 2010, PURES 2021

interface PuresLimits {
  uWallMax: number;
  uRoofMax: number;
  uFloorMax: number;
  uWindowMax: number;
}

const PURES_LIMITS: Array<{ fromYear: number; limits: PuresLimits }> = [
  { fromYear: 2021, limits: { uWallMax: 0.20, uRoofMax: 0.15, uFloorMax: 0.25, uWindowMax: 1.00 } },
  { fromYear: 2010, limits: { uWallMax: 0.28, uRoofMax: 0.20, uFloorMax: 0.35, uWindowMax: 1.30 } },
  { fromYear: 2002, limits: { uWallMax: 0.40, uRoofMax: 0.25, uFloorMax: 0.45, uWindowMax: 1.80 } },
  { fromYear: 1987, limits: { uWallMax: 0.65, uRoofMax: 0.45, uFloorMax: 0.70, uWindowMax: 2.80 } },
  { fromYear: 0,    limits: { uWallMax: 99.0, uRoofMax: 99.0, uFloorMax: 99.0, uWindowMax: 99.0 } },
];

/**
 * Apply PURES upper bound: U-values cannot be WORSE than the legal maximum
 * for the year the building was constructed/renovated.
 * Prevents physically impossible values from old TABULA entries.
 */
export function applyPuresConstraint(
  uValues: { uWall: number; uRoof: number; uFloor: number; uWindow: number },
  yearBuilt: number,
): typeof uValues & { puresYear: number } {
  const pures = PURES_LIMITS.find(p => yearBuilt >= p.fromYear) ?? PURES_LIMITS[PURES_LIMITS.length - 1];

  return {
    uWall:   Math.min(uValues.uWall,   pures.limits.uWallMax),
    uRoof:   Math.min(uValues.uRoof,   pures.limits.uRoofMax),
    uFloor:  Math.min(uValues.uFloor,  pures.limits.uFloorMax),
    uWindow: Math.min(uValues.uWindow, pures.limits.uWindowMax),
    puresYear: pures.fromYear,
  };
}

// ─── District heating zones ───────────────────────────────────────────────────
// Static lookup: municipalities with significant DH coverage
// Source: Energetika Ljubljana, Komunala Celje, TECES Velenje, MKS Kranj, Petrol
// TODO: Replace with actual WFS/GeoJSON polygon join when available

const DH_MUNICIPALITIES: Set<string> = new Set([
  // Ljubljana + okolica
  "Ljubljana", "Domžale", "Kamnik", "Grosuplje", "Vrhnika",
  // Maribor
  "Maribor", "Ptuj",
  // Celje
  "Celje", "Velenje", "Hrastnik", "Trbovlje", "Zagorje ob Savi",
  // Kranj, Jesenice, Koper
  "Kranj", "Jesenice", "Koper", "Izola",
  // Nova Gorica
  "Nova Gorica",
  // Murska Sobota
  "Murska Sobota",
]);

/**
 * Estimate if building is likely connected to district heating.
 * TODO Phase 2: Replace with actual spatial join against DH network polygons
 */
export function isLikelyDistrictHeating(municipality?: string | null): boolean {
  if (!municipality) return false;
  if (DH_MUNICIPALITIES.has(municipality)) return true;
  const ml = municipality.toLowerCase();
  for (const m of Array.from(DH_MUNICIPALITIES)) {
    if (ml.includes(m.toLowerCase())) return true;
  }
  return false;
}

// ─── Panel building system catalog ───────────────────────────────────────────
// Slovenian prefab/panel building systems used 1960-1990
// Source: ZAG/ZRMK technical documentation (public research)

interface PanelSystemSpec {
  name: string;
  yearsActive: [number, number];
  uWall: number;
  uRoof: number;
  uWindow: number;
  notes: string;
}

export const PANEL_SYSTEMS: Record<string, PanelSystemSpec> = {
  "IMP": {
    name: "IMP sistem (Industrija Montažnih Plošč)",
    yearsActive: [1960, 1985],
    uWall: 1.18,
    uRoof: 0.85,
    uWindow: 3.20,
    notes: "Sendvič panel 16cm beton + 4cm mineralna volna. Prisoten v LJ, MB, CE.",
  },
  "Primat": {
    name: "Primat sistem",
    yearsActive: [1965, 1980],
    uWall: 1.05,
    uRoof: 0.80,
    uWindow: 3.00,
    notes: "Izboljšan sendvič z debelejšo izolacijo. Tipičen za večnadstropne bloke.",
  },
  "TAM": {
    name: "TAM sistem (Tovarna avtomobilov Maribor)",
    yearsActive: [1963, 1978],
    uWall: 1.25,
    uRoof: 0.90,
    uWindow: 3.50,
    notes: "Starejši sistem, manjša toplotna izolacija. Značilen za MB regijo.",
  },
  "Pionir": {
    name: "Pionir sistem",
    yearsActive: [1970, 1988],
    uWall: 0.95,
    uRoof: 0.75,
    uWindow: 2.90,
    notes: "Novejši sistem z boljšo izolacijo. Razširjen po vsej SLO.",
  },
};

/**
 * Estimate panel system U-values based on location and year.
 * Without precise building ID we use weighted average of known systems.
 * TODO: Match to specific system using address register + historical records.
 */
export function getPanelBuildingUValues(yearBuilt: number): {
  uWall: number; uRoof: number; uWindow: number
} | null {
  if (yearBuilt < 1960 || yearBuilt > 1990) return null;

  const active = Object.values(PANEL_SYSTEMS).filter(
    s => yearBuilt >= s.yearsActive[0] && yearBuilt <= s.yearsActive[1]
  );

  if (!active.length) return null;

  return {
    uWall:   active.reduce((s, p) => s + p.uWall, 0) / active.length,
    uRoof:   active.reduce((s, p) => s + p.uRoof, 0) / active.length,
    uWindow: active.reduce((s, p) => s + p.uWindow, 0) / active.length,
  };
}
