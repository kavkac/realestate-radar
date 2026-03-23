/**
 * EIZ Estimator — Energy Performance Estimate for buildings WITHOUT official EIZ
 *
 * For buildings WITH official EIZ → use lib/eiz-lookup.ts (returns certified data)
 * This module is ONLY for the ~75-80% of buildings without certification.
 *
 * Method: simplified EN ISO 13790 monthly method
 * Output labeled: "OCENJENI energetski razred — ni pravno veljavna izkaznica"
 *
 * Data priority per parameter:
 *   Geometry:     LiDAR DMP+DMR > GURS footprint+etaže > defaults
 *   Envelope:     GURS obnova → PURES correction > TABULA archetype
 *   Windows:      GURS obnova > Mapillary ML > statistical prior
 *   Heating:      District heating zone > GURS gas flag > statistical prior
 *   Climate:      ARSO by municipality
 */

import { prisma } from "./prisma";
import { getThermalEnvelope, getMaterialGroup, type GursKonstrukcijaId } from "./tabula-lookup";
import { getWindowData } from "./window-cache";
import { calibrateQnh, applyPuresConstraint, isLikelyDistrictHeating, getPanelBuildingUValues } from "./eiz-calibration";
import { estimateVentilation, calculateHeatedVolume } from "./ventilation-model";
import { getClimate } from "./climate-service";
import { estimateHeatingSystem as estimateHeating, HEATING_SPECS } from "./heating-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnergyClass = "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "G";
type EnvelopeSource = "gurs_renovation" | "tabula" | "default";

export interface EizEstimate {
  // Result
  energyClass: EnergyClass;
  heatingNeedKwhM2: number;     // kWh/(m²·a) — ogrevalna potreba QNH
  primaryEnergyKwhM2: number;   // kWh/(m²·a) — primarna energija
  co2KgM2: number;              // kg CO₂/(m²·a)

  // Confidence
  confidence: "high" | "medium" | "low";
  dataQuality: {
    geometry: "lidar" | "gurs" | "estimated";
    envelope: "gurs_renovation" | "tabula" | "default";
    windows: "mapillary_ml" | "statistical";
    heating: "district_heating" | "gas" | "estimated";
  };

  // Inputs (for transparency)
  inputs: {
    yearBuilt: number;
    material: string;
    conditionedAreaM2: number;
    wallAreaM2: number;
    roofAreaM2: number;
    svRatio: number;
    floors: number | null;
    avgFloorHeightM: number;
    uWall: number;
    uRoof: number;
    uFloor: number;
    uWindow: number;
    gWindow: number;
    thermalBridgeDeltaU: number;
    windowRatio: number;
    windowAreaM2: number;
    ventilationNEff: number;
    ventilationSystem: string;
    heatingSystem: string;
    heatingEfficiency: number;
    climateZone: string;
    heatingDegreeDays: number;
    solarSouthKwhM2: number;
    lidarUsed: boolean;
  };

  // Legal disclaimer (always present)
  disclaimer: string;
  computedAt: Date;
}

// ─── Climate data by SLO municipality (ARSO povprečje 1991-2020) ──────────────
// HDD = Heating Degree Days (base 18°C), Te_design = design winter temperature
const CLIMATE_BY_REGION: Record<string, { hdd: number; teDesign: number; zone: string }> = {
  // Primorska (mild)
  "Koper": { hdd: 1650, teDesign: -2, zone: "primorska" },
  "Nova Gorica": { hdd: 1900, teDesign: -4, zone: "primorska" },
  "Sežana": { hdd: 1750, teDesign: -3, zone: "primorska" },
  // Osrednja SLO
  "Ljubljana": { hdd: 2800, teDesign: -13, zone: "osrednja" },
  "Maribor": { hdd: 2900, teDesign: -14, zone: "osrednja" },
  "Celje": { hdd: 2750, teDesign: -13, zone: "osrednja" },
  "Kranj": { hdd: 3000, teDesign: -15, zone: "alpska" },
  // Alpska
  "Jesenice": { hdd: 3400, teDesign: -18, zone: "alpska" },
  "Murska Sobota": { hdd: 3100, teDesign: -16, zone: "panonska" },
  // Default (osrednja SLO)
  "default": { hdd: 2850, teDesign: -14, zone: "osrednja" },
};

function getClimateData(municipality?: string | null) {
  if (!municipality) return CLIMATE_BY_REGION["default"];
  // Try exact match, then partial
  const exact = CLIMATE_BY_REGION[municipality];
  if (exact) return exact;
  const partial = Object.keys(CLIMATE_BY_REGION).find(k =>
    municipality.toLowerCase().includes(k.toLowerCase()) ||
    k.toLowerCase().includes(municipality.toLowerCase())
  );
  return partial ? CLIMATE_BY_REGION[partial] : CLIMATE_BY_REGION["default"];
}

// ─── Energy class thresholds (SLO PURES 2010 / Pravilnik o metodologiji) ─────
// kWh/(m²·a) heating need (QNH) — standalone residential
function classifyEnergyClass(heatingNeedKwhM2: number): EnergyClass {
  if (heatingNeedKwhM2 <= 15)  return "A+";
  if (heatingNeedKwhM2 <= 25)  return "A";
  if (heatingNeedKwhM2 <= 50)  return "B";
  if (heatingNeedKwhM2 <= 100) return "C";
  if (heatingNeedKwhM2 <= 150) return "D";
  if (heatingNeedKwhM2 <= 200) return "E";
  if (heatingNeedKwhM2 <= 250) return "F";
  return "G";
}

// ─── Heating system efficiencies ─────────────────────────────────────────────
const HEATING_SYSTEMS: Record<string, { efficiency: number; co2Factor: number; label: string }> = {
  district_heating: { efficiency: 0.92, co2Factor: 0.07, label: "Daljinska toplota" },
  gas_boiler:       { efficiency: 0.85, co2Factor: 0.20, label: "Plinski kotel" },
  oil_boiler:       { efficiency: 0.82, co2Factor: 0.27, label: "Oljni kotel" },
  heat_pump_air:    { efficiency: 2.80, co2Factor: 0.13, label: "Toplotna črpalka (zrak)" },
  heat_pump_ground: { efficiency: 3.50, co2Factor: 0.10, label: "Toplotna črpalka (zemlja)" },
  wood_boiler:      { efficiency: 0.78, co2Factor: 0.02, label: "Kotel na drva/pelete" },
  electric:         { efficiency: 1.00, co2Factor: 0.30, label: "Električno ogrevanje" },
  default:          { efficiency: 0.82, co2Factor: 0.22, label: "Neznano (privzeto)" },
};

function estimateHeatingSystem(params: {
  hasGas: boolean;
  inDistrictHeatingZone: boolean;
  yearBuilt: number;
  buildingType?: string;
}): keyof typeof HEATING_SYSTEMS {
  if (params.inDistrictHeatingZone) return "district_heating";
  if (params.hasGas) return "gas_boiler";
  // Statistical prior: post-2010 new builds → heat pump likely
  if (params.yearBuilt >= 2010) return "heat_pump_air";
  // Older rural → wood/oil
  if (params.yearBuilt < 1990) return "oil_boiler";
  return "default";
}

// ─── Simplified EN ISO 13790 monthly method ───────────────────────────────────
/**
 * Calculate annual heating need QNH [kWh/(m²·a)]
 *
 * Simplified steady-state monthly method:
 * QNH = Σ_months [ H_trans × (Ti - Te) × t - η_gain × (Q_int + Q_sol) ] / A_floor
 *
 * Where:
 *   H_trans = total heat loss coefficient [W/K] = Σ(U·A) + H_vent
 *   Ti = indoor setpoint = 20°C
 *   Te = monthly mean outdoor temperature
 *   η_gain = utilization factor for heat gains
 *   Q_int = internal heat gains
 *   Q_sol = solar heat gains through windows
 */
function calculateHeatingNeed(params: {
  conditionedAreaM2: number;
  volumeM3: number;
  // Envelope areas [m²] and U-values [W/(m²K)]
  wallAreaM2: number;
  uWall: number;
  roofAreaM2: number;
  uRoof: number;
  floorAreaM2: number;
  uFloor: number;
  // Windows
  windowAreaSouthM2: number;
  windowAreaNorthM2: number;
  windowAreaEastWestM2: number;
  uWindow: number;
  gWindow: number;
  thermalBridge: number;   // additional ΔU for thermal bridges
  // Ventilation
  airChangeRate: number;   // h⁻¹, natural ventilation default 0.5
  // Climate
  hdd: number;             // heating degree days
  // Shading (0=full shade, 1=no shade)
  shadingFactorSouth: number;
  shadingFactorNorth: number;
  shadingFactorEastWest: number;
  solarSouth?: number;
  solarNorth?: number;
  solarEastWest?: number;
}): number {
  const {
    conditionedAreaM2, volumeM3,
    wallAreaM2, uWall, roofAreaM2, uRoof, floorAreaM2, uFloor,
    windowAreaSouthM2, windowAreaNorthM2, windowAreaEastWestM2,
    uWindow, gWindow, thermalBridge,
    airChangeRate, hdd,
    shadingFactorSouth, shadingFactorNorth, shadingFactorEastWest,
  } = params;

  // Total transmission heat loss coefficient [W/K]
  const totalWindowArea = windowAreaSouthM2 + windowAreaNorthM2 + windowAreaEastWestM2;
  const opaqueWallArea = wallAreaM2 - totalWindowArea;

  const H_trans =
    opaqueWallArea * (uWall + thermalBridge) +
    roofAreaM2 * uRoof +
    floorAreaM2 * uFloor +
    totalWindowArea * uWindow;

  // Ventilation heat loss [W/K]: 0.34 × n × V
  const H_vent = 0.34 * airChangeRate * volumeM3;

  // Total heat loss [W/K]
  const H_total = H_trans + H_vent;

  // Annual transmission losses [kWh/a] from HDD
  // HDD is in K·days, H in W/K → kWh = H × HDD × 24 / 1000
  const Q_loss = H_total * hdd * 24 / 1000;

  // Solar gains [kWh/a] — per-location irradiation from climate service
  const {
    solarSouth = 680, solarNorth = 175, solarEastWest = 400,
  } = params;
  const Q_sol =
    windowAreaSouthM2 * gWindow * shadingFactorSouth * solarSouth +
    windowAreaNorthM2 * gWindow * shadingFactorNorth * solarNorth +
    windowAreaEastWestM2 * gWindow * shadingFactorEastWest * solarEastWest;

  // Internal gains [kWh/a]: 4 W/m² × 8760h/a = 35 kWh/(m²·a) typical residential
  const Q_int = 4.0 * conditionedAreaM2 * 8760 / 1000;

  // Utilization factor η (EN 13790 simplified): ~0.80 for typical SLO buildings
  const gamma = (Q_sol + Q_int) / Math.max(Q_loss, 1);
  const eta = gamma >= 1 ? 1 / gamma : (1 - Math.pow(gamma, 5)) / (1 - Math.pow(gamma, 6));

  // Net heating need [kWh/a]
  const Q_heating = Math.max(0, Q_loss - eta * (Q_sol + Q_int));

  // Per unit area [kWh/(m²·a)]
  return Math.round(Q_heating / conditionedAreaM2);
}

// ─── Main estimator ───────────────────────────────────────────────────────────

export async function estimateEiz(params: {
  eidStavba: string;
  eidDelStavbe?: string;
  lat: number;
  lng: number;
  municipality?: string | null;
  // Optional LiDAR-derived geometry (if computed)
  lidarHeightM?: number | null;
  lidarVolumeM3?: number | null;
  lidarWallAreaM2?: number | null;
  lidarRoofAreaM2?: number | null;
  lidarShadingFactorSouth?: number | null;
  // User overrides (logged-in owner)
  userOverrides?: {
    windowRatio?: number;
    heatingSystem?: string;
    yearFacadeRenovated?: number;
    yearRoofRenovated?: number;
    yearWindowsRenovated?: number;
  };
}): Promise<EizEstimate | null> {
  const { eidStavba, eidDelStavbe, lat, lng, municipality, lidarHeightM, lidarVolumeM3,
          lidarWallAreaM2, lidarRoofAreaM2, lidarShadingFactorSouth, userOverrides } = params;

  try {
    // ── 1. Fetch GURS data ────────────────────────────────────────────────────
    const gursStavba = await (prisma as any).$queryRaw<Array<{
      leto_izg_sta: string;
      id_konstrukcija: string;
      id_tip_stavbe: string;
      leto_obn_fasade: string;
      leto_obn_strehe: string;
      st_etaz: string;
      pov_stavbe: string;
      ima_plin_dn: string;
      rpe_obcine_sifra: string;
    }>>`
      SELECT leto_izg_sta, id_konstrukcija, id_tip_stavbe,
             leto_obn_fasade, leto_obn_strehe, st_etaz, pov_stavbe,
             ima_plin_dn, rpe_obcine_sifra
      FROM ev_stavba WHERE eid_stavba = ${eidStavba} LIMIT 1
    `;

    const gursDelStavbe = eidDelStavbe ? await (prisma as any).$queryRaw<Array<{
      upor_pov: string;
      leto_obn_oken: string;
      visina_etaze: string;
    }>>`
      SELECT upor_pov, leto_obn_oken, visina_etaze
      FROM ev_del_stavbe WHERE eid_del_stavbe = ${eidDelStavbe} LIMIT 1
    ` : [];

    const stavba = gursStavba[0];
    const delStavbe = gursDelStavbe[0];

    if (!stavba) return null;

    // ── 2. Parse GURS values ──────────────────────────────────────────────────
    const yearBuilt = parseInt(stavba.leto_izg_sta) || 1970;
    const konstrukcijaId = parseInt(stavba.id_konstrukcija) as GursKonstrukcijaId;
    const floors = parseInt(stavba.st_etaz) || 2;
    const grossAreaM2 = parseFloat(stavba.pov_stavbe) || 100;
    const conditionedAreaM2 = parseFloat(delStavbe?.upor_pov || "0") || grossAreaM2 * 0.85;
    const vizinaEtaze = parseFloat(delStavbe?.visina_etaze || "0") || null;
    const hasGas = stavba.ima_plin_dn === "1";

    const yearFacadeRenovated = userOverrides?.yearFacadeRenovated ||
      (parseInt(stavba.leto_obn_fasade) || null);
    const yearRoofRenovated = userOverrides?.yearRoofRenovated ||
      (parseInt(stavba.leto_obn_strehe) || null);
    const yearWindowsRenovated = userOverrides?.yearWindowsRenovated ||
      (parseInt(delStavbe?.leto_obn_oken || "") || null);

    // ── 3. Geometry (visina_etaze iz GURS kjer je, sicer LiDAR/default) ──────
    const footprintM2 = grossAreaM2 / Math.max(floors, 1);
    const perimeterM = 4 * Math.sqrt(footprintM2);
    const volumeCalc = calculateHeatedVolume({
      conditionedAreaM2,
      floors,
      vizinaEtaze,
      lidarHeightM,
    });
    const volumeM3 = lidarVolumeM3 ?? volumeCalc.volumeM3;
    const heightM = lidarHeightM ?? (volumeM3 / footprintM2);
    const wallAreaM2 = lidarWallAreaM2 ?? (perimeterM * heightM);
    const roofAreaM2 = lidarRoofAreaM2 ?? footprintM2;
    const svRatio = (wallAreaM2 + roofAreaM2 + footprintM2) / volumeM3;

    const geometrySource: EizEstimate["dataQuality"]["geometry"] =
      lidarHeightM ? "lidar" : "gurs";

    // ── 4. Thermal envelope (TABULA) ──────────────────────────────────────────
    const envelope = getThermalEnvelope({
      yearBuilt,
      konstrukcijaId,
      yearFacadeRenovated,
      yearRoofRenovated,
      yearWindowsRenovated,
    });

    const envelopeSource: EnvelopeSource =
      (yearFacadeRenovated || yearRoofRenovated) ? "gurs_renovation" : "tabula";

    // Apply PURES upper bound constraint
    const puresConstrained = applyPuresConstraint(envelope, yearBuilt);
    envelope.uWall = puresConstrained.uWall;
    envelope.uRoof = puresConstrained.uRoof;
    envelope.uFloor = puresConstrained.uFloor;
    envelope.uWindow = puresConstrained.uWindow;

    // Panel building catalog override (more precise than generic TABULA)
    if (konstrukcijaId === 7) {
      const panelSpec = getPanelBuildingUValues(yearBuilt);
      if (panelSpec && !yearFacadeRenovated) {
        envelope.uWall = panelSpec.uWall;
        envelope.uRoof = panelSpec.uRoof;
        // Don't override uWindow if we have GURS renovation data
        if (!yearWindowsRenovated) envelope.uWindow = panelSpec.uWindow;
      }
    }

    // ── 5. Window data ────────────────────────────────────────────────────────
    const windowData = await getWindowData({
      propertyId: eidDelStavbe || eidStavba,
      lat, lng, yearBuilt,
    });

    const windowRatio = userOverrides?.windowRatio ?? windowData.windowRatio;
    const totalWindowAreaM2 = wallAreaM2 * windowRatio;
    // Distribute windows by orientation: south 40%, north 20%, E/W 40%
    const windowSouthM2 = totalWindowAreaM2 * 0.40;
    const windowNorthM2 = totalWindowAreaM2 * 0.20;
    const windowEastWestM2 = totalWindowAreaM2 * 0.40;

    // ── 6. Heating system — spatial DH zone + statistical prior ──────────────
    const heatingEst = estimateHeating({
      lat, lng, yearBuilt,
      buildingFloors: floors,
      municipality,
      hasGas,
      userOverride: userOverrides?.heatingSystem as any,
    });
    const heatingSystem = {
      efficiency: heatingEst.efficiency,
      co2Factor: heatingEst.co2FactorKgKwh,
      label: heatingEst.system,
    };
    const heatingSource: EizEstimate["dataQuality"]["heating"] =
      heatingEst.system === "district_heating" ? "district_heating" :
      hasGas ? "gas" : "estimated";

    // ── 7. Climate — Open-Meteo per coordinate (ERA5, 10y avg) ───────────────
    const climate = await getClimate(lat, lng);

    // ── 7b. Ventilation ───────────────────────────────────────────────────────
    const ventilation = estimateVentilation({
      yearBuilt,
      konstrukcijaId,
      yearWindowsRenovated,
      floors,
      conditionedAreaM2,
      userVentilationSystem: userOverrides?.heatingSystem === "mvhr" ? "mvhr" : undefined,
    });

    // ── 8. EN 13790 calculation ───────────────────────────────────────────────
    const heatingNeedKwhM2 = calculateHeatingNeed({
      conditionedAreaM2,
      volumeM3,
      wallAreaM2,
      uWall: envelope.uWall,
      roofAreaM2,
      uRoof: envelope.uRoof,
      floorAreaM2: footprintM2,
      uFloor: envelope.uFloor,
      windowAreaSouthM2: windowSouthM2,
      windowAreaNorthM2: windowNorthM2,
      windowAreaEastWestM2: windowEastWestM2,
      uWindow: envelope.uWindow,
      gWindow: envelope.gWindow,
      thermalBridge: envelope.thermalBridge,
      airChangeRate: ventilation.nEff,
      hdd: climate.hdd,
      solarSouth: climate.solarSouth,
      solarNorth: climate.solarNorth,
      solarEastWest: climate.solarEastWest,
      shadingFactorSouth: lidarShadingFactorSouth ?? 0.85,
      shadingFactorNorth: 0.90,
      shadingFactorEastWest: 0.85,
    });

    // ── 9. Calibrate QNH against empirical SLO data ──────────────────────────
    const hasRenovationData = !!(yearFacadeRenovated || yearRoofRenovated || yearWindowsRenovated);
    const { calibratedQnh } = calibrateQnh({
      calculatedQnh: heatingNeedKwhM2,
      yearBuilt,
      konstrukcijaId,
      hasRenovationData,
    });
    const finalQnh = calibratedQnh;

    // ── 10. Primary energy + CO₂ ─────────────────────────────────────────────
    const primaryEnergyKwhM2 = Math.round(finalQnh / heatingSystem.efficiency);
    const co2KgM2 = Math.round(primaryEnergyKwhM2 * heatingSystem.co2Factor);

    // ── 10. Overall confidence ────────────────────────────────────────────────
    const confidence: EizEstimate["confidence"] =
      geometrySource === "lidar" && envelopeSource === "gurs_renovation" && windowData.confidence !== "low"
        ? "high"
        : envelopeSource !== ("default" as EnvelopeSource) && conditionedAreaM2 > 0
          ? "medium"
          : "low";

    return {
      energyClass: classifyEnergyClass(finalQnh),
      heatingNeedKwhM2: finalQnh,
      primaryEnergyKwhM2,
      co2KgM2,
      confidence,
      dataQuality: {
        geometry: geometrySource,
        envelope: envelopeSource,
        windows: windowData.source === "mapillary_ml" ? "mapillary_ml" : "statistical",
        heating: heatingSource,
      },
      inputs: {
        yearBuilt,
        material: getMaterialGroup(konstrukcijaId),
        conditionedAreaM2: Math.round(conditionedAreaM2),
        wallAreaM2: Math.round(wallAreaM2),
        roofAreaM2: Math.round(roofAreaM2),
        svRatio: Math.round(svRatio * 100) / 100,
        floors,
        avgFloorHeightM: vizinaEtaze ?? Math.round((heightM / Math.max(floors, 1)) * 10) / 10,
        uWall: envelope.uWall,
        uRoof: envelope.uRoof,
        uFloor: envelope.uFloor,
        uWindow: envelope.uWindow,
        gWindow: envelope.gWindow,
        thermalBridgeDeltaU: envelope.thermalBridge,
        windowRatio,
        windowAreaM2: Math.round(totalWindowAreaM2),
        ventilationNEff: ventilation.nEff,
        ventilationSystem: ventilation.system,
        heatingSystem: heatingSystem.label,
        heatingEfficiency: heatingSystem.efficiency,
        climateZone: climate.climateZone,
        heatingDegreeDays: climate.hdd,
        solarSouthKwhM2: Math.round(climate.solarSouth),
        lidarUsed: !!(lidarWallAreaM2 || lidarRoofAreaM2),
      },
      disclaimer: "OCENJENI energetski razred — ni pravno veljavna energetska izkaznica (EIZ). Za uradno izkaznico se obrnite na certificiranega energetičarja.",
      computedAt: new Date(),
    };
  } catch (e) {
    console.error("[eiz-estimator] error", e);
    return null;
  }
}
