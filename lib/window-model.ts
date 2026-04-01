/**
 * Statistical window model for EIZ energy estimation.
 * Returns per-facade window ratios based on:
 *   1. LiDAR facade_orientations (azimuth + length) when available -- high confidence
 *   2. Statistical model from GURS id_tip_stavbe x leto_izg_sta -- medium confidence
 *
 * Window distribution: South = azimuth 135-225 deg, North = 315-360 or 0-45, E/W = rest
 */

export interface WindowModel {
  totalRatio: number;        // fraction of wall area that is windows (e.g. 0.18)
  southFraction: number;     // fraction of total windows facing south
  northFraction: number;
  eastWestFraction: number;
  confidence: "high" | "medium" | "low";
  source: "lidar_orientation" | "statistical";
}

interface FacadeSegment {
  azimuth_deg: number;
  length_m: number;
  shared_wall: boolean;
}

// Statistical lookup table: [totalRatio, southFraction, northFraction, eastWestFraction]
type WindowStats = [number, number, number, number];

function getStatisticalModel(tipStavbe: number | null, yearBuilt: number): WindowStats {
  const era =
    yearBuilt < 1945 ? 0 :
    yearBuilt < 1971 ? 1 :
    yearBuilt < 1991 ? 2 :
    yearBuilt < 2011 ? 3 : 4;

  // Family homes (1100, 1110, 1121, 1122)
  const familyTypes = new Set([1100, 1110, 1121, 1122]);
  // Apartment blocks (1220, 1221, 1222, 1230)
  const blockTypes = new Set([1220, 1221, 1222, 1230]);

  if (tipStavbe != null && familyTypes.has(tipStavbe)) {
    const table: WindowStats[] = [
      [0.14, 0.45, 0.15, 0.40], // <1945
      [0.16, 0.42, 0.18, 0.40], // 1945-1970
      [0.18, 0.40, 0.20, 0.40], // 1971-1990
      [0.20, 0.42, 0.18, 0.40], // 1991-2010
      [0.22, 0.45, 0.15, 0.40], // >2010
    ];
    return table[era];
  }

  if (tipStavbe != null && blockTypes.has(tipStavbe)) {
    const table: WindowStats[] = [
      [0.16, 0.38, 0.22, 0.40], // <1945
      [0.16, 0.38, 0.22, 0.40], // 1945-1970
      [0.18, 0.36, 0.24, 0.40], // 1971-1990
      [0.20, 0.38, 0.22, 0.40], // 1991-2010
      [0.22, 0.40, 0.20, 0.40], // >2010
    ];
    return table[era];
  }

  // Default fallback for all other building types
  return [0.17, 0.40, 0.20, 0.40];
}

function azimuthToOrientation(azimuth: number): "south" | "north" | "eastWest" {
  // Normalize to 0-360
  const a = ((azimuth % 360) + 360) % 360;
  // South: 135-225 deg
  if (a >= 135 && a <= 225) return "south";
  // North: 315-360 or 0-45 deg
  if (a >= 315 || a <= 45) return "north";
  return "eastWest";
}

export function getWindowModel(params: {
  tipStavbe: number | null;
  yearBuilt: number;
  facadeOrientations?: FacadeSegment[] | null;
}): WindowModel {
  const { tipStavbe, yearBuilt, facadeOrientations } = params;
  const [totalRatio, statSouth, statNorth, statEW] = getStatisticalModel(tipStavbe, yearBuilt);

  // Use LiDAR facade orientations when available
  if (facadeOrientations && facadeOrientations.length > 0) {
    const exposed = facadeOrientations.filter((f) => !f.shared_wall);
    if (exposed.length > 0) {
      let lengthSouth = 0;
      let lengthNorth = 0;
      let lengthEW = 0;
      let totalLength = 0;

      for (const seg of exposed) {
        const orientation = azimuthToOrientation(seg.azimuth_deg);
        totalLength += seg.length_m;
        if (orientation === "south") lengthSouth += seg.length_m;
        else if (orientation === "north") lengthNorth += seg.length_m;
        else lengthEW += seg.length_m;
      }

      if (totalLength > 0) {
        return {
          totalRatio,
          southFraction: lengthSouth / totalLength,
          northFraction: lengthNorth / totalLength,
          eastWestFraction: lengthEW / totalLength,
          confidence: "high",
          source: "lidar_orientation",
        };
      }
    }
  }

  // Fall back to statistical model
  return {
    totalRatio,
    southFraction: statSouth,
    northFraction: statNorth,
    eastWestFraction: statEW,
    confidence: "medium",
    source: "statistical",
  };
}
