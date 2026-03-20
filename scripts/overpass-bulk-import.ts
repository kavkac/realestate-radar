/**
 * Overpass Bulk Import — POI podatki za celo Slovenijo
 *
 * Strategija: En velik Overpass query za vso SLO → lokalni spatial index →
 * agregacija po 100m grid celicah → upsert v places_cache.
 *
 * Source prioritete po kategoriji:
 * ┌─────────────────┬─────────┬──────┬────────────────────────────────┐
 * │ Kategorija      │ Primarni│ Bkp  │ Razlog                         │
 * ├─────────────────┼─────────┼──────┼────────────────────────────────┤
 * │ Javni prevoz    │ HERE    │ OSM  │ LPP bus data v OSM nepopoln    │
 * │ Supermarketi    │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Lekarne         │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Šole/vrtci      │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Parki           │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Banke/ATM       │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Pošte           │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Zdravniki       │ OSM     │ HERE │ OSM odlično pokritje v SLO     │
 * │ Restavracije    │ HERE    │ OSM  │ HERE bolj popolno za gostinstvo│
 * └─────────────────┴─────────┴──────┴────────────────────────────────┘
 *
 * Poganjanje:
 *   npx tsx scripts/overpass-bulk-import.ts
 *
 * Čas: ~5-15 min za celo SLO (Overpass timeout 300s)
 */

import { Pool } from "pg";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RADIUS_M = 500; // agregacijski radij
const TRANSIT_RADIUS_M = 600;
const GRID_STEP = 0.001; // ~100m

// SLO bounding box
const SLO_BBOX = "45.4,13.3,46.9,16.6";

interface OsmNode {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

interface GridCell {
  latGrid: number;
  lngGrid: number;
  pois: OsmNode[];
}

// Haversine razdalja v metrih
function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nodeCoords(n: OsmNode): { lat: number; lon: number } | null {
  if (n.lat != null && n.lon != null) return { lat: n.lat, lon: n.lon };
  if (n.center) return n.center;
  return null;
}

// Overpass QL query — vse relevantne kategorije naenkrat za celo SLO
function buildQuery(): string {
  return `
[out:json][timeout:300][bbox:${SLO_BBOX}];
(
  node["amenity"="supermarket"];
  node["amenity"="convenience"]["shop"="convenience"];
  node["shop"="supermarket"];
  node["shop"="convenience"];
  node["amenity"="pharmacy"];
  node["amenity"="school"];
  node["amenity"="kindergarten"];
  node["amenity"="bank"];
  node["amenity"="atm"];
  node["amenity"="post_office"];
  node["amenity"="doctors"];
  node["amenity"="clinic"];
  node["amenity"="hospital"];
  node["amenity"="restaurant"];
  node["amenity"="cafe"];
  node["highway"="bus_stop"];
  node["public_transport"="stop_position"]["bus"="yes"];
  node["railway"="station"];
  node["railway"="halt"];
  node["amenity"="bus_station"];
  way["leisure"="park"];
  node["leisure"="park"];
  way["landuse"="recreation_ground"];
);
out center;
`.trim();
}

// Klasifikacija OSM node-a
function classifyNode(n: OsmNode): string | null {
  const tags = n.tags ?? {};
  const a = tags.amenity ?? "";
  const shop = tags.shop ?? "";
  const hw = tags.highway ?? "";
  const pt = tags.public_transport ?? "";
  const rail = tags.railway ?? "";
  const leisure = tags.leisure ?? "";
  const landuse = tags.landuse ?? "";

  if (a === "supermarket" || shop === "supermarket") return "supermarket";
  if (shop === "convenience" || a === "convenience") return "supermarket"; // šteje kot manjša trgovina
  if (a === "pharmacy") return "pharmacy";
  if (a === "school") return "school";
  if (a === "kindergarten") return "kindergarten";
  if (a === "bank" || a === "atm") return "bank";
  if (a === "post_office") return "post_office";
  if (a === "doctors" || a === "clinic") return "doctor";
  if (a === "hospital") return "hospital";
  if (a === "restaurant" || a === "cafe") return "restaurant";
  if (hw === "bus_stop" || a === "bus_station" || (pt === "stop_position" && tags.bus === "yes")) return "bus_stop";
  if (rail === "station" || rail === "halt") return "train_station";
  if (leisure === "park" || landuse === "recreation_ground") return "park";
  return null;
}

// Agregacija POI-jev v radiju za eno grid celico
function aggregatePois(
  centerLat: number,
  centerLon: number,
  allPois: OsmNode[],
  radius: number
): Record<string, OsmNode[]> {
  const groups: Record<string, OsmNode[]> = {};
  for (const poi of allPois) {
    const coords = nodeCoords(poi);
    if (!coords) continue;
    const d = distM(centerLat, centerLon, coords.lat, coords.lon);
    if (d > radius) continue;
    const cat = classifyNode(poi);
    if (!cat) continue;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(poi);
  }
  return groups;
}

function nearestDist(
  pois: OsmNode[],
  centerLat: number,
  centerLon: number
): number | null {
  if (!pois?.length) return null;
  return Math.round(
    Math.min(
      ...pois.map((p) => {
        const c = nodeCoords(p);
        return c ? distM(centerLat, centerLon, c.lat, c.lon) : Infinity;
      })
    )
  );
}

function buildPlacesData(
  centerLat: number,
  centerLon: number,
  allPois: OsmNode[]
): object {
  const cats = aggregatePois(centerLat, centerLon, allPois, TRANSIT_RADIUS_M);
  const catsSvc = aggregatePois(centerLat, centerLon, allPois, RADIUS_M);

  const busStops = cats.bus_stop ?? [];
  const trainStations = cats.train_station ?? [];

  const totalTransit = busStops.length + trainStations.length * 3;
  let kvaliteta: string;
  let opis: string;
  const nearestBus = nearestDist(busStops, centerLat, centerLon);
  const nearestTrain = nearestDist(trainStations, centerLat, centerLon);

  if (totalTransit >= 6 || (nearestBus != null && nearestBus < 80)) {
    kvaliteta = "odlicna";
    opis = `${busStops.length} bus${trainStations.length > 0 ? ` + ${trainStations.length} vlak` : ""} postaj v 600m`;
  } else if (totalTransit >= 2) {
    kvaliteta = "dobra";
    opis = `${busStops.length} bus postaj v 600m`;
  } else if (totalTransit >= 1) {
    kvaliteta = "srednja";
    opis = nearestBus != null ? `Najbližja postaja ${nearestBus}m` : "Javni prevoz dosegljiv";
  } else {
    kvaliteta = "slaba";
    opis = "Ni javnega prevoza v 600m";
  }

  const supermarkets = catsSvc.supermarket ?? [];
  const pharmacies = catsSvc.pharmacy ?? [];
  const schools = catsSvc.school ?? [];
  const kindergartens = catsSvc.kindergarten ?? [];
  const parks = catsSvc.park ?? [];
  const banks = catsSvc.bank ?? [];
  const postOffices = catsSvc.post_office ?? [];
  const doctors = catsSvc.doctor ?? [];
  const restaurants = catsSvc.restaurant ?? [];
  const hospitals = catsSvc.hospital ?? [];

  return {
    transit: {
      busStops: busStops.length,
      tramStops: 0, // OSM tram data ni zanesljiv v SLO
      trainStations: trainStations.length,
      nearestBusM: nearestBus,
      nearestTrainM: nearestTrain,
      kvaliteta,
      opis,
    },
    services: {
      supermarkets: supermarkets.length,
      nearestSupermarketM: nearestDist(supermarkets, centerLat, centerLon),
      pharmacies: pharmacies.length,
      nearestPharmacyM: nearestDist(pharmacies, centerLat, centerLon),
      schools: schools.length,
      kindergartens: kindergartens.length,
      parks: parks.length,
      nearestParkM: nearestDist(parks, centerLat, centerLon),
      banks: banks.length,
      postOffices: postOffices.length,
      restaurants: restaurants.length,
      doctors: doctors.length,
      hospitals: hospitals.length,
    },
  };
}

// Source meta — za vsako kategorijo beležimo vir in zaupanje
function buildSourceMeta(): object {
  return {
    version: 1,
    importedAt: new Date().toISOString(),
    categories: {
      supermarkets:  { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO trgovine" },
      pharmacies:    { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO lekarne" },
      schools:       { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO šole" },
      kindergartens: { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO vrtce" },
      parks:         { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO parke" },
      banks:         { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO banke" },
      postOffices:   { source: "osm_overpass", confidence: "high",   note: "OSM odlično pokriva SLO pošte" },
      doctors:       { source: "osm_overpass", confidence: "medium", note: "OSM pokriva večino, zasebni ordinariat morda manjkajo" },
      restaurants:   { source: "osm_overpass", confidence: "medium", note: "OSM dobro, HERE boljši za gostinstvo" },
      transit: {
        source: "osm_overpass",
        confidence: "low",
        note: "LPP bus stop data v OSM nepopoln — priporočamo HERE Transit za SLO transit",
        recommendedOverride: "here_places",
      },
    },
  };
}

async function downloadOverpassData(): Promise<OsmNode[]> {
  console.log("📡 Downloaing Overpass data za celo Slovenijo...");
  const query = buildQuery();
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = (await res.json()) as { elements: OsmNode[] };
  console.log(`✅ Pridobljenih ${data.elements.length} POI elementov`);
  return data.elements;
}

async function getUniqueGridCells(pool: Pool): Promise<Array<{ lat: number; lon: number }>> {
  // Pridobi unikatne koordinate stavb iz ev_stavba (100m grid)
  console.log("📊 Pridobivam unikatne grid celice iz ev_stavba...");
  const result = await pool.query(`
    SELECT
      ROUND(("Y_WGS84")::numeric, 3) AS lat_grid,
      ROUND(("X_WGS84")::numeric, 3) AS lng_grid,
      COUNT(*) AS stavbe
    FROM ev_stavba
    WHERE "Y_WGS84" IS NOT NULL AND "X_WGS84" IS NOT NULL
      AND "Y_WGS84" BETWEEN 45.4 AND 46.9
      AND "X_WGS84" BETWEEN 13.3 AND 16.6
    GROUP BY lat_grid, lng_grid
    ORDER BY stavbe DESC
  `);
  console.log(`✅ ${result.rows.length} unikatnih grid celic`);
  return result.rows.map((r) => ({ lat: Number(r.lat_grid), lon: Number(r.lng_grid) }));
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const sourceMeta = buildSourceMeta();

  try {
    // 1. Prenesi vse OSM POI-je za SLO
    const pois = await downloadOverpassData();

    // 2. Pridobi grid celice iz ev_stavba
    const cells = await getUniqueGridCells(pool);
    console.log(`\n🔄 Agregiram ${cells.length} celic...`);

    // 3. Batch processing
    const BATCH_SIZE = 500;
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < cells.length; i += BATCH_SIZE) {
      const batch = cells.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      for (const cell of batch) {
        const placesData = buildPlacesData(cell.lat, cell.lon, pois);
        values.push(`($${pi++}, $${pi++}, $${pi++}::jsonb, $${pi++}::jsonb, NOW())`);
        params.push(cell.lat, cell.lon, JSON.stringify(placesData), JSON.stringify(sourceMeta));
      }

      await pool.query(
        `INSERT INTO places_cache (lat_grid, lng_grid, data, source_meta, fetched_at)
         VALUES ${values.join(",")}
         ON CONFLICT (lat_grid, lng_grid)
         DO UPDATE SET
           data = EXCLUDED.data,
           source_meta = EXCLUDED.source_meta,
           fetched_at = EXCLUDED.fetched_at`,
        params
      );

      processed += batch.length;
      if (processed % 5000 === 0 || processed === cells.length) {
        console.log(`  ✅ ${processed}/${cells.length} celic (${skipped} brez POI-jev)`);
      }
    }

    // 4. Statistika
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total_cells,
        COUNT(*) FILTER (WHERE (data->'services'->>'supermarkets')::int > 0) AS cells_with_supermarket,
        COUNT(*) FILTER (WHERE (data->'transit'->>'busStops')::int > 0) AS cells_with_bus,
        COUNT(*) FILTER (WHERE (data->'services'->>'schools')::int > 0) AS cells_with_school
      FROM places_cache
    `);
    const s = stats.rows[0];
    console.log(`\n📈 Rezultati v places_cache:`);
    console.log(`   Skupaj celic: ${s.total_cells}`);
    console.log(`   S supermarketom (500m): ${s.cells_with_supermarket}`);
    console.log(`   Z bus postajo (600m): ${s.cells_with_bus}`);
    console.log(`   S šolo (500m): ${s.cells_with_school}`);
    console.log(`\n⚠️  Transit podatki iz OSM — priporočamo override z HERE Places za transit.\n`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
