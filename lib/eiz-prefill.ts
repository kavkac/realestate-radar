/**
 * EIZ Pre-fill Report Generator
 *
 * Target user: certified energy auditor (not property owner)
 * Output: structured data package that covers ~80% of KI Expert inputs
 *         with full data provenance per field
 *
 * Format: JSON (for API), PDF (for auditor), Excel (for KI Expert manual entry)
 * TODO: KI Expert XML when we obtain the .kip schema from Stefan's contact
 */

import { prisma } from "./prisma";
import { getThermalEnvelope } from "./tabula-lookup";
import { getClimate } from "./climate-service";
import { estimateHeatingSystem } from "./heating-service";
import { estimateVentilation, calculateHeatedVolume } from "./ventilation-model";
import { getWindowData } from "./window-cache";

// ─── Data source labels ───────────────────────────────────────────────────────
export type DataSource =
  | "GURS_REN"          // Official GURS cadastre data
  | "GURS_EVS"          // GURS building parts register
  | "TABULA_SLO"        // EU TABULA/EPISCOPE SLO archetypes
  | "OPEN_METEO_ERA5"   // Open-Meteo ERA5 reanalysis (10y avg)
  | "ARSO_JRC"          // ARSO/JRC solar irradiation atlas
  | "DH_SPATIAL"        // District heating zone polygon
  | "MAPILLARY_ML"      // Mapillary street-view ML estimation
  | "STATISTICAL_PRIOR" // Era/material statistical prior
  | "USER_INPUT"        // Provided by property owner
  | "AUDITOR_INPUT";    // To be filled by auditor on-site

export type Confidence = "high" | "medium" | "low" | "missing";

export interface PrefillField<T = number | string | null> {
  value: T;
  source: DataSource;
  confidence: Confidence;
  note?: string;                // shown to auditor as context
  verifyOnSite?: boolean;       // true = auditor should verify/measure
}

export interface EizPrefillReport {
  generatedAt: string;
  eidStavba: string;
  address: string;

  // ── 1. Identification ──────────────────────────────────────────────────────
  identification: {
    eidStavba: PrefillField<string>;
    address: PrefillField<string>;
    yearBuilt: PrefillField<number | null>;
    material: PrefillField<string>;
    buildingType: PrefillField<string>;
    floors: PrefillField<number | null>;
    dwellings: PrefillField<number | null>;
  };

  // ── 2. Geometry ────────────────────────────────────────────────────────────
  geometry: {
    conditionedAreaM2: PrefillField<number | null>;
    heatedVolumeM3: PrefillField<number | null>;
    svRatio: PrefillField<number | null>;      // A/V [m²/m³]
    roofAreaM2: PrefillField<number | null>;
    floorAreaM2: PrefillField<number | null>;
    orientation: PrefillField<string | null>;
    perimeter: PrefillField<number | null>;
    avgFloorHeightM: PrefillField<number | null>;
  };

  // ── 3. Climate ─────────────────────────────────────────────────────────────
  climate: {
    designTempC: PrefillField<number>;         // projektna zunanja temperatura
    hdd: PrefillField<number>;                 // heating degree days
    annualSolarKwhM2: PrefillField<number>;
    solarSouth: PrefillField<number>;          // kWh/m²a by orientation
    solarEast: PrefillField<number>;
    solarWest: PrefillField<number>;
    solarNorth: PrefillField<number>;
    solarHorizontal: PrefillField<number>;
    climateZone: PrefillField<string>;
  };

  // ── 4. Thermal envelope ────────────────────────────────────────────────────
  thermalEnvelope: {
    // Walls
    uWall: PrefillField<number>;               // W/m²K
    uWallNote: string;                         // material + era + renovation context
    // Roof
    uRoof: PrefillField<number>;
    // Floor
    uFloor: PrefillField<number>;
    // Windows
    uWindow: PrefillField<number>;
    gValue: PrefillField<number>;              // solar heat gain coefficient
    windowRatioPct: PrefillField<number>;      // % of facade
    windowAreaM2: PrefillField<number | null>;
    // Thermal bridges
    thermalBridgesPsiWmK: PrefillField<number>;
    thermalBridgesLengthM: PrefillField<number | null>;
    // Renovation
    renovationFacadeYear: PrefillField<number | null>;
    renovationRoofYear: PrefillField<number | null>;
    renovationWindowYear: PrefillField<number | null>;
  };

  // ── 5. Ventilation ─────────────────────────────────────────────────────────
  ventilation: {
    systemType: PrefillField<string>;          // natural/mechanical/MVHR
    nInf: PrefillField<number>;                // infiltration rate h⁻¹
    n50: PrefillField<number | null>;          // blower door result (if available)
    heatRecoveryEff: PrefillField<number | null>; // η for MVHR (0-1)
  };

  // ── 6. Heating system ──────────────────────────────────────────────────────
  heating: {
    systemType: PrefillField<string>;
    seasonalEfficiency: PrefillField<number>;
    primaryEnergyFactor: PrefillField<number>;
    radiatorType: PrefillField<string>;        // radiatorji/talno ogrevanje
    dhOperator: PrefillField<string | null>;   // if district heating
  };

  // ── 7. Domestic hot water ──────────────────────────────────────────────────
  dhw: {
    systemType: PrefillField<string>;          // boiler/solar/district
    efficiency: PrefillField<number>;
    annualNeedKwhM2: PrefillField<number>;     // statistical estimate
  };

  // ── 8. Calculated results (EN 13790) ──────────────────────────────────────
  calculatedResults: {
    heatingNeedQnhKwhM2: number;
    primaryEnergyKwhM2: number;
    co2KgM2: number;
    energyClass: string;
    confidence: Confidence;
  };

  // ── 9. Auditor checklist ───────────────────────────────────────────────────
  auditorChecklist: Array<{
    field: string;
    action: "verify" | "measure" | "confirm" | "fill_in";
    note: string;
  }>;

  // ── Legal disclaimer ───────────────────────────────────────────────────────
  disclaimer: string;
}

// ─── Design temperatures by climate zone ──────────────────────────────────────
const DESIGN_TEMP: Record<string, number> = {
  primorska: -5,
  osrednja: -13,
  alpska: -18,
  panonska: -15,
};

// ─── Main prefill generator ───────────────────────────────────────────────────
export async function generateEizPrefill(params: {
  eidStavba: string;
  eidDelStavbe?: string;
  naslov?: string;
  lat: number;
  lng: number;
  userOverrides?: Record<string, unknown>;
}): Promise<EizPrefillReport> {
  const { eidStavba, lat, lng } = params;

  // ── Load GURS data (ev_stavba — dejanska kolumna imena) ──────────────────
  const stavbaRow = await prisma.$queryRawUnsafe<any[]>(
    `SELECT eid_stavba, ko_sifko, stev_st,
            leto_izg_sta, id_konstrukcija, st_etaz, st_stanovanj,
            leto_obn_fasade, leto_obn_strehe, pov_stavbe,
            ima_plin_dn, ima_elektriko_dn, ima_vodovod_dn, ima_kanalizacijo_dn,
            id_tip_stavbe
     FROM ev_stavba WHERE eid_stavba = $1 LIMIT 1`,
    eidStavba
  ).catch(() => []);
  const g = stavbaRow[0] ?? {};

  const delStavbeRow = params.eidDelStavbe
    ? await prisma.$queryRawUnsafe<any[]>(
        `SELECT eid_del_stavbe, upor_pov, povrsina, leto_obn_oken, visina_etaze
         FROM ev_del_stavbe WHERE eid_del_stavbe = $1 LIMIT 1`,
        params.eidDelStavbe
      ).catch(() => [])
    : await prisma.$queryRawUnsafe<any[]>(
        `SELECT eid_del_stavbe, upor_pov, povrsina, leto_obn_oken, visina_etaze
         FROM ev_del_stavbe WHERE eid_stavba = $1 ORDER BY upor_pov::float DESC NULLS LAST LIMIT 1`,
        eidStavba
      ).catch(() => []);
  const d = delStavbeRow[0] ?? {};

  // Address: try buildings table (has normalized naslov), fallback to passed-in naslov param
  const addressRow = await prisma.$queryRawUnsafe<any[]>(
    `SELECT naslov FROM buildings WHERE "eidStavba" = $1 LIMIT 1`,
    parseInt(eidStavba)
  ).catch(() => []);
  const address = addressRow[0]?.naslov ?? params.naslov ?? `EID ${eidStavba}`;

  // ── Derived values ────────────────────────────────────────────────────────
  const yearBuilt: number | null = parseInt(g.leto_izg_sta) || null;
  const materialCode: number = parseInt(g.id_konstrukcija) || 1;
  const MATERIAL_NAMES: Record<number, string> = {
    1: "opeka", 2: "beton", 3: "kamen", 4: "les", 5: "kombinacija", 7: "montažna plošča"
  };
  const materialName = MATERIAL_NAMES[materialCode] ?? "neznano";

  const floors: number | null = parseInt(g.st_etaz) || null;
  const area: number | null = parseFloat(d.upor_pov) || parseFloat(d.povrsina) || parseFloat(g.pov_stavbe) || null;
  const floorHeight: number = parseFloat(d.visina_etaze) || 2.6;
  const renovFasade: number | null = parseInt(g.leto_obn_fasade) || null;
  const renovStreha: number | null = parseInt(g.leto_obn_strehe) || null;
  const renovOkna: number | null = parseInt(d.leto_obn_oken) || null;
  const hasGas: boolean = g.ima_plin_dn === "1";

  const buildingH: number | null = null; // LiDAR pending

  const heatedVol = area && floors ? area * floorHeight * floors : null;

  // S/V ratio estimate from footprint
  const footprint = parseFloat(g.pov_stavbe) || null;
  let svRatio: number | null = null;
  if (footprint && buildingH) {
    const perimeter = Math.sqrt(footprint) * 4;
    const wallArea = perimeter * buildingH;
    const roofArea = footprint;
    const totalEnvelope = wallArea + roofArea + footprint;
    svRatio = heatedVol ? Math.round((totalEnvelope / heatedVol) * 100) / 100 : null;
  }

  // ── Thermal envelope (TABULA) ─────────────────────────────────────────────
  const tabula = getThermalEnvelope({
    yearBuilt: yearBuilt ?? 1980,
    konstrukcijaId: materialCode as any,
    yearFacadeRenovated: renovFasade,
    yearRoofRenovated: renovStreha,
    yearWindowsRenovated: renovOkna,
  });

  const envelopeConfidence: Confidence = renovFasade ? "medium" : "low";
  const uWallNote = `${materialName}, ${yearBuilt ?? "?"}${renovFasade ? `, fasada obnovljena ${renovFasade}` : ", brez obnove fasade"}`;

  // ── Climate ───────────────────────────────────────────────────────────────
  const climate = await getClimate(lat, lng);
  const designTemp = DESIGN_TEMP[climate.climateZone] ?? -13;

  // ── Heating ───────────────────────────────────────────────────────────────
  const heatingEst = estimateHeatingSystem({ lat, lng, yearBuilt: yearBuilt ?? 1980, hasGas });

  // ── Ventilation ───────────────────────────────────────────────────────────
  const ventilation = estimateVentilation({
    yearBuilt: yearBuilt ?? 1980,
    konstrukcijaId: materialCode as any,
    yearWindowsRenovated: renovOkna,
  });

  // ── Window area ───────────────────────────────────────────────────────────
  let windowRatio: number | null = null;
  let windowSource: DataSource = "STATISTICAL_PRIOR";
  try {
    const wr = await getWindowData({ propertyId: eidStavba, lat, lng, yearBuilt: yearBuilt ?? undefined });
    if (wr) {
      windowRatio = wr.windowRatio;
      windowSource = wr.source === "mapillary_ml" ? "MAPILLARY_ML" : "STATISTICAL_PRIOR";
    }
  } catch { /* use statistical */ }
  if (!windowRatio) windowRatio = yearBuilt && yearBuilt < 1960 ? 0.12 : yearBuilt && yearBuilt < 1990 ? 0.16 : 0.20;

  const wallAreaM2 = footprint && buildingH ? Math.sqrt(footprint) * 4 * buildingH : null;
  const windowAreaM2: number | null = wallAreaM2 ? Math.round(wallAreaM2 * windowRatio) : null;

  // ── Thermal bridges ───────────────────────────────────────────────────────
  // Typical PSI values from TABULA SLO (linear thermal bridging)
  const psi = yearBuilt && yearBuilt >= 2010 ? 0.08 : yearBuilt && yearBuilt >= 1990 ? 0.12 : 0.20;

  // ── DHW estimate ─────────────────────────────────────────────────────────
  // EN 15316: 25-35 kWh/m²a for SLO residential
  const dhwNeedKwhM2 = 30;

  // ── Quick QNH for results section ─────────────────────────────────────────
  const transmission = area ? (
    tabula.uWall * (wallAreaM2 ?? area * 2) +
    tabula.uRoof * (footprint ?? area) +
    tabula.uFloor * (footprint ?? area) +
    tabula.uWindow * (windowAreaM2 ?? area * windowRatio)
  ) : null;
  const approxQnh = transmission && heatedVol
    ? Math.round(transmission * climate.hdd * 24 / (area ?? 1))
    : null;

  // ── Build checklist ───────────────────────────────────────────────────────
  const checklist: EizPrefillReport["auditorChecklist"] = [];

  if (!renovFasade) checklist.push({ field: "Sestava zunanje stene", action: "measure", note: "Izmeriti dejansko debelino in sestavo — vpliva na U_stena ±25%" });
  if (!renovStreha)  checklist.push({ field: "Sestava strehe/stropa", action: "measure", note: "Preveriti izolacijo strehe ali mansarde" });
  if (!renovOkna)   checklist.push({ field: "Tip zasteklitve", action: "verify",  note: "Enojno / dvojno / trojno, leto vgradnje" });
  checklist.push({ field: "Sistem prezračevanja", action: "verify", note: "Naravno / prisilno / rekuperacija — vizualni pregled" });
  if (heatingEst.confidence !== "high") checklist.push({ field: "Sistem ogrevanja", action: "verify", note: `Ocenjen: ${heatingEst.system} — preveriti na terenu` });
  checklist.push({ field: "Sistem TSV (topla sanitarna voda)", action: "fill_in", note: "Bojler / skupaj z ogrevanjem / solar — ni v GURS" });
  checklist.push({ field: "Foto dokumentacija", action: "fill_in", note: "Obvezna za certifikacijo (fasada, okna, kotel, streha)" });
  if (!area) checklist.push({ field: "Kondicionirana površina", action: "measure", note: "Ni v GURS — izmeriti na terenu" });

  return {
    generatedAt: new Date().toISOString(),
    eidStavba,
    address,

    identification: {
      eidStavba:    { value: eidStavba, source: "GURS_REN", confidence: "high" },
      address:      { value: address, source: "GURS_REN", confidence: "high" },
      yearBuilt:    { value: yearBuilt, source: "GURS_REN", confidence: "high" },
      material:     { value: materialName, source: "GURS_REN", confidence: "high",
                      note: `id_konstrukcija=${materialCode}` },
      buildingType: { value: (parseInt(g.st_stanovanj) || 0) > 3 ? "Večstanovanjska" : "Stanovanjska",
                      source: "GURS_REN", confidence: "high" },
      floors:       { value: floors, source: "GURS_REN", confidence: "high" },
      dwellings:    { value: parseInt(g.st_stanovanj) || null, source: "GURS_REN", confidence: "high" },
    },

    geometry: {
      conditionedAreaM2:  { value: area, source: "GURS_EVS", confidence: area ? "high" : "missing",
                            verifyOnSite: !area },
      heatedVolumeM3:     { value: heatedVol ? Math.round(heatedVol) : null,
                            source: "GURS_EVS", confidence: area && floors ? "medium" : "low",
                            note: `${area}m² × ${floorHeight}m × ${floors} etaž` },
      svRatio:            { value: svRatio, source: "GURS_REN", confidence: svRatio ? "medium" : "low" },
      roofAreaM2:         { value: footprint ? Math.round(footprint) : null,
                            source: "GURS_REN", confidence: footprint ? "medium" : "missing" },
      floorAreaM2:        { value: footprint ? Math.round(footprint) : null,
                            source: "GURS_REN", confidence: footprint ? "medium" : "missing" },
      orientation:        { value: null, source: "GURS_REN", confidence: "missing",
                            verifyOnSite: true, note: "Določite iz tlorisa/katastrske karte" },
      perimeter:          { value: footprint ? Math.round(Math.sqrt(footprint) * 4) : null,
                            source: "GURS_REN", confidence: footprint ? "low" : "missing",
                            note: "Ocena iz tlorisne površine — preveriti z dejanskim obrisom" },
      avgFloorHeightM:    { value: floorHeight, source: "GURS_EVS",
                            confidence: d.visina_etaze ? "high" : "medium",
                            note: d.visina_etaze ? "Iz GURS ev_del_stavbe" : "Privzeto 2.6m (mediana SLO)" },
    },

    climate: {
      designTempC:     { value: designTemp, source: "ARSO_JRC", confidence: "high",
                         note: `Klimatska cona: ${climate.climateZone}` },
      hdd:             { value: Math.round(climate.hdd), source: "OPEN_METEO_ERA5", confidence: "high",
                         note: "10-letno povprečje 2014-2023 (ERA5 reanalysis)" },
      annualSolarKwhM2:{ value: Math.round(climate.solarSouth), source: "ARSO_JRC", confidence: "high" },
      solarSouth:      { value: Math.round(climate.solarSouth), source: "ARSO_JRC", confidence: "medium" },
      solarEast:       { value: Math.round(climate.solarEastWest), source: "ARSO_JRC", confidence: "medium" },
      solarWest:       { value: Math.round(climate.solarEastWest), source: "ARSO_JRC", confidence: "medium" },
      solarNorth:      { value: Math.round(climate.solarNorth), source: "ARSO_JRC", confidence: "medium" },
      solarHorizontal: { value: Math.round(climate.solarHorizontal), source: "ARSO_JRC", confidence: "medium" },
      climateZone:     { value: climate.climateZone, source: "ARSO_JRC", confidence: "high" },
    },

    thermalEnvelope: {
      uWall:              { value: tabula.uWall, source: "TABULA_SLO", confidence: envelopeConfidence,
                            note: uWallNote, verifyOnSite: !renovFasade },
      uWallNote,
      uRoof:              { value: tabula.uRoof, source: "TABULA_SLO", confidence: envelopeConfidence,
                            verifyOnSite: !renovStreha },
      uFloor:             { value: tabula.uFloor, source: "TABULA_SLO", confidence: "medium" },
      uWindow:            { value: tabula.uWindow, source: "TABULA_SLO", confidence: envelopeConfidence,
                            verifyOnSite: !renovOkna },
      gValue:             { value: tabula.gWindow, source: "TABULA_SLO", confidence: envelopeConfidence },
      windowRatioPct:     { value: Math.round(windowRatio * 100),
                            source: windowSource, confidence: windowSource === "MAPILLARY_ML" ? "medium" : "low",
                            note: windowSource === "MAPILLARY_ML" ? "ML detekcija iz uličnih posnetkov" : "Statistični prior po eri gradnje" },
      windowAreaM2:       { value: windowAreaM2, source: windowSource, confidence: "low",
                            verifyOnSite: true, note: "Preveriti dejansko površino in orientacijo oken po fasadah" },
      thermalBridgesPsiWmK: { value: psi, source: "TABULA_SLO", confidence: "low",
                              note: `Tipična vrednost za ${materialName}, ${yearBuilt ?? "?"}` },
      thermalBridgesLengthM: { value: null, source: "STATISTICAL_PRIOR", confidence: "missing",
                               verifyOnSite: true },
      renovationFacadeYear:  { value: renovFasade, source: "GURS_REN",
                               confidence: renovFasade ? "high" : "missing" },
      renovationRoofYear:    { value: renovStreha, source: "GURS_REN",
                               confidence: renovStreha ? "high" : "missing" },
      renovationWindowYear:  { value: renovOkna, source: "GURS_EVS",
                               confidence: renovOkna ? "high" : "missing" },
    },

    ventilation: {
      systemType:       { value: ventilation.system, source: "STATISTICAL_PRIOR", confidence: "low",
                          verifyOnSite: true },
      nInf:             { value: ventilation.nEff, source: "STATISTICAL_PRIOR", confidence: "low",
                          note: "Era-based prior (GI ZRMK)" },
      n50:              { value: null, source: "AUDITOR_INPUT", confidence: "missing",
                          note: "Blower door test (ISO 9972) — izvede svetovalec" },
      heatRecoveryEff:  { value: ventilation.heatRecoveryEff ?? null, source: "STATISTICAL_PRIOR",
                          confidence: ventilation.heatRecoveryEff ? "low" : "missing" },
    },

    heating: {
      systemType:         { value: heatingEst.system, source: heatingEst.source.includes("DH") ? "DH_SPATIAL" : hasGas ? "GURS_REN" : "STATISTICAL_PRIOR",
                            confidence: heatingEst.confidence,
                            verifyOnSite: heatingEst.confidence !== "high",
                            note: heatingEst.source },
      seasonalEfficiency: { value: heatingEst.efficiency, source: "STATISTICAL_PRIOR", confidence: "medium" },
      primaryEnergyFactor:{ value: heatingEst.primaryEnergyFactor, source: "STATISTICAL_PRIOR", confidence: "medium" },
      radiatorType:       { value: "radiatorji", source: "STATISTICAL_PRIOR", confidence: "low",
                            verifyOnSite: true },
      dhOperator:         { value: heatingEst.system === "district_heating" ? (heatingEst.source.replace("DH zona: ", "")) : null,
                            source: "DH_SPATIAL", confidence: heatingEst.system === "district_heating" ? "high" : "missing" },
    },

    dhw: {
      systemType:       { value: "neznano", source: "AUDITOR_INPUT", confidence: "missing",
                          verifyOnSite: true, note: "Električni bojler / skupaj z ogrevanjem / solar" },
      efficiency:       { value: 0.85, source: "STATISTICAL_PRIOR", confidence: "low" },
      annualNeedKwhM2:  { value: dhwNeedKwhM2, source: "STATISTICAL_PRIOR", confidence: "low",
                          note: "EN 15316: ~30 kWh/m²a za stanovanjske stavbe" },
    },

    calculatedResults: {
      heatingNeedQnhKwhM2: approxQnh ?? 0,
      primaryEnergyKwhM2:  approxQnh ? Math.round(approxQnh / heatingEst.efficiency) : 0,
      co2KgM2:             approxQnh ? Math.round((approxQnh / heatingEst.efficiency) * heatingEst.co2FactorKgKwh) : 0,
      energyClass:         approxQnh ? (
        approxQnh < 25 ? "A+" : approxQnh < 50 ? "A" : approxQnh < 75 ? "B" :
        approxQnh < 100 ? "C" : approxQnh < 150 ? "D" : approxQnh < 200 ? "E" :
        approxQnh < 250 ? "F" : "G"
      ) : "?",
      confidence: renovFasade && renovOkna ? "medium" : "low",
    },

    auditorChecklist: checklist,

    disclaimer: "Ta dokument je pripravljalna podloga za certificiranega energetskega svetovalca. " +
      "Ni uradna energetska izkaznica in nima pravne veljavnosti. " +
      "Vse vrednosti označene z 'verificirajte na terenu' morajo biti potrjene z meritvijo ali vizualnim pregledom. " +
      "Pripravljeno z RealEstateRadar · EN ISO 13790 · TABULA SLO · GURS · Open-Meteo ERA5.",
  };
}
