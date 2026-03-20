/**
 * Google Places API — javni prevoz in amenitete v bližini
 * Per-usage pricing: ~$0.032 per lookup (Nearby Search)
 *
 * POMEMBNO: Signal se prikazuje informativno — NE vpliva na ceno.
 * Statistična analiza (R²<2%) kaže da transit ne pojasni variance ETN cen
 * (ker je kolinearen z lokacijo/KO). Prikazujemo za kontekst, ne za korekcijo.
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "AIzaSyBdsTqzdIZ8MTDnnrvtelugoEYXjS-V1wQ";
const PLACES_RADIUS_M = 500; // 500m radius

export interface TransitInfo {
  busStops: number;
  tramStops: number;
  metroStations: number;
  trainStations: number;
  nearestBusM: number | null;   // razdalja do najbližje postaje v metrih
  nearestTrainM: number | null;
  kvaliteta: "odlicna" | "dobra" | "srednja" | "slaba";
  opis: string;
}

export interface AmenityInfo {
  supermarkets: number;
  banks: number;
  pharmacies: number;
  schools: number;
  parks: number;
  restaurants: number;
  nearestSupermarketM: number | null;
}

export interface PlacesData {
  transit: TransitInfo;
  amenities: AmenityInfo;
  cached?: boolean;
}

// In-memory cache (per process, resets on cold start) — zmanjša API klice
const cache = new Map<string, { data: PlacesData; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function cacheKey(lat: number, lng: number): string {
  // Zaokroži na ~100m grid (0.001° ≈ 111m)
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

interface PlacesResult {
  geometry: { location: { lat: number; lng: number } };
  types: string[];
  name: string;
}

async function nearbySearch(
  lat: number,
  lng: number,
  type: string
): Promise<PlacesResult[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(PLACES_RADIUS_M));
  url.searchParams.set("type", type);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Places API error: ${res.status}`);
  const data = await res.json() as { status: string; results: PlacesResult[] };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places API status: ${data.status}`);
  }
  return data.results ?? [];
}

function distanceM(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestDist(results: PlacesResult[], lat: number, lng: number): number | null {
  if (results.length === 0) return null;
  return Math.round(
    Math.min(...results.map(r => distanceM(lat, lng, r.geometry.location.lat, r.geometry.location.lng)))
  );
}

export async function getPlacesData(
  lat: number,
  lng: number
): Promise<PlacesData | null> {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  try {
    // Vzporedni API klici — 4 klica skupaj (~$0.13 za ta lookup)
    const [busResults, transitResults, trainResults, supermarketResults] =
      await Promise.all([
        nearbySearch(lat, lng, "bus_station"),
        nearbySearch(lat, lng, "transit_station"),
        nearbySearch(lat, lng, "train_station"),
        nearbySearch(lat, lng, "supermarket"),
      ]);

    // Filtriramo tram (transit_station brez train/bus)
    const tramResults = transitResults.filter(r =>
      !r.types.includes("train_station") &&
      r.name.toLowerCase().includes("tram")
    );

    const busCount = busResults.length;
    const tramCount = tramResults.length;
    const trainCount = trainResults.filter(r =>
      !r.types.includes("subway_station")
    ).length;

    const nearestBus = nearestDist(busResults, lat, lng);
    const nearestTrain = nearestDist(trainResults, lat, lng);

    const totalTransit = busCount * 1 + tramCount * 2 + trainCount * 3;
    let kvaliteta: TransitInfo["kvaliteta"];
    let opis: string;

    if (totalTransit >= 8 || (nearestBus != null && nearestBus < 100)) {
      kvaliteta = "odlicna";
      opis = `${busCount} bus${tramCount > 0 ? ` + ${tramCount} tram` : ""}${trainCount > 0 ? ` + ${trainCount} vlak` : ""} postaj v 500m`;
    } else if (totalTransit >= 3) {
      kvaliteta = "dobra";
      opis = `${busCount} bus${tramCount > 0 ? ` + ${tramCount} tram` : ""} postaj v 500m`;
    } else if (totalTransit >= 1) {
      kvaliteta = "srednja";
      opis = nearestBus != null ? `Najbližja postaja ${nearestBus}m` : "Javni prevoz dosegljiv";
    } else {
      kvaliteta = "slaba";
      opis = "Ni javnega prevoza v 500m";
    }

    const transit: TransitInfo = {
      busStops: busCount,
      tramStops: tramCount,
      metroStations: 0,
      trainStations: trainCount,
      nearestBusM: nearestBus,
      nearestTrainM: nearestTrain,
      kvaliteta,
      opis,
    };

    const amenities: AmenityInfo = {
      supermarkets: supermarketResults.length,
      banks: 0, // Ločen klic bi bil potreben — za zdaj izpuščamo
      pharmacies: 0,
      schools: 0,
      parks: 0,
      restaurants: 0,
      nearestSupermarketM: nearestDist(supermarketResults, lat, lng),
    };

    const result: PlacesData = { transit, amenities };
    cache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.error("Places API error:", err);
    return null;
  }
}
