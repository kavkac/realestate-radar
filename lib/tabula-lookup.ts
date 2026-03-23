/**
 * TABULA Building Typology — Slovenia
 * Source: EU TABULA/EPISCOPE project (GI ZRMK, public research data)
 * https://webtool.building-typology.eu
 *
 * U-values in W/(m²·K)
 * Used for buildings WITHOUT energy certificates (EIZ).
 * For buildings WITH EIZ → use EIZ measured values directly.
 */

// ─── GURS id_konstrukcija mapping ────────────────────────────────────────────
export type GursKonstrukcijaId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 0 | -1;
// 1=opeka, 2=beton/ŽB, 3=kamen, 4=les, 5=kombinacija, 6=kovinska, 7=montažna, 8=drug, 0=ni podatka

export type MaterialGroup = "masonry" | "concrete" | "stone" | "timber" | "prefab" | "other";

export function getMaterialGroup(id: GursKonstrukcijaId): MaterialGroup {
  switch (id) {
    case 1: return "masonry";   // opeka
    case 2: return "concrete";  // beton/ŽB
    case 3: return "stone";     // kamen
    case 4: return "timber";    // les
    case 7: return "prefab";    // montažna (panel)
    case 5: case 6: case 8: return "other";
    default: return "masonry";  // most common fallback
  }
}

// ─── TABULA U-value database ──────────────────────────────────────────────────
// Based on SLO TABULA archetypes + PURES regulatory history
// All values represent MEDIAN of archetype range before any renovation

interface TabulaEntry {
  uWall: number;    // W/(m²·K) — zunanja stena
  uRoof: number;    // W/(m²·K) — streha/strop zadnje etaže
  uFloor: number;   // W/(m²·K) — tla nad neogrevanim prostorom
  uWindow: number;  // W/(m²·K) — okna (glazing + frame)
  gWindow: number;  // solar transmittance g-value
  thermalBridge: number; // W/(m²·K) additional for thermal bridges
}

// [era_start, era_end] → material → values
type EraKey = string; // "YYYY-YYYY" or "YYYY+"

const TABULA_SLO: Record<EraKey, Record<MaterialGroup, TabulaEntry>> = {
  "<1919": {
    masonry:  { uWall: 1.80, uRoof: 1.40, uFloor: 1.80, uWindow: 5.50, gWindow: 0.75, thermalBridge: 0.10 },
    concrete: { uWall: 2.00, uRoof: 1.60, uFloor: 2.00, uWindow: 5.50, gWindow: 0.75, thermalBridge: 0.12 },
    stone:    { uWall: 2.20, uRoof: 1.40, uFloor: 2.00, uWindow: 5.50, gWindow: 0.75, thermalBridge: 0.10 },
    timber:   { uWall: 1.20, uRoof: 0.80, uFloor: 1.20, uWindow: 5.50, gWindow: 0.75, thermalBridge: 0.08 },
    prefab:   { uWall: 1.80, uRoof: 1.40, uFloor: 1.80, uWindow: 5.50, gWindow: 0.75, thermalBridge: 0.10 },
    other:    { uWall: 1.80, uRoof: 1.40, uFloor: 1.80, uWindow: 5.50, gWindow: 0.75, thermalBridge: 0.10 },
  },
  "1919-1945": {
    masonry:  { uWall: 1.60, uRoof: 1.20, uFloor: 1.60, uWindow: 5.00, gWindow: 0.72, thermalBridge: 0.10 },
    concrete: { uWall: 1.80, uRoof: 1.40, uFloor: 1.80, uWindow: 5.00, gWindow: 0.72, thermalBridge: 0.12 },
    stone:    { uWall: 2.00, uRoof: 1.20, uFloor: 1.80, uWindow: 5.00, gWindow: 0.72, thermalBridge: 0.10 },
    timber:   { uWall: 1.00, uRoof: 0.70, uFloor: 1.20, uWindow: 5.00, gWindow: 0.72, thermalBridge: 0.08 },
    prefab:   { uWall: 1.60, uRoof: 1.20, uFloor: 1.60, uWindow: 5.00, gWindow: 0.72, thermalBridge: 0.10 },
    other:    { uWall: 1.60, uRoof: 1.20, uFloor: 1.60, uWindow: 5.00, gWindow: 0.72, thermalBridge: 0.10 },
  },
  "1946-1960": {
    masonry:  { uWall: 1.40, uRoof: 1.00, uFloor: 1.40, uWindow: 4.50, gWindow: 0.70, thermalBridge: 0.10 },
    concrete: { uWall: 1.60, uRoof: 1.20, uFloor: 1.60, uWindow: 4.50, gWindow: 0.70, thermalBridge: 0.15 },
    stone:    { uWall: 1.80, uRoof: 1.00, uFloor: 1.60, uWindow: 4.50, gWindow: 0.70, thermalBridge: 0.10 },
    timber:   { uWall: 0.90, uRoof: 0.60, uFloor: 1.00, uWindow: 4.50, gWindow: 0.70, thermalBridge: 0.08 },
    prefab:   { uWall: 1.40, uRoof: 1.00, uFloor: 1.40, uWindow: 4.50, gWindow: 0.70, thermalBridge: 0.12 },
    other:    { uWall: 1.40, uRoof: 1.00, uFloor: 1.40, uWindow: 4.50, gWindow: 0.70, thermalBridge: 0.10 },
  },
  "1961-1970": {
    masonry:  { uWall: 1.20, uRoof: 0.90, uFloor: 1.20, uWindow: 3.50, gWindow: 0.68, thermalBridge: 0.10 },
    concrete: { uWall: 1.40, uRoof: 1.00, uFloor: 1.40, uWindow: 3.50, gWindow: 0.68, thermalBridge: 0.15 },
    stone:    { uWall: 1.60, uRoof: 0.90, uFloor: 1.40, uWindow: 3.50, gWindow: 0.68, thermalBridge: 0.10 },
    timber:   { uWall: 0.70, uRoof: 0.50, uFloor: 0.90, uWindow: 3.50, gWindow: 0.68, thermalBridge: 0.08 },
    prefab:   { uWall: 1.20, uRoof: 0.90, uFloor: 1.20, uWindow: 3.50, gWindow: 0.68, thermalBridge: 0.15 }, // panel stavbe
    other:    { uWall: 1.20, uRoof: 0.90, uFloor: 1.20, uWindow: 3.50, gWindow: 0.68, thermalBridge: 0.10 },
  },
  "1971-1980": {
    // First PURES precursors, some insulation starting to appear
    masonry:  { uWall: 1.00, uRoof: 0.70, uFloor: 1.00, uWindow: 3.00, gWindow: 0.65, thermalBridge: 0.10 },
    concrete: { uWall: 1.20, uRoof: 0.80, uFloor: 1.20, uWindow: 3.00, gWindow: 0.65, thermalBridge: 0.15 },
    stone:    { uWall: 1.40, uRoof: 0.70, uFloor: 1.20, uWindow: 3.00, gWindow: 0.65, thermalBridge: 0.10 },
    timber:   { uWall: 0.55, uRoof: 0.40, uFloor: 0.80, uWindow: 3.00, gWindow: 0.65, thermalBridge: 0.08 },
    prefab:   { uWall: 1.10, uRoof: 0.75, uFloor: 1.10, uWindow: 3.00, gWindow: 0.65, thermalBridge: 0.15 },
    other:    { uWall: 1.00, uRoof: 0.70, uFloor: 1.00, uWindow: 3.00, gWindow: 0.65, thermalBridge: 0.10 },
  },
  "1981-1990": {
    // PURES 1987 introduced — significant improvement
    masonry:  { uWall: 0.80, uRoof: 0.50, uFloor: 0.80, uWindow: 2.80, gWindow: 0.62, thermalBridge: 0.08 },
    concrete: { uWall: 0.90, uRoof: 0.55, uFloor: 0.90, uWindow: 2.80, gWindow: 0.62, thermalBridge: 0.12 },
    stone:    { uWall: 1.00, uRoof: 0.50, uFloor: 0.90, uWindow: 2.80, gWindow: 0.62, thermalBridge: 0.08 },
    timber:   { uWall: 0.40, uRoof: 0.30, uFloor: 0.60, uWindow: 2.80, gWindow: 0.62, thermalBridge: 0.06 },
    prefab:   { uWall: 0.80, uRoof: 0.50, uFloor: 0.80, uWindow: 2.80, gWindow: 0.62, thermalBridge: 0.10 },
    other:    { uWall: 0.80, uRoof: 0.50, uFloor: 0.80, uWindow: 2.80, gWindow: 0.62, thermalBridge: 0.08 },
  },
  "1991-2001": {
    // Post-PURES 1987 compliance
    masonry:  { uWall: 0.55, uRoof: 0.35, uFloor: 0.60, uWindow: 2.00, gWindow: 0.60, thermalBridge: 0.06 },
    concrete: { uWall: 0.60, uRoof: 0.38, uFloor: 0.65, uWindow: 2.00, gWindow: 0.60, thermalBridge: 0.08 },
    stone:    { uWall: 0.70, uRoof: 0.35, uFloor: 0.65, uWindow: 2.00, gWindow: 0.60, thermalBridge: 0.06 },
    timber:   { uWall: 0.28, uRoof: 0.22, uFloor: 0.40, uWindow: 2.00, gWindow: 0.60, thermalBridge: 0.05 },
    prefab:   { uWall: 0.55, uRoof: 0.35, uFloor: 0.60, uWindow: 2.00, gWindow: 0.60, thermalBridge: 0.08 },
    other:    { uWall: 0.55, uRoof: 0.35, uFloor: 0.60, uWindow: 2.00, gWindow: 0.60, thermalBridge: 0.06 },
  },
  "2002-2010": {
    // PURES 2002
    masonry:  { uWall: 0.32, uRoof: 0.22, uFloor: 0.40, uWindow: 1.40, gWindow: 0.58, thermalBridge: 0.05 },
    concrete: { uWall: 0.35, uRoof: 0.24, uFloor: 0.42, uWindow: 1.40, gWindow: 0.58, thermalBridge: 0.06 },
    stone:    { uWall: 0.40, uRoof: 0.22, uFloor: 0.42, uWindow: 1.40, gWindow: 0.58, thermalBridge: 0.05 },
    timber:   { uWall: 0.20, uRoof: 0.16, uFloor: 0.28, uWindow: 1.40, gWindow: 0.58, thermalBridge: 0.04 },
    prefab:   { uWall: 0.32, uRoof: 0.22, uFloor: 0.40, uWindow: 1.40, gWindow: 0.58, thermalBridge: 0.05 },
    other:    { uWall: 0.32, uRoof: 0.22, uFloor: 0.40, uWindow: 1.40, gWindow: 0.58, thermalBridge: 0.05 },
  },
  "2011-2020": {
    // PURES 2010
    masonry:  { uWall: 0.24, uRoof: 0.16, uFloor: 0.30, uWindow: 1.10, gWindow: 0.50, thermalBridge: 0.04 },
    concrete: { uWall: 0.26, uRoof: 0.17, uFloor: 0.32, uWindow: 1.10, gWindow: 0.50, thermalBridge: 0.05 },
    stone:    { uWall: 0.28, uRoof: 0.16, uFloor: 0.32, uWindow: 1.10, gWindow: 0.50, thermalBridge: 0.04 },
    timber:   { uWall: 0.14, uRoof: 0.12, uFloor: 0.20, uWindow: 1.10, gWindow: 0.50, thermalBridge: 0.03 },
    prefab:   { uWall: 0.24, uRoof: 0.16, uFloor: 0.30, uWindow: 1.10, gWindow: 0.50, thermalBridge: 0.04 },
    other:    { uWall: 0.24, uRoof: 0.16, uFloor: 0.30, uWindow: 1.10, gWindow: 0.50, thermalBridge: 0.04 },
  },
  "2021+": {
    // PURES 2021 / nearly-zero energy
    masonry:  { uWall: 0.18, uRoof: 0.12, uFloor: 0.22, uWindow: 0.90, gWindow: 0.48, thermalBridge: 0.03 },
    concrete: { uWall: 0.20, uRoof: 0.13, uFloor: 0.24, uWindow: 0.90, gWindow: 0.48, thermalBridge: 0.04 },
    stone:    { uWall: 0.22, uRoof: 0.12, uFloor: 0.24, uWindow: 0.90, gWindow: 0.48, thermalBridge: 0.03 },
    timber:   { uWall: 0.11, uRoof: 0.09, uFloor: 0.16, uWindow: 0.90, gWindow: 0.48, thermalBridge: 0.02 },
    prefab:   { uWall: 0.18, uRoof: 0.12, uFloor: 0.22, uWindow: 0.90, gWindow: 0.48, thermalBridge: 0.03 },
    other:    { uWall: 0.18, uRoof: 0.12, uFloor: 0.22, uWindow: 0.90, gWindow: 0.48, thermalBridge: 0.03 },
  },
};

// PURES renovation U-value targets by renovation year
// When a component is renovated, assume compliance with regulations of that year
const PURES_RENOVATION: Record<string, Partial<TabulaEntry>> = {
  "<1987": { uWall: 0.60, uRoof: 0.40, uFloor: 0.60, uWindow: 2.80 },
  "1987-2001": { uWall: 0.50, uRoof: 0.30, uFloor: 0.55, uWindow: 2.50 },
  "2002-2009": { uWall: 0.35, uRoof: 0.20, uFloor: 0.45, uWindow: 1.80 },
  "2010-2016": { uWall: 0.28, uRoof: 0.15, uFloor: 0.35, uWindow: 1.30 },
  "2017+": { uWall: 0.22, uRoof: 0.14, uFloor: 0.30, uWindow: 1.00, gWindow: 0.50 },
};

function getPuresRenovationValues(renovationYear: number): Partial<TabulaEntry> {
  if (renovationYear < 1987) return PURES_RENOVATION["<1987"];
  if (renovationYear <= 2001) return PURES_RENOVATION["1987-2001"];
  if (renovationYear <= 2009) return PURES_RENOVATION["2002-2009"];
  if (renovationYear <= 2016) return PURES_RENOVATION["2010-2016"];
  return PURES_RENOVATION["2017+"];
}

function getEraKey(yearBuilt: number): EraKey {
  if (yearBuilt < 1919) return "<1919";
  if (yearBuilt <= 1945) return "1919-1945";
  if (yearBuilt <= 1960) return "1946-1960";
  if (yearBuilt <= 1970) return "1961-1970";
  if (yearBuilt <= 1980) return "1971-1980";
  if (yearBuilt <= 1990) return "1981-1990";
  if (yearBuilt <= 2001) return "1991-2001";
  if (yearBuilt <= 2010) return "2002-2010";
  if (yearBuilt <= 2020) return "2011-2020";
  return "2021+";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ThermalEnvelopeResult {
  uWall: number;
  uRoof: number;
  uFloor: number;
  uWindow: number;
  gWindow: number;
  thermalBridge: number;
  era: EraKey;
  material: MaterialGroup;
  // Which components were adjusted for renovation
  renovations: {
    facade?: number;  // year of renovation
    roof?: number;
    windows?: number;
  };
  // Data quality
  confidence: "high" | "medium" | "low";
  notes: string[];
}

/**
 * Get thermal envelope U-values for a building.
 *
 * Priority per component:
 * 1. Known renovation year → PURES value for that year
 * 2. TABULA archetype (year × material) → baseline
 *
 * yearFacadeRenovated / yearRoofRenovated / yearWindowsRenovated:
 *   pass from GURS ev_stavba.leto_obn_fasade etc.
 */
export function getThermalEnvelope(params: {
  yearBuilt: number;
  konstrukcijaId?: GursKonstrukcijaId | null;
  yearFacadeRenovated?: number | null;
  yearRoofRenovated?: number | null;
  yearWindowsRenovated?: number | null;
}): ThermalEnvelopeResult {
  const {
    yearBuilt,
    konstrukcijaId = 1,
    yearFacadeRenovated,
    yearRoofRenovated,
    yearWindowsRenovated,
  } = params;

  const material = getMaterialGroup((konstrukcijaId ?? 1) as GursKonstrukcijaId);
  const era = getEraKey(yearBuilt);
  const base = TABULA_SLO[era][material];
  const notes: string[] = [];
  const renovations: ThermalEnvelopeResult["renovations"] = {};

  // Start from TABULA baseline
  let result = { ...base };

  // Apply renovation corrections per component
  if (yearFacadeRenovated && yearFacadeRenovated > yearBuilt) {
    const renValues = getPuresRenovationValues(yearFacadeRenovated);
    result.uWall = renValues.uWall ?? result.uWall;
    result.thermalBridge = Math.min(result.thermalBridge, 0.05); // improved with facade
    renovations.facade = yearFacadeRenovated;
    notes.push(`Fasada obnovljena ${yearFacadeRenovated} → U_stena=${result.uWall}`);
  }

  if (yearRoofRenovated && yearRoofRenovated > yearBuilt) {
    const renValues = getPuresRenovationValues(yearRoofRenovated);
    result.uRoof = renValues.uRoof ?? result.uRoof;
    renovations.roof = yearRoofRenovated;
    notes.push(`Streha obnovljena ${yearRoofRenovated} → U_streha=${result.uRoof}`);
  }

  if (yearWindowsRenovated && yearWindowsRenovated > yearBuilt) {
    const renValues = getPuresRenovationValues(yearWindowsRenovated);
    result.uWindow = renValues.uWindow ?? result.uWindow;
    result.gWindow = renValues.gWindow ?? result.gWindow;
    renovations.windows = yearWindowsRenovated;
    notes.push(`Okna obnovljena ${yearWindowsRenovated} → U_okna=${result.uWindow}`);
  }

  // Confidence based on data availability
  const hasRenovationData =
    yearFacadeRenovated || yearRoofRenovated || yearWindowsRenovated;
  const confidence: ThermalEnvelopeResult["confidence"] =
    hasRenovationData && konstrukcijaId && konstrukcijaId > 0
      ? "high"
      : konstrukcijaId && konstrukcijaId > 0
        ? "medium"
        : "low";

  return {
    uWall: Math.round(result.uWall * 100) / 100,
    uRoof: Math.round(result.uRoof * 100) / 100,
    uFloor: Math.round(result.uFloor * 100) / 100,
    uWindow: Math.round(result.uWindow * 100) / 100,
    gWindow: Math.round(result.gWindow * 100) / 100,
    thermalBridge: Math.round(result.thermalBridge * 100) / 100,
    era,
    material,
    renovations,
    confidence,
    notes,
  };
}
