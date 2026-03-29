import { prisma } from "./prisma";

export interface LidarFeatures {
  eidStavba: string;
  elevationM: number | null;
  buildingHeightM: number | null;
  buildingHeightMeanM: number | null;
  roofType: string | null;
  floorHeightM: number | null;
  viewshedScore360: number | null;
  viewshedN: number | null; viewshedNe: number | null;
  viewshedE: number | null; viewshedSe: number | null;
  viewshedS: number | null; viewshedSw: number | null;
  viewshedW: number | null; viewshedNw: number | null;
  horizonDistanceAvgM: number | null;
  mountainVisibilityBool: boolean | null;
  mountainVisibilityDistanceM: number | null;
  waterVisibilityBool: boolean | null;
  waterVisibilityDistanceM: number | null;
  greenVisibilityPct: number | null;
  opennessIndex: number | null;
  solarRadiationAnnualKwhM2: number | null;
  solarRadiationSummerKwhM2: number | null;
  solarRadiationWinterKwhM2: number | null;
  sunHoursSummerSolstice: number | null;
  sunHoursWinterSolstice: number | null;
  skyViewFactor: number | null;
  shadowMorningScore: number | null;
  shadowAfternoonScore: number | null;
  floodRiskScore: number | null;
  depressionScore: number | null;
  slopeAvgDeg: number | null;
  slopeMaxDeg: number | null;
  aspectDominant: string | null;
  tpiScore: number | null;
  wetnessIndex: number | null;
  relativeElevation100m: number | null;
  relativeElevation500m: number | null;
  canopyCover50mPct: number | null;
  canopyCover200mPct: number | null;
  canopyCover500mPct: number | null;
  treeHeightAvgM: number | null;
  treeHeightMaxM: number | null;
  greenSpaceArea200mM2: number | null;
  buildingProximityAvgM: number | null;
  overlookedScore: number | null;
  privacyScore: number | null;
  roadExposureScore: number | null;
  buildingDensity200m: number | null;
  avgBuildingHeight200mM: number | null;
  openSpaceRatio200m: number | null;
  mansardaDetected: boolean | null;
  mansardaFloorNum: number | null;
  viewshedPerFloor: Array<{
    floor: number; score_360: number | null;
    n?: number | null; ne?: number | null; e?: number | null; se?: number | null;
    s?: number | null; sw?: number | null; w?: number | null; nw?: number | null;
    mountain?: boolean | null; horizon_m?: number | null;
  }> | null;
  computedAt: Date | null;
  pipelineVersion: string | null;
}

type Row = Record<string, unknown>;

export async function getLidarFeatures(
  eidStavba: string | number | bigint
): Promise<LidarFeatures | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT
        eid_stavba, elevation_m, building_height_m, building_height_mean_m,
        roof_type, floor_height_m,
        viewshed_score_360, viewshed_n, viewshed_ne, viewshed_e, viewshed_se,
        viewshed_s, viewshed_sw, viewshed_w, viewshed_nw,
        horizon_distance_avg_m, mountain_visibility_bool, mountain_visibility_distance_m,
        water_visibility_bool, water_visibility_distance_m,
        green_visibility_pct, openness_index,
        solar_radiation_annual_kwh_m2, solar_radiation_summer_kwh_m2,
        solar_radiation_winter_kwh_m2, sun_hours_summer_solstice, sun_hours_winter_solstice,
        sky_view_factor, shadow_morning_score, shadow_afternoon_score,
        flood_risk_score, depression_score, slope_avg_deg, slope_max_deg,
        aspect_dominant, tpi_score, wetness_index,
        relative_elevation_100m, relative_elevation_500m,
        canopy_cover_50m_pct, canopy_cover_200m_pct, canopy_cover_500m_pct,
        tree_height_avg_m, tree_height_max_m, green_space_area_200m_m2,
        building_proximity_avg_m, overlooked_score, privacy_score,
        road_exposure_score, building_density_200m, avg_building_height_200m_m,
        open_space_ratio_200m, mansarda_detected, mansarda_floor_num,
        viewshed_per_floor, computed_at, pipeline_version
      FROM lidar_building_features
      WHERE eid_stavba = $1
      LIMIT 1`,
      String(eidStavba)
    );

    if (!rows || rows.length === 0) return null;
    const r = rows[0];

    const num = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };
    const bool = (v: unknown): boolean | null => {
      if (v == null) return null;
      return Boolean(v);
    };

    let viewshedPerFloor = null;
    if (r.viewshed_per_floor) {
      try {
        const raw = typeof r.viewshed_per_floor === "string"
          ? JSON.parse(r.viewshed_per_floor as string)
          : r.viewshed_per_floor;
        if (Array.isArray(raw)) viewshedPerFloor = raw;
      } catch { /* ignore */ }
    }

    return {
      eidStavba: String(r.eid_stavba),
      elevationM: num(r.elevation_m),
      buildingHeightM: num(r.building_height_m),
      buildingHeightMeanM: num(r.building_height_mean_m),
      roofType: r.roof_type ? String(r.roof_type) : null,
      floorHeightM: num(r.floor_height_m),
      viewshedScore360: num(r.viewshed_score_360),
      viewshedN: num(r.viewshed_n), viewshedNe: num(r.viewshed_ne),
      viewshedE: num(r.viewshed_e), viewshedSe: num(r.viewshed_se),
      viewshedS: num(r.viewshed_s), viewshedSw: num(r.viewshed_sw),
      viewshedW: num(r.viewshed_w), viewshedNw: num(r.viewshed_nw),
      horizonDistanceAvgM: num(r.horizon_distance_avg_m),
      mountainVisibilityBool: bool(r.mountain_visibility_bool),
      mountainVisibilityDistanceM: num(r.mountain_visibility_distance_m),
      waterVisibilityBool: bool(r.water_visibility_bool),
      waterVisibilityDistanceM: num(r.water_visibility_distance_m),
      greenVisibilityPct: num(r.green_visibility_pct),
      opennessIndex: num(r.openness_index),
      solarRadiationAnnualKwhM2: num(r.solar_radiation_annual_kwh_m2),
      solarRadiationSummerKwhM2: num(r.solar_radiation_summer_kwh_m2),
      solarRadiationWinterKwhM2: num(r.solar_radiation_winter_kwh_m2),
      sunHoursSummerSolstice: num(r.sun_hours_summer_solstice),
      sunHoursWinterSolstice: num(r.sun_hours_winter_solstice),
      skyViewFactor: num(r.sky_view_factor),
      shadowMorningScore: num(r.shadow_morning_score),
      shadowAfternoonScore: num(r.shadow_afternoon_score),
      floodRiskScore: num(r.flood_risk_score),
      depressionScore: num(r.depression_score),
      slopeAvgDeg: num(r.slope_avg_deg),
      slopeMaxDeg: num(r.slope_max_deg),
      aspectDominant: r.aspect_dominant ? String(r.aspect_dominant) : null,
      tpiScore: num(r.tpi_score),
      wetnessIndex: num(r.wetness_index),
      relativeElevation100m: num(r.relative_elevation_100m),
      relativeElevation500m: num(r.relative_elevation_500m),
      canopyCover50mPct: num(r.canopy_cover_50m_pct),
      canopyCover200mPct: num(r.canopy_cover_200m_pct),
      canopyCover500mPct: num(r.canopy_cover_500m_pct),
      treeHeightAvgM: num(r.tree_height_avg_m),
      treeHeightMaxM: num(r.tree_height_max_m),
      greenSpaceArea200mM2: num(r.green_space_area_200m_m2),
      buildingProximityAvgM: num(r.building_proximity_avg_m),
      overlookedScore: num(r.overlooked_score),
      privacyScore: num(r.privacy_score),
      roadExposureScore: num(r.road_exposure_score),
      buildingDensity200m: num(r.building_density_200m),
      avgBuildingHeight200mM: num(r.avg_building_height_200m_m),
      openSpaceRatio200m: num(r.open_space_ratio_200m),
      mansardaDetected: bool(r.mansarda_detected),
      mansardaFloorNum: num(r.mansarda_floor_num) != null ? Math.round(num(r.mansarda_floor_num)!) : null,
      viewshedPerFloor,
      computedAt: r.computed_at ? new Date(String(r.computed_at)) : null,
      pipelineVersion: r.pipeline_version ? String(r.pipeline_version) : null,
    };
  } catch (err) {
    console.error("[getLidarFeatures] error:", err);
    return null;
  }
}
