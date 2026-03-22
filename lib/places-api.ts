/**
 * Places API — dostopnost do storitev v bližini
 *
 * Source prioritete (dokumentirane v source_meta):
 * ┌─────────────────┬──────────────┬────────────────────────────────────┐
 * │ Kategorija      │ Primarni vir │ Razlog                             │
 * ├─────────────────┼──────────────┼────────────────────────────────────┤
 * │ Javni prevoz    │ HERE Places  │ LPP bus data v OSM nepopoln        │
 * │ Supermarketi    │ OSM Overpass │ OSM odlično pokriva SLO            │
 * │ Lekarne         │ OSM Overpass │ OSM odlično pokriva SLO            │
 * │ Šole/vrtci      │ OSM Overpass │ OSM odlično pokriva SLO            │
 * │ Parki           │ OSM Overpass │ OSM odlično pokriva SLO            │
 * │ Banke           │ OSM Overpass │ OSM odlično pokriva SLO            │
 * │ Pošte           │ OSM Overpass │ OSM odlično pokriva SLO            │
 * │ Zdravniki       │ OSM Overpass │ OSM pokriva večino ordinacij       │
 * │ Restavracije    │ HERE Places  │ HERE bolj popolno za gostinstvo    │
 * └─────────────────┴──────────────┴────────────────────────────────────┘
 *
 * Cache strategija:
 * L1: in-memory (1h) — najhitrejše
 * L2: DB places_cache (30 dni) — preživi restarte, deljeno med instancemi
 * L3: HERE API klic — samo če ni v L1/L2 ali je transit brez OSM podatkov
 *
 * Bulk pre-populacija: scripts/overpass-bulk-import.ts
 */

import { prisma } from "@/lib/prisma";

const HERE_API_KEY = process.env.HERE_API_KEY ?? "";
const RADIUS_TRANSIT = 500;
const RADIUS_SERVICES = 500;
const DB_CACHE_DAYS = 30;
const MEM_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export interface TransitInfo {
  busStops: number;
  tramStops: number;
  trainStations: number;
  nearestBusM: number | null;
  nearestTrainM: number | null;
  kvaliteta: "odlicna" | "dobra" | "srednja" | "slaba";
  opis: string;
  source: "here" | "osm" | "unknown";
}

export interface ServicesInfo {
  supermarkets: number;
  nearestSupermarketM: number | null;
  pharmacies: number;
  nearestPharmacyM: number | null;
  schools: number;
  kindergartens: number;
  parks: number;
  nearestParkM: number | null;
  banks: number;
  postOffices: number;
  restaurants: number;
  doctors: number;
  hospitals: number;
  source: "osm" | "here" | "mixed";
}

export interface PlacesData {
  transit: TransitInfo;
  services: ServicesInfo;
  cached?: boolean;
}

// HERE Category IDs za javni prevoz
const HERE_TRANSIT_CATEGORIES = [
  "800-4100-0000", // transit access (bus stop)
  "800-4100-0244", // bus stop
  "800-4100-0236", // rail station
  "800-4100-0232", // tram stop
];

// ─── In-memory L1 cache ──────────────────────────────────────────────────────

const memCache = new Map<string, { data: PlacesData; ts: number }>();

function gridKey(lat: number, lng: number) {
  return {
    latGrid: Math.round(lat * 1000) / 1000,
    lngGrid: Math.round(lng * 1000) / 1000,
  };
}

// ─── DB L2 cache ─────────────────────────────────────────────────────────────

async function dbGet(latGrid: number, lngGrid: number): Promise<PlacesData | null> {
  try {
    type Row = { data: unknown; fetched_at: Date };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT data, fetched_at FROM places_cache WHERE lat_grid = $1 AND lng_grid = $2 LIMIT 1`,
      latGrid, lngGrid
    );
    if (!rows.length) return null;
    const row = rows[0];
    const ageMs = Date.now() - new Date(row.fetched_at).getTime();
    if (ageMs > DB_CACHE_DAYS * 24 * 60 * 60 * 1000) return null;
    return row.data as PlacesData;
  } catch { return null; }
}

async function dbSet(latGrid: number, lngGrid: number, data: PlacesData, sourceMeta: object): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO places_cache (lat_grid, lng_grid, data, source_meta, fetched_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW())
       ON CONFLICT (lat_grid, lng_grid)
       DO UPDATE SET data = EXCLUDED.data, source_meta = EXCLUDED.source_meta, fetched_at = NOW()`,
      latGrid, lngGrid, JSON.stringify(data), JSON.stringify(sourceMeta)
    );
  } catch { /* non-critical */ }
}

// ─── HERE Places API ─────────────────────────────────────────────────────────

interface HerePlace {
  position: { lat: number; lng: number };
  categories: Array<{ id: string }>;
  distance: number;
}

async function hereBrowse(
  lat: number,
  lng: number,
  categories: string[],
  radius: number
): Promise<HerePlace[]> {
  if (!HERE_API_KEY) return [];
  const url = new URL("https://browse.search.hereapi.com/v1/browse");
  url.searchParams.set("at", `${lat},${lng}`);
  url.searchParams.set("circle", `${lat},${lng};r=${radius}`);
  url.searchParams.set("categories", categories.join(","));
  url.searchParams.set("limit", "50");
  url.searchParams.set("apiKey", HERE_API_KEY);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json() as { items?: HerePlace[] };
  return data.items ?? [];
}

function hereBuildTransit(places: HerePlace[], lat: number, lng: number): TransitInfo {
  const busStops = places.filter(p => p.categories.some(c =>
    c.id === "800-4100-0244" || c.id === "800-4100-0000"
  ));
  const tramStops = places.filter(p => p.categories.some(c => c.id === "800-4100-0232"));
  const trainStations = places.filter(p => p.categories.some(c => c.id === "800-4100-0236"));

  const nearestBus = busStops.length ? Math.round(Math.min(...busStops.map(p => p.distance))) : null;
  const nearestTrain = trainStations.length ? Math.round(Math.min(...trainStations.map(p => p.distance))) : null;

  const total = busStops.length + tramStops.length * 2 + trainStations.length * 3;
  let kvaliteta: TransitInfo["kvaliteta"];
  let opis: string;

  if (total >= 8 || (nearestBus != null && nearestBus < 100)) {
    kvaliteta = "odlicna";
    opis = [
      busStops.length > 0 ? `${busStops.length} bus` : null,
      tramStops.length > 0 ? `${tramStops.length} tram` : null,
      trainStations.length > 0 ? `${trainStations.length} vlak` : null,
    ].filter(Boolean).join(" + ") + " postajališč v 500m";
  } else if (total >= 3) {
    kvaliteta = "dobra";
    opis = [
      busStops.length > 0 ? `${busStops.length} bus` : null,
      tramStops.length > 0 ? `${tramStops.length} tram` : null,
    ].filter(Boolean).join(" + ") + " postajališč v 500m";
  } else if (total >= 1) {
    kvaliteta = "srednja";
    opis = nearestBus != null ? `Najbližja postaja ${nearestBus}m` : "Javni prevoz dosegljiv";
  } else {
    kvaliteta = "slaba";
    opis = "Ni javnega prevoza v 500m";
  }

  void lat; void lng; // used via distance field on HerePlace
  return { busStops: busStops.length, tramStops: tramStops.length, trainStations: trainStations.length, nearestBusM: nearestBus, nearestTrainM: nearestTrain, kvaliteta, opis, source: "here" };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function getPlacesData(lat: number, lng: number): Promise<PlacesData | null> {
  const { latGrid, lngGrid } = gridKey(lat, lng);
  const memKey = `${latGrid},${lngGrid}`;

  // L1: memory
  const memHit = memCache.get(memKey);
  if (memHit && Date.now() - memHit.ts < MEM_CACHE_TTL_MS) {
    return { ...memHit.data, cached: true };
  }

  // L2: DB cache
  const dbHit = await dbGet(latGrid, lngGrid);
  if (dbHit) {
    // Preveri če transit podatki izvirajo iz OSM (low confidence) in je HERE key na voljo
    const needsTransitOverride = dbHit.transit?.source !== "here" && !!HERE_API_KEY;
    if (!needsTransitOverride) {
      memCache.set(memKey, { data: dbHit, ts: Date.now() });
      return { ...dbHit, cached: true };
    }
    // Enrichment: OSM storitve + HERE transit
    try {
      const herePlaces = await hereBrowse(lat, lng, HERE_TRANSIT_CATEGORIES, RADIUS_TRANSIT);
      if (herePlaces.length > 0) {
        const enriched: PlacesData = {
          ...dbHit,
          transit: hereBuildTransit(herePlaces, lat, lng),
        };
        const sourceMeta = {
          version: 2,
          importedAt: new Date().toISOString(),
          categories: {
            transit: { source: "here_places", confidence: "high", note: "HERE transit data" },
            services: { source: "osm_overpass", confidence: "high", note: "OSM bulk import" },
          },
        };
        void dbSet(latGrid, lngGrid, enriched, sourceMeta);
        memCache.set(memKey, { data: enriched, ts: Date.now() });
        return { ...enriched, cached: false };
      }
    } catch { /* fallback to OSM transit */ }
    memCache.set(memKey, { data: dbHit, ts: Date.now() });
    return { ...dbHit, cached: true };
  }

  // L3: Live fetch (brez DB cache — HERE za transit, OSM za storitve)
  // To se zgodi samo za lokacije ki še niso v DB (pred bulk importom)
  if (!HERE_API_KEY) return null;

  try {
    const herePlaces = await hereBrowse(lat, lng, HERE_TRANSIT_CATEGORIES, RADIUS_TRANSIT);
    const transit = hereBuildTransit(herePlaces, lat, lng);

    // Osnovna services struktura (bo enrichana z Overpass bulk importom)
    const services: ServicesInfo = {
      supermarkets: 0, nearestSupermarketM: null,
      pharmacies: 0, nearestPharmacyM: null,
      schools: 0, kindergartens: 0,
      parks: 0, nearestParkM: null,
      banks: 0, postOffices: 0, restaurants: 0, doctors: 0, hospitals: 0,
      source: "here",
    };

    const result: PlacesData = { transit, services };
    const sourceMeta = {
      version: 1,
      importedAt: new Date().toISOString(),
      categories: {
        transit: { source: "here_places", confidence: "high" },
        services: { source: "none", confidence: "none", note: "Čaka na OSM bulk import" },
      },
    };
    void dbSet(latGrid, lngGrid, result, sourceMeta);
    memCache.set(memKey, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.error("Places API error:", err);
    return null;
  }
}
