/**
 * LPP Bus Lines via Overpass API Relations
 *
 * Fetches unique bus line count for a location by querying OSM relations.
 * This gives us "number of different bus lines" rather than just "number of stops".
 *
 * Query strategy:
 * 1. Find all bus stops in a 500m bounding box
 * 2. Get route relations for those stops
 * 3. Extract unique route refs (line numbers)
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RADIUS_M = 500;

// In-memory cache (24h TTL)
const cache = new Map<string, { data: LppLinesResult; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface LppLinesResult {
  lineCount: number;
  lines: string[];
  source: "overpass";
}

function gridKey(lat: number, lng: number): string {
  const latGrid = Math.round(lat * 1000) / 1000;
  const lngGrid = Math.round(lng * 1000) / 1000;
  return `${latGrid},${lngGrid}`;
}

// Haversine bounding box — točen krog, ne kvadrat
function haversineBbox(lat: number, lng: number, radiusM: number) {
  const R = 6371000; // Earth radius in meters
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLng = (radiusM / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}

export async function getLppLineCount(
  lat: number,
  lng: number
): Promise<LppLinesResult | null> {
  const key = gridKey(lat, lng);

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  // Haversine bounding box (točen krog, ne kvadrat)
  const { south, west, north, east } = haversineBbox(lat, lng, RADIUS_M);
  const bbox = `${south},${west},${north},${east}`;

  const query = `
[out:json][timeout:20];
node["highway"="bus_stop"](${bbox});
rel(bn)["type"="route"]["route"="bus"];
out tags;
`.trim();

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "RealEstateRadar/1.0 research@realestate-radar.si",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      console.warn(`Overpass API returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      elements: Array<{ tags?: Record<string, string> }>;
    };

    // Extract unique line refs
    const lines = Array.from(
      new Set(
        data.elements
          .map((e) => e.tags?.ref)
          .filter((ref): ref is string => Boolean(ref))
      )
    ).sort((a, b) => {
      // Sort numerically where possible
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    const result: LppLinesResult = {
      lineCount: lines.length,
      lines,
      source: "overpass",
    };

    // Cache result
    cache.set(key, { data: result, ts: Date.now() });

    return result;
  } catch (err) {
    console.error("Overpass API error:", err);
    return null;
  }
}
