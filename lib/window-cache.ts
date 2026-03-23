/**
 * Window data cache — lazy compute, persistent storage
 *
 * Cache TTL: 180 days (Mapillary imagery doesn't change often)
 * Falls back to statistical prior if no Mapillary coverage.
 *
 * windowRatioSource:
 *   "mapillary_ml"    — real measurement from Mapillary + Gemini Vision
 *   "statistical"     — estimated from construction year + building type
 *   "eiz_measured"    — from actual energy certificate (most accurate)
 */

import { fetchNearbyImages } from "./mapillary-api";
import { estimateWindowRatio } from "./window-detection";
import { prisma } from "./prisma";

const CACHE_TTL_DAYS = 180;

export interface WindowData {
  windowRatio: number;
  source: "mapillary_ml" | "statistical" | "eiz_measured";
  confidence: "high" | "medium" | "low";
  computedAt: Date;
}

/**
 * Statistical prior: window-to-wall ratio by construction era.
 * Based on EN 13829 and Slovenian building stock research.
 */
function statisticalWindowRatio(yearBuilt?: number | null): {
  ratio: number;
  confidence: "low";
} {
  if (!yearBuilt) return { ratio: 0.25, confidence: "low" };
  if (yearBuilt < 1919) return { ratio: 0.18, confidence: "low" };
  if (yearBuilt < 1945) return { ratio: 0.20, confidence: "low" };
  if (yearBuilt < 1960) return { ratio: 0.22, confidence: "low" };
  if (yearBuilt < 1970) return { ratio: 0.25, confidence: "low" };
  if (yearBuilt < 1980) return { ratio: 0.28, confidence: "low" };
  if (yearBuilt < 1990) return { ratio: 0.30, confidence: "low" };
  if (yearBuilt < 2000) return { ratio: 0.32, confidence: "low" };
  if (yearBuilt < 2010) return { ratio: 0.35, confidence: "low" };
  return { ratio: 0.40, confidence: "low" };
}

/**
 * Get window data for a property — lazy compute with cache.
 *
 * Priority:
 * 1. EIZ certificate (if building has one) — most accurate
 * 2. DB cache (if fresh enough)
 * 3. Mapillary ML (compute + cache)
 * 4. Statistical prior (fallback, always available)
 */
export async function getWindowData(params: {
  propertyId: string; // eidDelStavbe or similar
  lat: number;
  lng: number;
  yearBuilt?: number | null;
  eizWindowRatio?: number | null; // from energy certificate if available
}): Promise<WindowData> {
  const { propertyId, lat, lng, yearBuilt, eizWindowRatio } = params;

  // 1. EIZ measured — best source
  if (eizWindowRatio != null && eizWindowRatio > 0) {
    return {
      windowRatio: eizWindowRatio,
      source: "eiz_measured",
      confidence: "high",
      computedAt: new Date(),
    };
  }

  // 2. Check DB cache
  try {
    const cached = await (prisma as any).$queryRaw<Array<{
      window_ratio: number;
      source: string;
      confidence: string;
      computed_at: Date;
    }>>`
      SELECT window_ratio, source, confidence, computed_at
      FROM window_cache
      WHERE property_id = ${propertyId}
        AND computed_at > NOW() - INTERVAL '${CACHE_TTL_DAYS} days'
      LIMIT 1
    `;

    if (cached.length > 0) {
      const c = cached[0];
      return {
        windowRatio: c.window_ratio,
        source: c.source as WindowData["source"],
        confidence: c.confidence as WindowData["confidence"],
        computedAt: c.computed_at,
      };
    }
  } catch {
    // Table might not exist yet — continue
  }

  // 3. Mapillary ML — try real measurement
  let result: WindowData | null = null;

  try {
    const images = await fetchNearbyImages(lat, lng, 20, 6);
    if (images.length > 0) {
      const urls = images.map((i) => i.thumbUrl);
      const detection = await estimateWindowRatio(urls);

      if (detection) {
        result = {
          windowRatio: detection.windowRatio,
          source: "mapillary_ml",
          confidence: detection.confidence,
          computedAt: new Date(),
        };
      }
    }
  } catch (e) {
    console.error("[window-cache] Mapillary/ML error", e);
  }

  // 4. Fallback: statistical prior
  if (!result) {
    const stat = statisticalWindowRatio(yearBuilt);
    result = {
      windowRatio: stat.ratio,
      source: "statistical",
      confidence: stat.confidence,
      computedAt: new Date(),
    };
  }

  // Store in cache (fire-and-forget)
  try {
    await (prisma as any).$executeRaw`
      INSERT INTO window_cache (property_id, window_ratio, source, confidence, computed_at)
      VALUES (${propertyId}, ${result.windowRatio}, ${result.source}, ${result.confidence}, NOW())
      ON CONFLICT (property_id) DO UPDATE
        SET window_ratio = EXCLUDED.window_ratio,
            source = EXCLUDED.source,
            confidence = EXCLUDED.confidence,
            computed_at = EXCLUDED.computed_at
    `;
  } catch {
    // Non-fatal — cache write failure doesn't break the request
  }

  return result;
}
