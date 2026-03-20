/**
 * Google Places API — dostopnost do storitev v bližini
 * Per-usage pricing: ~$0.032 per Nearby Search klic
 * 24h cache → vsaka lokacija se zaračuna enkrat na dan
 *
 * Kategorije: transit, trgovine, zdravstvo, šole, parki, banke, pošta, gostinstvo
 *
 * OPOMBA: Podatki so informativni — ne vplivajo na ceno.
 * Transit R²<2% iz ETN analize (kolinearen z KO lokacijo).
 */

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ?? "AIzaSyBdsTqzdIZ8MTDnnrvtelugoEYXjS-V1wQ";

const RADIUS_TRANSIT = 600;   // 600m za javni prevoz
const RADIUS_SERVICES = 500;  // 500m za storitve

export interface TransitInfo {
  busStops: number;
  tramStops: number;
  trainStations: number;
  nearestBusM: number | null;
  nearestTrainM: number | null;
  kvaliteta: "odlicna" | "dobra" | "srednja" | "slaba";
  opis: string;
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
}

export interface PlacesData {
  transit: TransitInfo;
  services: ServicesInfo;
  cached?: boolean;
}

// In-memory cache — resets on cold start
const cache = new Map<string, { data: PlacesData; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function cacheKey(lat: number, lng: number): string {
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
  type: string,
  radius: number = RADIUS_SERVICES
): Promise<PlacesResult[]> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
  );
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("type", type);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const res = await fetch(url.toString(), {
    next: { revalidate: 86400 }, // Next.js fetch cache 24h
  });
  if (!res.ok) throw new Error(`Places API error: ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    results: PlacesResult[];
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places API status: ${data.status}`);
  }
  return data.results ?? [];
}

function distM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearest(results: PlacesResult[], lat: number, lng: number): number | null {
  if (!results.length) return null;
  return Math.round(
    Math.min(
      ...results.map((r) =>
        distM(lat, lng, r.geometry.location.lat, r.geometry.location.lng)
      )
    )
  );
}

export async function getPlacesData(
  lat: number,
  lng: number
): Promise<PlacesData | null> {
  const key = cacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return { ...hit.data, cached: true };
  }

  try {
    // 11 vzporednih klicev — ~$0.35 na unikaten lookup (z 24h cache)
    const [
      busResults,
      transitResults,
      trainResults,
      supermarketResults,
      pharmacyResults,
      schoolResults,
      kindergartenResults,
      parkResults,
      bankResults,
      postResults,
      restaurantResults,
      doctorResults,
    ] = await Promise.all([
      nearbySearch(lat, lng, "bus_station", RADIUS_TRANSIT),
      nearbySearch(lat, lng, "transit_station", RADIUS_TRANSIT),
      nearbySearch(lat, lng, "train_station", RADIUS_TRANSIT),
      nearbySearch(lat, lng, "supermarket"),
      nearbySearch(lat, lng, "pharmacy"),
      nearbySearch(lat, lng, "school"),
      nearbySearch(lat, lng, "secondary_school").catch(() => [] as PlacesResult[]),
      nearbySearch(lat, lng, "park"),
      nearbySearch(lat, lng, "bank"),
      nearbySearch(lat, lng, "post_office"),
      nearbySearch(lat, lng, "restaurant"),
      nearbySearch(lat, lng, "doctor"),
    ]);

    // Transit
    const busCount = busResults.length;
    const tramCount = transitResults.filter(
      (r) => !r.types.includes("train_station") && !r.types.includes("bus_station")
    ).length;
    const trainCount = trainResults.length;

    const nearestBus = nearest(busResults, lat, lng);
    const nearestTrain = nearest(trainResults, lat, lng);

    const totalTransit = busCount + tramCount * 2 + trainCount * 3;
    let kvaliteta: TransitInfo["kvaliteta"];
    let opis: string;

    if (totalTransit >= 8 || (nearestBus != null && nearestBus < 100)) {
      kvaliteta = "odlicna";
      opis = [
        busCount > 0 ? `${busCount} bus` : null,
        tramCount > 0 ? `${tramCount} tram` : null,
        trainCount > 0 ? `${trainCount} vlak` : null,
      ]
        .filter(Boolean)
        .join(" + ") + " postaj v 600m";
    } else if (totalTransit >= 3) {
      kvaliteta = "dobra";
      opis =
        [
          busCount > 0 ? `${busCount} bus` : null,
          tramCount > 0 ? `${tramCount} tram` : null,
        ]
          .filter(Boolean)
          .join(" + ") + " postaj v 600m";
    } else if (totalTransit >= 1) {
      kvaliteta = "srednja";
      opis =
        nearestBus != null
          ? `Najbližja postaja ${nearestBus}m`
          : "Javni prevoz dosegljiv";
    } else {
      kvaliteta = "slaba";
      opis = "Ni javnega prevoza v 600m";
    }

    const transit: TransitInfo = {
      busStops: busCount,
      tramStops: tramCount,
      trainStations: trainCount,
      nearestBusM: nearestBus,
      nearestTrainM: nearestTrain,
      kvaliteta,
      opis,
    };

    // Šole: združi school + secondary_school, dedupliciraj po imenu
    const allSchools = [
      ...schoolResults,
      ...kindergartenResults,
    ];
    const uniqueSchools = allSchools.filter(
      (s, i, arr) => arr.findIndex((x) => x.name === s.name) === i
    );

    const services: ServicesInfo = {
      supermarkets: supermarketResults.length,
      nearestSupermarketM: nearest(supermarketResults, lat, lng),
      pharmacies: pharmacyResults.length,
      nearestPharmacyM: nearest(pharmacyResults, lat, lng),
      schools: uniqueSchools.filter((s) =>
        s.types.includes("school") || s.types.includes("secondary_school")
      ).length,
      kindergartens: uniqueSchools.filter(
        (s) => !s.types.includes("school") && !s.types.includes("secondary_school")
      ).length,
      parks: parkResults.length,
      nearestParkM: nearest(parkResults, lat, lng),
      banks: bankResults.length,
      postOffices: postResults.length,
      restaurants: restaurantResults.length,
      doctors: doctorResults.length,
      hospitals: 0, // Ločen klic ni potreben — hospitals so redki
    };

    const result: PlacesData = { transit, services };
    cache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.error("Places API error:", err);
    return null;
  }
}
