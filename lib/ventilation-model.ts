/**
 * Ventilation model for EIZ estimation
 *
 * No public data source exists for actual ventilation systems in SLO buildings.
 * This module uses:
 *   1. Construction era → natural vs mechanical
 *   2. PURES regulatory constraint (post-2010 requires MVHR effectively)
 *   3. Window renovation → airtightness improvement
 *   4. Construction type → panel building airtightness penalty (GI ZRMK)
 *   5. Building height → stack effect correction
 *
 * Output: effective air change rate n_eff [h⁻¹] for EN 13790 calculation
 */

export type GursKonstrukcijaId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 0 | -1;

export interface VentilationResult {
  nEff: number;              // effective air change rate [h⁻¹] for heating calculation
  nInfiltration: number;     // uncontrolled infiltration component [h⁻¹]
  nVentilation: number;      // intentional ventilation component [h⁻¹]
  hasHeatRecovery: boolean;
  heatRecoveryEff: number;   // 0.0-1.0, only relevant if hasHeatRecovery
  system: string;            // human-readable label
  confidence: "high" | "medium" | "low";
  notes: string[];
}

// ─── Panel building airtightness data (GI ZRMK research) ─────────────────────
// Prefab/panel buildings 1960-1985 have documented airtightness problems
// at panel joints → higher infiltration component
function getPanelAirtightnessPenalty(
  konstrukcijaId: GursKonstrukcijaId,
  yearBuilt: number,
): number {
  if (konstrukcijaId !== 7) return 0; // only montažna
  if (yearBuilt < 1960 || yearBuilt > 1990) return 0;
  // IMP / Primat / TAM systems: measured n50 ≈ 6-8 h⁻¹ vs 3-5 for masonry
  // Additional infiltration: ~0.15 h⁻¹
  return 0.15;
}

// ─── Stack effect correction for tall buildings ───────────────────────────────
function getStackEffectCorrection(floors: number): number {
  if (floors <= 3) return 0;
  if (floors <= 6) return 0.05;
  if (floors <= 10) return 0.10;
  return 0.15; // high-rise
}

// ─── Main ventilation estimator ───────────────────────────────────────────────
export function estimateVentilation(params: {
  yearBuilt: number;
  konstrukcijaId?: GursKonstrukcijaId | null;
  yearWindowsRenovated?: number | null;
  floors?: number | null;
  conditionedAreaM2?: number | null;
  // User override
  userVentilationSystem?: "natural" | "mechanical" | "mvhr";
}): VentilationResult {
  const {
    yearBuilt,
    konstrukcijaId = 1,
    yearWindowsRenovated,
    floors = 2,
    userVentilationSystem,
  } = params;

  const notes: string[] = [];
  let hasHeatRecovery = false;
  let heatRecoveryEff = 0;

  // ── Step 1: Base ventilation rate by era ─────────────────────────────────
  let nBase: number;
  let system: string;

  if (userVentilationSystem === "mvhr") {
    nBase = 0.5;
    hasHeatRecovery = true;
    heatRecoveryEff = 0.80;
    system = "MVHR (rekuperacija) — vnos uporabnika";
  } else if (userVentilationSystem === "mechanical") {
    nBase = 0.5;
    system = "Mehansko prezračevanje brez rekuperacije";
  } else if (userVentilationSystem === "natural") {
    nBase = 0.5;
    system = "Naravno prezračevanje — vnos uporabnika";
  } else if (yearBuilt >= 2021) {
    // NZEB: MVHR effectively mandatory for A/A+ class
    nBase = 0.5;
    hasHeatRecovery = true;
    heatRecoveryEff = 0.85;
    system = "MVHR (PURES 2021 — NZEB)";
    notes.push("Post-2021 stavba: predpostavljamo MVHR η=85%");
  } else if (yearBuilt >= 2010) {
    // PURES 2010: MVHR strongly implied for well-insulated buildings
    nBase = 0.5;
    hasHeatRecovery = true;
    heatRecoveryEff = 0.75;
    system = "MVHR (PURES 2010)";
    notes.push("Post-2010 stavba: predpostavljamo MVHR η=75%");
  } else if (yearBuilt >= 1990) {
    // Natural ventilation, better airtightness than older
    nBase = 0.5;
    system = "Naravno prezračevanje";
  } else if (yearBuilt >= 1960) {
    // Natural ventilation, gravity shafts, leakier
    nBase = 0.6;
    system = "Naravno prezračevanje (gravitacijski jaški)";
  } else {
    // Pre-1960: very leaky, gravity ventilation
    nBase = 0.7;
    system = "Naravno prezračevanje (stara gradnja — visoka infiltracija)";
  }

  // ── Step 2: Infiltration component ───────────────────────────────────────
  let nInfiltration: number;

  if (yearBuilt >= 2010) {
    // Post-2010: mandatory airtightness testing, n50 ≤ 3 h⁻¹
    nInfiltration = 0.05;
  } else if (yearBuilt >= 1990) {
    nInfiltration = 0.15;
  } else if (yearBuilt >= 1975) {
    nInfiltration = 0.25;
  } else {
    nInfiltration = 0.35;
  }

  // Window renovation reduces infiltration significantly
  if (yearWindowsRenovated && yearWindowsRenovated > yearBuilt) {
    const reduction = yearWindowsRenovated >= 2010 ? 0.20 :
                      yearWindowsRenovated >= 2000 ? 0.15 : 0.10;
    nInfiltration = Math.max(0.05, nInfiltration - reduction);
    notes.push(`Okna obnovljena ${yearWindowsRenovated} → infiltracija znižana`);
  }

  // Panel building penalty (GI ZRMK data)
  const panelPenalty = getPanelAirtightnessPenalty(
    (konstrukcijaId ?? 1) as GursKonstrukcijaId,
    yearBuilt,
  );
  if (panelPenalty > 0) {
    nInfiltration += panelPenalty;
    notes.push(`Montažna/panel stavba: airtightness penalizacija +${panelPenalty} h⁻¹ (GI ZRMK)`);
  }

  // Stack effect for tall buildings
  const stackCorrection = getStackEffectCorrection(floors ?? 2);
  if (stackCorrection > 0) {
    nInfiltration += stackCorrection;
    notes.push(`Stack effect (${floors} etaž): +${stackCorrection} h⁻¹`);
  }

  // ── Step 3: Total and effective n ─────────────────────────────────────────
  const nTotal = nBase + nInfiltration;

  // With heat recovery: reduce by recovery efficiency
  const nEff = hasHeatRecovery
    ? nInfiltration + nBase * (1 - heatRecoveryEff) // infiltration not recovered
    : nTotal;

  // ── Step 4: Confidence ────────────────────────────────────────────────────
  const confidence: VentilationResult["confidence"] =
    userVentilationSystem ? "high" :
    yearBuilt >= 2010 ? "medium" :   // PURES implies MVHR but not certain
    "low";                            // statistical prior only

  return {
    nEff: Math.round(nEff * 100) / 100,
    nInfiltration: Math.round(nInfiltration * 100) / 100,
    nVentilation: Math.round(nBase * 100) / 100,
    hasHeatRecovery,
    heatRecoveryEff,
    system,
    confidence,
    notes,
  };
}

/**
 * Calculate heated volume from GURS data.
 * Priority: visina_etaze (measured) > LiDAR > floors × default height
 */
export function calculateHeatedVolume(params: {
  conditionedAreaM2: number;
  floors: number;
  vizinaEtaze?: number | null;    // from ev_del_stavbe.visina_etaze
  lidarHeightM?: number | null;
}): { volumeM3: number; floorHeightM: number; source: string } {
  const { conditionedAreaM2, floors, vizinaEtaze, lidarHeightM } = params;

  if (vizinaEtaze && vizinaEtaze >= 2.0 && vizinaEtaze <= 5.0) {
    return {
      volumeM3: conditionedAreaM2 * vizinaEtaze,
      floorHeightM: vizinaEtaze,
      source: "gurs_measured",
    };
  }

  if (lidarHeightM && floors > 0) {
    const floorH = lidarHeightM / floors;
    if (floorH >= 2.2 && floorH <= 4.5) {
      return {
        volumeM3: conditionedAreaM2 * floorH,
        floorHeightM: floorH,
        source: "lidar_derived",
      };
    }
  }

  // Default: 2.6m (median from GURS ev_del_stavbe analysis)
  return {
    volumeM3: conditionedAreaM2 * 2.6,
    floorHeightM: 2.6,
    source: "default_2.6m",
  };
}
