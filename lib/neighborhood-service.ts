/**
 * neighborhood-service.ts
 *
 * Kompletna analiza soseske za dano koordinato:
 * - OSM Overpass API → POI amenity clustering (šole, univerze, industrija...)
 * - ARSO hrupne karte → Lden (dB) vrednost
 * - ETN cenovni clustering → povp. cena/m² v radiju 500m
 * - SURS census tract → demografija (starost, izobrazba)
 *
 * Lazy compute + 90-day cache v neighborhood_cache tabeli.
 */

import { prisma } from "@/lib/prisma";
import proj4 from "proj4";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";

// D96/TM (EPSG:3794) converter for SIHM500 cell lookup
proj4.defs("EPSG:3794", "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
const wgs84ToD96tm = proj4("WGS84", "EPSG:3794");

/** Fetch soseska/četrt name via OSM is_in */
async function fetchNeighborhoodName(lat: number, lng: number): Promise<string | null> {
  try {
    const q = `[out:json][timeout:8];is_in(${lat},${lng})->.a;area.a["place"~"^(suburb|quarter|neighbourhood|village)$"];out tags;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", body: `data=${encodeURIComponent(q)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.startsWith("{")) return null;
    const data = JSON.parse(text) as { elements: Array<{ tags?: Record<string, string> }> };
    // Vzemi najbolj specifičen (neighbourhood > quarter > suburb)
    const order = ["neighbourhood", "quarter", "suburb"];
    for (const place of order) {
      const el = data.elements.find(e => e.tags?.place === place);
      if (el?.tags?.name) return el.tags.name;
    }
    return data.elements[0]?.tags?.name ?? null;
  } catch { return null; }
}

/** Convert WGS84 lat/lng → nearest grid_demographics row */
async function fetchGridDemographics(lat: number, lng: number): Promise<{
  age_avg: number | null; edct_1: number | null; edct_2: number | null; edct_3: number | null; pop_total: number | null;
} | null> {
  try {
    const [e, n] = wgs84ToD96tm.forward([lng, lat]);
    const cellX = Math.floor(e / 100);
    const cellY = Math.floor(n / 100);
    const cellId = `SIHM500_${cellX}_${cellY}`;
    type Row = { age_avg: number | null; edct_1: number | null; edct_2: number | null; edct_3: number | null; pop_total: number | null };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT age_avg, edct_1, edct_2, edct_3, pop_total FROM grid_demographics WHERE cell_id=$1 LIMIT 1`,
      cellId
    );
    return rows[0] ?? null;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AmenityData {
  r300: AmenityCount;
  r500: AmenityCount;
  r1000: AmenityCount;
}

export interface AmenityCount {
  universities: number;
  schools: number;
  kindergartens: number;
  dormitories: number;
  restaurants: number;
  bars: number;
  supermarkets: number;
  pharmacies: number;
  doctors: number;
  hospitals: number;
  health_centres: number;
  industrial: number;
  banks: number;
  postOffices: number;
  parks: number;
  playgrounds: number;
  sports_centres: number;
  bus_stops: number;
  tram_stops: number;
  train_stations: number;
}

export interface NeighborhoodProfile {
  lat: number;
  lng: number;

  // Hrup
  noiseLdenDb: number | null;
  noiseLabel: "tiho" | "zmerno" | "prometno" | "hrupno" | null;

  // Demografija (SURS grid_demographics)
  statOkolisId: string | null;
  statOkolisName: string | null;
  ageAvg: number | null;
  ageU30Pct: number | null;
  age3065Pct: number | null;
  ageO65Pct: number | null;
  eduTertiaryPct: number | null;
  popTotal: number | null;

  // Amenitiji (OSM)
  amenity: AmenityData | null;

  // Cene
  pricePerM2_500m: number | null;

  // Izpeljano
  characterTags: string[];
  neighborhoodName: string | null;
  neighborhoodType: string | null;
  walkingTargets?: WalkingResult[];
  proximityScore?: number; // -0.15 do +0.20, vrednostni multiplikator
}

// ── Noise label ───────────────────────────────────────────────────────────────
function noiseLabel(lden: number | null): "tiho" | "zmerno" | "prometno" | "hrupno" | null {
  if (lden == null) return null;
  if (lden < 45) return "tiho";
  if (lden < 55) return "zmerno";
  if (lden < 65) return "prometno";
  return "hrupno";
}

// ── OSM Overpass amenity query — en 1km klic, distanca filtrirana v JS ───────
type OsmElement = { type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string,string> };

async function fetchAllAmenities(lat: number, lng: number): Promise<AmenityData> {
  const R = 1000; // en klic za 1km
  // Kompakten query — samo najpomembnejši amenitiji, timeout 12s
  const query = `[out:json][timeout:12];(nwr["amenity"~"^(school|kindergarten|university|college|hospital|clinic|health_centre|pharmacy|restaurant|bar|pub|bank|post_office)$"](around:${R},${lat},${lng});nwr["shop"="supermarket"](around:${R},${lat},${lng});nwr["leisure"~"^(park|sports_centre|fitness_centre)$"](around:${R},${lat},${lng});node["highway"="bus_stop"](around:${R},${lat},${lng});node["railway"~"^(tram_stop|station|halt)$"](around:${R},${lat},${lng});way["landuse"="industrial"](around:${R},${lat},${lng}););out center;`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return emptyAmenityData();
    const text = await res.text();
    if (!text.startsWith("{")) return emptyAmenityData(); // XML error response
    const data = JSON.parse(text) as { elements: OsmElement[] };

    const r300 = emptyCount(), r500 = emptyCount(), r1000 = emptyCount();

    for (const el of data.elements) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;

      // Haversine approx distance in meters
      const dlat = (elLat - lat) * 111195;
      const dlng = (elLon - lng) * Math.cos(lat * Math.PI / 180) * 111195;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);

      const tags = el.tags ?? {};
      const amenity = tags.amenity;
      const building = tags.building;
      const landuse = tags.landuse;
      const leisure = tags.leisure;
      const highway = tags.highway;
      const railway = tags.railway;
      const shop = tags.shop;

      const addTo = (c: AmenityCount) => {
        if (amenity === "university" || amenity === "college") c.universities++;
        else if (building === "dormitory") c.dormitories++;
        else if (amenity === "school") c.schools++;
        else if (amenity === "kindergarten") c.kindergartens++;
        else if (amenity === "restaurant") c.restaurants++;
        else if (amenity === "bar" || amenity === "pub") c.bars++;
        else if (shop === "supermarket") c.supermarkets++;
        else if (amenity === "pharmacy") c.pharmacies++;
        else if (amenity === "hospital") c.hospitals++;
        else if (amenity === "clinic" || amenity === "health_centre") c.health_centres++;
        else if (landuse === "industrial") c.industrial++;
        else if (leisure === "park") c.parks++;
        else if (leisure === "playground") c.playgrounds++;
        else if (leisure === "sports_centre" || leisure === "fitness_centre" || leisure === "swimming_pool") c.sports_centres++;
        else if (amenity === "bank") c.banks++;
        else if (amenity === "post_office") c.postOffices++;
        else if (highway === "bus_stop") c.bus_stops++;
        else if (railway === "tram_stop") c.tram_stops++;
        else if (railway === "station" || railway === "halt") c.train_stations++;
      };

      if (dist <= 300) { addTo(r300); addTo(r500); addTo(r1000); }
      else if (dist <= 500) { addTo(r500); addTo(r1000); }
      else { addTo(r1000); }
    }

    // Deduplikacija bus/tram: vsaka fizična postaja = 2 nodes (obe smeri)
    for (const c of [r300, r500, r1000]) {
      c.bus_stops = Math.ceil(c.bus_stops / 2);
      c.tram_stops = Math.ceil(c.tram_stops / 2);
    }

    return { r300, r500, r1000 };
  } catch {
    return emptyAmenityData();
  }
}

function emptyAmenityData(): AmenityData {
  return { r300: emptyCount(), r500: emptyCount(), r1000: emptyCount() };
}

function emptyCount(): AmenityCount {
  return {
    universities: 0, schools: 0, kindergartens: 0, dormitories: 0,
    restaurants: 0, bars: 0, supermarkets: 0, pharmacies: 0,
    doctors: 0, hospitals: 0, health_centres: 0, industrial: 0,
    banks: 0, postOffices: 0,
    parks: 0, playgrounds: 0, sports_centres: 0,
    bus_stops: 0, tram_stops: 0, train_stations: 0,
  };
}

// ── ARSO noise — DB-first spatial query z turf.js ────────────────────────────
async function fetchNoiseLden(lat: number, lng: number): Promise<number | null> {
  // 1. DB lookup: arso_noise_ldvn tabela — bbox filter + point-in-polygon
  try {
    type NoiseRow = { lden: number; geom_geojson: unknown };
    const candidates = await prisma.$queryRawUnsafe<NoiseRow[]>(
      `SELECT lden, geom_geojson FROM arso_noise_ldvn
       WHERE bbox_xmin <= $1 AND bbox_xmax >= $1
         AND bbox_ymin <= $2 AND bbox_ymax >= $2`,
      lng, lat
    );

    if (candidates.length > 0) {
      const pt = turfPoint([lng, lat]);
      let maxLden: number | null = null;
      for (const row of candidates) {
        try {
          const geojson = (typeof row.geom_geojson === "string"
            ? JSON.parse(row.geom_geojson)
            : row.geom_geojson) as GeoJSON.MultiPolygon | GeoJSON.Polygon;
          if (booleanPointInPolygon(pt, geojson)) {
            if (maxLden === null || row.lden > maxLden) maxLden = row.lden;
          }
        } catch { /* skip malformed geometry */ }
      }
      if (maxLden !== null) return maxLden;
    }
  } catch { /* fallback na ARSO API */ }

  // 2. Fallback: grid_demographics.noise_lden (stari bulk import)
  try {
    const [e, n] = wgs84ToD96tm.forward([lng, lat]);
    const cellX = Math.floor(e / 100);
    const cellY = Math.floor(n / 100);
    const cellId = `SIHM500_${cellX}_${cellY}`;
    type Row = { noise_lden: number | null };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT noise_lden FROM grid_demographics WHERE cell_id=$1 LIMIT 1`, cellId
    );
    const cached = rows[0]?.noise_lden;
    if (cached != null) return cached;
  } catch { /* fallback na ARSO API */ }

  // 3. Fallback: ARSO Atlas Okolja (javni, brez tokena) — strateške karte hrupa 2020
  try {
    const baseUrl = "https://gis.arso.gov.si/arcgis/rest/services/Atlasokolja_javni_D96/MapServer/identify";
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      sr: "4326",
      layers: "all:344,352",
      tolerance: "3",
      mapExtent: `${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}`,
      imageDisplay: "200,200,96",
      returnGeometry: "false",
      f: "json",
    });
    const res = await fetch(`${baseUrl}?${params}`, { signal: AbortSignal.timeout(22000) });
    if (!res.ok) return null;
    const data = await res.json() as { results?: Array<{ layerName: string; attributes: Record<string, string> }> };
    if (!data.results?.length) return null;

    let maxLden: number | null = null;
    for (const r of data.results) {
      if (!r.layerName.includes("LDVN")) continue;
      const ldenVal = parseFloat(r.attributes.LDEN ?? "");
      if (!isNaN(ldenVal)) {
        if (maxLden === null || ldenVal > maxLden) maxLden = ldenVal;
        continue;
      }
      const razred = r.attributes.OBMOCJE ?? r.attributes.HRUP_RAZRED ?? "";
      const match = razred.match(/(\d+)-(\d+)/);
      if (match) {
        const upper = parseInt(match[2]);
        if (maxLden === null || upper > maxLden) maxLden = upper;
      }
    }
    return maxLden;
  } catch {
    return null;
  }
}

// ── ETN price clustering ──────────────────────────────────────────────────────
async function fetchEtnPrice500m(lat: number, lng: number): Promise<number | null> {
  // lat/lng v WGS84 → approx meter offset: 1°lat=111195m, 1°lng=77160m
  const dLat = 500 / 111195;
  const dLng = 500 / 77160;
  try {
    const rows = await prisma.$queryRawUnsafe<{ avg_price: string }[]>(`
      SELECT AVG(cena_m2)::text AS avg_price
      FROM etn_transactions
      WHERE lat BETWEEN ${lat - dLat} AND ${lat + dLat}
        AND lng BETWEEN ${lng - dLng} AND ${lng + dLng}
        AND cena_m2 > 100 AND cena_m2 < 20000
        AND datum_pogodbe > NOW() - INTERVAL '3 years'
    `);
    const val = parseFloat(rows[0]?.avg_price ?? "");
    return isNaN(val) ? null : Math.round(val);
  } catch {
    return null;
  }
}

// ── Character tags derivation ─────────────────────────────────────────────────
function deriveCharacter(
  amenity300: AmenityCount,
  amenity500: AmenityCount,
  noise: number | null,
  ageO65: number | null,
  ageU30: number | null,
  eduTertiaryPct?: number | null,
  ageAvg?: number | null,
): { tags: string[]; type: string } {
  const tags: string[] = [];

  // Šolajoča / mladinska
  // "Študentsko": mora biti res dominantno — fakutete + dormitoriji skupaj
  if (amenity500.universities >= 3 && amenity500.dormitories >= 1) tags.push("🎓 Študentsko");
  else if (amenity500.schools >= 2 && (ageU30 ?? 0) > 30) tags.push("👨‍👩‍👧 Družinsko");

  // Starostna
  if ((ageO65 ?? 0) > 30) tags.push("👴 Upokojensko");

  // Industrija
  if (amenity500.industrial >= 1) tags.push("🏭 Industrijsko");

  // Hrup
  if (noise != null) {
    if (noise < 45) tags.push(`🌿 Tiho območje (${noise.toFixed(0)} dB Lden)`);
    else if (noise >= 65) tags.push(`🚗 Prometno (${noise.toFixed(0)} dB Lden)`);
  }

  // Zeleno
  if (amenity500.parks >= 2 && (noise ?? 99) < 55) tags.push("🌳 Zelena soseska");

  // Gastro/urbano
  if (amenity300.restaurants + amenity300.bars >= 5) tags.push("🍕 Živahno");

  // Zdravstveno — samo če je to resnično dominantna lastnost (ne samo bližina UKC)
  if (amenity500.hospitals >= 2 && amenity500.doctors >= 5) tags.push("🏥 Zdravstveno");

  // Transit
  if (amenity300.tram_stops >= 1) tags.push("🚃 Tramvajska dostopnost");
  else if (amenity300.bus_stops >= 3) tags.push("🚌 Dobra javna pot");

  // Izobrazba / demografija
  if ((eduTertiaryPct ?? 0) > 35) tags.push(`🎓 Izobrazbeno razvito (${eduTertiaryPct!.toFixed(0)}% visoka izobrazba)`);
  if (ageAvg != null && ageAvg < 35) tags.push(`👶 Mlada soseska (povp. starost: ${ageAvg.toFixed(1)} let)`);
  else if (ageAvg != null && ageAvg > 50) tags.push(`🧓 Starejša soseska (povp. starost: ${ageAvg.toFixed(1)} let)`);

  // Primary type
  let type = "mešano";
  if (tags.some(t => t.includes("Študentsko"))) type = "študentsko";
  else if (tags.some(t => t.includes("Industrijsko"))) type = "industrijsko";
  else if (tags.some(t => t.includes("Upokojensko"))) type = "upokojensko";
  else if (tags.some(t => t.includes("Družinsko"))) type = "družinsko";
  else if (tags.some(t => t.includes("Tiho"))) type = "mirno";
  else if (tags.some(t => t.includes("Prometno"))) type = "prometno";

  return { tags, type };
}

// ── Main: get or compute neighborhood profile ─────────────────────────────────
export async function getNeighborhoodProfile(lat: number, lng: number): Promise<NeighborhoodProfile> {
  const latR = Math.round(lat * 1000) / 1000;
  const lngR = Math.round(lng * 1000) / 1000;

  // Cache check
  const cached = await prisma.$queryRawUnsafe<any[]>(`
    SELECT * FROM neighborhood_cache
    WHERE round(lat::numeric, 3) = ${latR} AND round(lng::numeric, 3) = ${lngR}
      AND expires_at > NOW()
    LIMIT 1
  `).catch(() => []);

  if (cached.length > 0) {
    const c = cached[0];
    return {
      lat, lng,
      noiseLdenDb: c.noise_lden_db,
      noiseLabel: c.noise_label,
      statOkolisId: c.stat_okolis_id,
      statOkolisName: c.stat_okolis_name,
      ageAvg: c.age_avg ?? null,
      ageU30Pct: c.age_u30_pct,
      age3065Pct: c.age_3065_pct,
      ageO65Pct: c.age_o65_pct,
      eduTertiaryPct: c.edu_tertiary_pct,
      popTotal: c.pop_total ?? null,
      amenity: c.amenity_data,
      pricePerM2_500m: c.price_per_m2_500m,
      characterTags: c.character_tags ?? [],
      neighborhoodName: c.neighborhood_name ?? null,
      neighborhoodType: c.neighborhood_type,
    };
  }

  // Compute in parallel
  const [noise, amenityData, price, gridDemo] = await Promise.all([
    fetchNoiseLden(lat, lng),
    fetchAllAmenities(lat, lng),
    fetchEtnPrice500m(lat, lng),
    fetchGridDemographics(lat, lng),
  ]);
  const amenity300 = amenityData.r300;
  const amenity500 = amenityData.r500;
  const amenity1000 = amenityData.r1000;

  // neighborhoodName je neblokirajočič — ne vpliva na timeout
  const neighborhoodName = await fetchNeighborhoodName(lat, lng).catch(() => null);

  // SURS grid demographics (500m cell)
  const statOkolisId: string | null = null;
  const statOkolisName: string | null = null;
  // Age buckets — we have avg age but not age distribution; use as proxy
  const ageAvg = gridDemo?.age_avg ?? null;
  const ageU30Pct: number | null = ageAvg != null ? Math.max(0, Math.round(60 - ageAvg)) : null;
  const age3065Pct: number | null = ageAvg != null ? Math.round(Math.min(60, Math.max(20, ageAvg - 5))) : null;
  const ageO65Pct: number | null = ageAvg != null ? Math.max(0, Math.round(ageAvg - 35)) : null;
  const eduTertiaryPct: number | null = gridDemo?.edct_3 ?? null;

  // amenityData je že AmenityData z r300/r500/r1000
  const nLabel = noiseLabel(noise);
  const { tags, type } = deriveCharacter(amenity300, amenity500, noise, ageO65Pct, ageU30Pct, eduTertiaryPct, ageAvg);

  // Cache
  await prisma.$executeRawUnsafe(`
    INSERT INTO neighborhood_cache
      (lat, lng, stat_okolis_id, stat_okolis_name, noise_lden_db, noise_label,
       age_u30_pct, age_3065_pct, age_o65_pct, edu_tertiary_pct,
       amenity_data, character_tags, neighborhood_type, price_per_m2_500m,
       computed_at, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()+INTERVAL '90 days')
    ON CONFLICT DO NOTHING
  `,
    lat, lng,
    statOkolisId, statOkolisName,
    noise, nLabel,
    ageU30Pct, age3065Pct, ageO65Pct, eduTertiaryPct,
    JSON.stringify(amenityData),
    tags, type,
    price,
  ).catch(() => {});

  return {
    lat, lng,
    noiseLdenDb: noise,
    noiseLabel: nLabel,
    statOkolisId,
    statOkolisName,
    ageAvg,
    ageU30Pct,
    age3065Pct,
    ageO65Pct,
    eduTertiaryPct,
    popTotal: gridDemo?.pop_total ?? null,
    amenity: amenityData,
    pricePerM2_500m: price,
    characterTags: tags,
    neighborhoodName,
    neighborhoodType: type,
  };
}

// ── Walking distance via OSRM ─────────────────────────────────────────────────

export interface WalkingTarget {
  name: string;
  lat: number;
  lng: number;
  type: "school" | "kindergarten" | "university" | "hospital" | "bus_stop" | "tram_stop" | "park" | "supermarket";
}

export interface WalkingResult extends WalkingTarget {
  walkMinutes: number | null;
  distanceM: number | null;
}

/** Poišče najbližje POI-je iz OSM in izračuna čas hoje via OSRM */
export async function getNearestWalkingTargets(lat: number, lng: number): Promise<WalkingResult[]> {
  const TYPES: Array<{ type: WalkingTarget["type"]; query: string }> = [
    { type: "kindergarten", query: `node["amenity"="kindergarten"](around:1000,${lat},${lng});` },
    { type: "school",       query: `node["amenity"="school"](around:1000,${lat},${lng});` },
    { type: "university",   query: `node["amenity"="university"](around:2000,${lat},${lng});` },
    { type: "hospital",     query: `node["amenity"="hospital"](around:2000,${lat},${lng});` },
    { type: "bus_stop",     query: `node["highway"="bus_stop"](around:500,${lat},${lng});` },
    { type: "tram_stop",    query: `node["railway"="tram_stop"](around:800,${lat},${lng});` },
    { type: "supermarket",  query: `node["shop"="supermarket"](around:800,${lat},${lng});` },
    { type: "park",         query: `node["leisure"="park"](around:800,${lat},${lng});` },
  ];

  const results: WalkingResult[] = [];

  for (const { type, query } of TYPES) {
    const overpassQ = `[out:json][timeout:6];(${query});out 3;`;
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(overpassQ)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json() as { elements: Array<{ lat: number; lon: number; tags?: Record<string,string> }> };
      
      // Vzami najbližji element
      const nearest = data.elements[0];
      if (!nearest) continue;

      const name = nearest.tags?.name ?? nearest.tags?.["name:sl"] ?? type;
      
      // OSRM walking time
      const osrmUrl = `http://router.project-osrm.org/route/v1/foot/${lng},${lat};${nearest.lon},${nearest.lat}?overview=false`;
      let walkMins: number | null = null;
      let distM: number | null = null;
      try {
        const r2 = await fetch(osrmUrl, { signal: AbortSignal.timeout(5000) });
        if (r2.ok) {
          const rd = await r2.json() as { routes?: Array<{ duration: number; distance: number }> };
          if (rd.routes?.[0]) {
            walkMins = Math.round(rd.routes[0].duration / 60);
            distM = Math.round(rd.routes[0].distance);
          }
        }
      } catch { /* fallback: crow-flies */ }

      results.push({ name, lat: nearest.lat, lng: nearest.lon, type, walkMinutes: walkMins, distanceM: distM });
    } catch { continue; }
  }

  return results;
}

// ── Proximity valuation score ─────────────────────────────────────────────────
/**
 * Izračuna vrednostni bonus/malus iz proximity podatkov.
 * Vrne vrednost med -0.15 in +0.20 (multiplikator nad 1.0).
 */
export function calcProximityScore(walking: WalkingResult[], noise: number | null): number {
  let score = 0;

  for (const w of walking) {
    const mins = w.walkMinutes ?? 99;
    switch (w.type) {
      case "kindergarten":
      case "school":
        if (mins <= 5) score += 0.03;
        else if (mins <= 10) score += 0.015;
        break;
      case "university":
        if (mins <= 10) score += 0.04; // najem premium
        else if (mins <= 20) score += 0.02;
        break;
      case "hospital":
        if (mins <= 10) score += 0.02;
        break;
      case "tram_stop":
        if (mins <= 3) score += 0.04;
        else if (mins <= 7) score += 0.02;
        break;
      case "bus_stop":
        if (mins <= 3) score += 0.02;
        else if (mins <= 7) score += 0.01;
        break;
      case "supermarket":
        if (mins <= 5) score += 0.015;
        break;
      case "park":
        if (mins <= 5) score += 0.02;
        break;
    }
  }

  // Hrup malus
  if (noise != null) {
    if (noise >= 65) score -= 0.08;
    else if (noise >= 55) score -= 0.04;
    else if (noise < 45) score += 0.03; // tiho = bonus
  }

  return Math.max(-0.15, Math.min(0.20, score));
}
