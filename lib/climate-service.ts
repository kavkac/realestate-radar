/**
 * Climate service for EIZ estimation
 *
 * Sources:
 *   1. Open-Meteo Archive API (ERA5 reanalysis) — HDD per coordinate, free, no key
 *   2. ARSO klimatski atlas 1991-2020 + JRC PVGIS — solar irradiation per zone
 *   3. DB cache per ~5km grid cell (climate changes slowly)
 *
 * Replaces the hardcoded 8-municipality table in eiz-estimator.ts
 */

import { prisma } from "./prisma";

export interface ClimateData {
  hdd: number;               // Heating Degree Days (base 18°C) [K·days/a]
  heatingSeasonMonths: number; // months with mean temp < 15°C
  teDesign: number;          // design outdoor temp [°C] (coldest period)
  // Solar irradiation [kWh/(m²·a)] on vertical surfaces
  solarSouth: number;
  solarNorth: number;
  solarEastWest: number;
  solarHorizontal: number;
  // Classification
  climateZone: "primorska" | "osrednja" | "alpska" | "panonska";
  source: "open_meteo" | "arso_table" | "cache";
}

// ─── ARSO climate zones — solar irradiation [kWh/(m²·a)] ─────────────────────
// Source: ARSO klimatski atlas 1991-2020 + JRC PVGIS regional averages
// Vertical surfaces, unshaded, SLO conditions
const SOLAR_BY_ZONE: Record<string, {
  south: number; north: number; eastWest: number; horizontal: number;
}> = {
  primorska: { south: 750, north: 200, eastWest: 450, horizontal: 1350 },
  osrednja:  { south: 680, north: 175, eastWest: 400, horizontal: 1150 },
  alpska:    { south: 640, north: 160, eastWest: 375, horizontal: 1050 },
  panonska:  { south: 710, north: 185, eastWest: 420, horizontal: 1200 },
};

// Classify climate zone by coordinates
function classifyZone(lat: number, lng: number): ClimateData["climateZone"] {
  // Primorska: west of Postojna, below Nanos
  if (lng < 14.3 && lat < 46.1) return "primorska";
  // Panonska: east of Celje, below Pohorje
  if (lng > 15.5 && lat < 46.6) return "panonska";
  // Alpska: high altitude or north (Gorenjska, Koroška)
  if (lat > 46.35 || (lng < 14.5 && lat > 46.0)) return "alpska";
  return "osrednja";
}

// ─── Open-Meteo HDD calculation ──────────────────────────────────────────────
const OPEN_METEO_YEARS = { start: "2014-01-01", end: "2023-12-31" }; // 10y average

async function fetchHddFromOpenMeteo(lat: number, lng: number): Promise<{
  hdd: number;
  teDesign: number;
  heatingSeasonMonths: number;
} | null> {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("start_date", OPEN_METEO_YEARS.start);
  url.searchParams.set("end_date", OPEN_METEO_YEARS.end);
  url.searchParams.set("daily", "temperature_2m_mean,temperature_2m_min");
  url.searchParams.set("timezone", "Europe/Ljubljana");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const json = await res.json();

    const temps: number[] = json.daily?.temperature_2m_mean ?? [];
    const minTemps: number[] = json.daily?.temperature_2m_min ?? [];

    if (!temps.length) return null;

    // HDD base 18°C — annual average over 10 years
    const totalHdd = temps.reduce((sum, t) => sum + Math.max(0, 18 - t), 0);
    const hdd = Math.round(totalHdd / 10); // per year

    // Design temperature: 2nd percentile of daily minimums (EN 12831 approach)
    const sortedMins = [...minTemps].filter(t => t != null).sort((a, b) => a - b);
    const teDesign = Math.round(sortedMins[Math.floor(sortedMins.length * 0.02)] ?? -13);

    // Heating season: months with mean temp < 15°C (annual average)
    const monthlyMeans: number[] = Array(12).fill(0);
    const monthlyCounts: number[] = Array(12).fill(0);
    json.daily?.time?.forEach((dateStr: string, i: number) => {
      const month = new Date(dateStr).getMonth();
      if (temps[i] != null) {
        monthlyMeans[month] += temps[i];
        monthlyCounts[month]++;
      }
    });
    const heatingSeasonMonths = monthlyMeans.filter(
      (sum, i) => monthlyCounts[i] > 0 && (sum / monthlyCounts[i]) < 15
    ).length;

    return { hdd, teDesign, heatingSeasonMonths };
  } catch (e) {
    console.error("[climate-service] Open-Meteo error", e);
    return null;
  }
}

// ─── DB cache ─────────────────────────────────────────────────────────────────
// Cache key: round to ~5km grid (2 decimal places)
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

const CACHE_TTL_DAYS = 365; // climate normals change rarely

// ─── Main API ─────────────────────────────────────────────────────────────────
export async function getClimate(lat: number, lng: number): Promise<ClimateData> {
  const key = cacheKey(lat, lng);

  // 1. Check DB cache
  try {
    const cached = await (prisma as any).$queryRaw<Array<{
      data: ClimateData; cached_at: Date;
    }>>`
      SELECT data, cached_at FROM climate_cache
      WHERE cache_key = ${key}
        AND cached_at > NOW() - INTERVAL '${CACHE_TTL_DAYS} days'
      LIMIT 1
    `;
    if (cached.length > 0) {
      return { ...cached[0].data, source: "cache" };
    }
  } catch {
    // Table might not exist — continue
  }

  // 2. Classify zone (instant, no API)
  const zone = classifyZone(lat, lng);
  const solar = SOLAR_BY_ZONE[zone];

  // 3. Fetch HDD from Open-Meteo
  const openMeteo = await fetchHddFromOpenMeteo(lat, lng);

  // 4. Fallback ARSO table values if Open-Meteo fails
  const FALLBACK_BY_ZONE: Record<string, { hdd: number; teDesign: number; months: number }> = {
    primorska: { hdd: 1700, teDesign: -3,  months: 6 },
    osrednja:  { hdd: 2850, teDesign: -13, months: 7 },
    alpska:    { hdd: 3300, teDesign: -18, months: 8 },
    panonska:  { hdd: 3000, teDesign: -15, months: 7 },
  };

  const tempData = openMeteo ?? {
    hdd: FALLBACK_BY_ZONE[zone].hdd,
    teDesign: FALLBACK_BY_ZONE[zone].teDesign,
    heatingSeasonMonths: FALLBACK_BY_ZONE[zone].months,
  };

  const result: ClimateData = {
    hdd: tempData.hdd,
    heatingSeasonMonths: tempData.heatingSeasonMonths,
    teDesign: tempData.teDesign,
    solarSouth: solar.south,
    solarNorth: solar.north,
    solarEastWest: solar.eastWest,
    solarHorizontal: solar.horizontal,
    climateZone: zone,
    source: openMeteo ? "open_meteo" : "arso_table",
  };

  // 5. Cache result
  try {
    await (prisma as any).$executeRaw`
      INSERT INTO climate_cache (cache_key, lat, lng, data, cached_at)
      VALUES (${key}, ${lat}, ${lng}, ${JSON.stringify(result)}::jsonb, NOW())
      ON CONFLICT (cache_key) DO UPDATE
        SET data = EXCLUDED.data, cached_at = EXCLUDED.cached_at
    `;
  } catch {
    // Non-fatal
  }

  return result;
}
