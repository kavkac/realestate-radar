/**
 * Heating system estimation service
 *
 * Sources:
 *   1. District heating zone polygons (manually digitized from operator service maps)
 *   2. SURS popis 2011 — heating distribution by municipality (aggregate)
 *   3. Statistical prior by building era + type
 *
 * TODO Phase 2: Replace manual DH polygons with actual WFS from operators
 *   - Energetika Ljubljana GIS
 *   - Komunala Celje, Komunala Kranj, TECES Velenje
 *
 * PostGIS not available on Railway → point-in-polygon in TypeScript
 */

export type HeatingSystemType =
  | "district_heating"
  | "gas_boiler"
  | "heat_pump_air"
  | "heat_pump_ground"
  | "oil_boiler"
  | "wood_boiler"
  | "electric"
  | "unknown";

export interface HeatingEstimate {
  system: HeatingSystemType;
  efficiency: number;    // seasonal system efficiency (SCOP/seasonal η)
  primaryEnergyFactor: number;  // conversion to primary energy
  co2FactorKgKwh: number;
  confidence: "high" | "medium" | "low";
  source: string;
}

// ─── Heating system specs ─────────────────────────────────────────────────────
export const HEATING_SPECS: Record<HeatingSystemType, Omit<HeatingEstimate, "confidence" | "source">> = {
  district_heating:   { system: "district_heating",   efficiency: 0.92, primaryEnergyFactor: 1.00, co2FactorKgKwh: 0.070 },
  gas_boiler:         { system: "gas_boiler",          efficiency: 0.86, primaryEnergyFactor: 1.10, co2FactorKgKwh: 0.202 },
  heat_pump_air:      { system: "heat_pump_air",       efficiency: 2.80, primaryEnergyFactor: 2.50, co2FactorKgKwh: 0.132 }, // SCOP 2.8, el. PEF 2.5
  heat_pump_ground:   { system: "heat_pump_ground",    efficiency: 3.50, primaryEnergyFactor: 2.50, co2FactorKgKwh: 0.106 },
  oil_boiler:         { system: "oil_boiler",          efficiency: 0.82, primaryEnergyFactor: 1.10, co2FactorKgKwh: 0.273 },
  wood_boiler:        { system: "wood_boiler",         efficiency: 0.78, primaryEnergyFactor: 0.10, co2FactorKgKwh: 0.023 },
  electric:           { system: "electric",            efficiency: 1.00, primaryEnergyFactor: 2.50, co2FactorKgKwh: 0.300 },
  unknown:            { system: "unknown",             efficiency: 0.82, primaryEnergyFactor: 1.10, co2FactorKgKwh: 0.200 },
};

// ─── District heating zones (approximate polygons from operator service maps) ─
// Format: [lng, lat] pairs, counter-clockwise
// Source: manually digitized from public service area descriptions
// TODO: Replace with official GIS data from operators

interface DhZone {
  name: string;
  operator: string;
  city: string;
  polygon: Array<[number, number]>; // [lng, lat]
}

const DH_ZONES: DhZone[] = [
  {
    name: "Ljubljana — Energetika LJ (mestno jedro + Bežigrad + Šiška)",
    operator: "Energetika Ljubljana",
    city: "Ljubljana",
    polygon: [
      [14.480, 46.040], [14.480, 46.080], [14.530, 46.085],
      [14.570, 46.080], [14.575, 46.055], [14.560, 46.040],
      [14.530, 46.035], [14.500, 46.038], [14.480, 46.040],
    ],
  },
  {
    name: "Ljubljana — Energetika LJ (Fužine + Nove Fužine)",
    operator: "Energetika Ljubljana",
    city: "Ljubljana",
    polygon: [
      [14.550, 46.050], [14.550, 46.065], [14.580, 46.065],
      [14.580, 46.050], [14.550, 46.050],
    ],
  },
  {
    name: "Maribor — MKS/Energetika MB",
    operator: "Energetika Maribor",
    city: "Maribor",
    polygon: [
      [15.630, 46.545], [15.630, 46.570], [15.670, 46.570],
      [15.670, 46.545], [15.650, 46.540], [15.630, 46.545],
    ],
  },
  {
    name: "Celje — Komunala Celje",
    operator: "Komunala Celje",
    city: "Celje",
    polygon: [
      [15.250, 46.225], [15.250, 46.245], [15.280, 46.245],
      [15.280, 46.225], [15.260, 46.220], [15.250, 46.225],
    ],
  },
  {
    name: "Velenje — TECES",
    operator: "TECES",
    city: "Velenje",
    polygon: [
      [15.100, 46.355], [15.100, 46.375], [15.130, 46.375],
      [15.130, 46.355], [15.115, 46.350], [15.100, 46.355],
    ],
  },
  {
    name: "Kranj — Komunala Kranj",
    operator: "Komunala Kranj",
    city: "Kranj",
    polygon: [
      [14.350, 46.230], [14.350, 46.250], [14.380, 46.250],
      [14.380, 46.230], [14.365, 46.225], [14.350, 46.230],
    ],
  },
  {
    name: "Koper — Komunala Koper",
    operator: "Komunala Koper",
    city: "Koper",
    polygon: [
      [13.720, 45.540], [13.720, 45.560], [13.750, 45.560],
      [13.750, 45.540], [13.735, 45.535], [13.720, 45.540],
    ],
  },
  {
    name: "Nova Gorica — Komunala NG",
    operator: "Komunala Nova Gorica",
    city: "Nova Gorica",
    polygon: [
      [13.640, 45.950], [13.640, 45.970], [13.670, 45.970],
      [13.670, 45.950], [13.655, 45.945], [13.640, 45.950],
    ],
  },
];

// ─── Ray casting point-in-polygon ─────────────────────────────────────────────
function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  const x = lng, y = lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isInDistrictHeatingZone(lat: number, lng: number): DhZone | null {
  for (const zone of DH_ZONES) {
    if (pointInPolygon(lat, lng, zone.polygon)) return zone;
  }
  return null;
}

// ─── SURS popis 2011 — heating distribution by municipality ──────────────────
// % of dwellings using district heating per municipality (aggregate)
// Source: SURS popis 2011, Tabela: Stanovanja po vrsti energenta za ogrevanje
const DH_PCT_BY_MUNICIPALITY: Record<string, number> = {
  "Ljubljana":       0.55,
  "Maribor":         0.42,
  "Celje":           0.35,
  "Velenje":         0.60,
  "Kranj":           0.28,
  "Koper":           0.25,
  "Nova Gorica":     0.22,
  "Novo Mesto":      0.15,
  "Murska Sobota":   0.20,
  "Ptuj":            0.18,
};

// ─── Main heating estimator ───────────────────────────────────────────────────
export function estimateHeatingSystem(params: {
  lat: number;
  lng: number;
  yearBuilt: number;
  buildingFloors?: number | null;
  municipality?: string | null;
  hasGas?: boolean;
  userOverride?: HeatingSystemType;
}): HeatingEstimate {
  const { lat, lng, yearBuilt, buildingFloors, municipality, hasGas, userOverride } = params;

  // 1. User override (highest priority)
  if (userOverride && userOverride !== "unknown") {
    const spec = HEATING_SPECS[userOverride];
    return { ...spec, confidence: "high", source: "user_input" };
  }

  // 2. District heating zone spatial check
  const dhZone = isInDistrictHeatingZone(lat, lng);
  if (dhZone) {
    return {
      ...HEATING_SPECS.district_heating,
      confidence: "high",
      source: `DH zona: ${dhZone.operator}`,
    };
  }

  // 3. Gas connection flag from GURS (1% coverage but reliable where present)
  if (hasGas) {
    return {
      ...HEATING_SPECS.gas_boiler,
      confidence: "medium",
      source: "GURS ima_plin_dn",
    };
  }

  // 4. Statistical prior by era + context
  // Post-2015: heat pumps grew significantly in SLO (Eko sklad subsidies)
  // Post-2020: ~40% of new builds have heat pump
  if (yearBuilt >= 2020) {
    return {
      ...HEATING_SPECS.heat_pump_air,
      confidence: "low",
      source: "statistični prior (post-2020 → toplotna črpalka)",
    };
  }

  if (yearBuilt >= 2010) {
    // Mix: ~30% HP, ~40% gas, ~20% DH, ~10% wood
    // Default to gas for non-DH areas
    return {
      ...HEATING_SPECS.gas_boiler,
      confidence: "low",
      source: "statistični prior (2010-2020 → plin)",
    };
  }

  if (yearBuilt >= 1990) {
    // Pre-2010: gas or oil dominant outside DH cities
    return {
      ...HEATING_SPECS.gas_boiler,
      confidence: "low",
      source: "statistični prior (1990-2010 → plin/olje)",
    };
  }

  // Pre-1990: oil/wood dominant in rural, gas in urban
  const isUrban = municipality && [
    "Ljubljana", "Maribor", "Celje", "Kranj", "Koper", "Nova Gorica",
    "Velenje", "Novo Mesto", "Murska Sobota", "Ptuj",
  ].includes(municipality);

  if (isUrban) {
    return {
      ...HEATING_SPECS.gas_boiler,
      confidence: "low",
      source: "statistični prior (pre-1990 urban → plin)",
    };
  }

  return {
    ...HEATING_SPECS.oil_boiler,
    confidence: "low",
    source: "statistični prior (pre-1990 ruralno → olje/drva)",
  };
}
