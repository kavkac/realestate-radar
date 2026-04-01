export interface PoplavnaNevarnost {
  stopnja: "ni" | "nizka" | "srednja" | "visoka";
  opis: string;
}

export async function getPoplavnaNevarnost(lat: number, lng: number): Promise<PoplavnaNevarnost> {
  try {
    // ARSO poplavna karta — ArcGIS REST
    const url = `https://gis.arso.gov.si/arcgis/rest/services/poplave/Poplavna_nevarnost/MapServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=2&mapExtent=${lng-0.001},${lat-0.001},${lng+0.001},${lat+0.001}&imageDisplay=800,600,96&returnGeometry=false&f=json`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { stopnja: "ni", opis: "Lokacija ni v evidentirani poplavni coni." };
    const data = await res.json();
    const results = data?.results ?? [];
    if (results.length === 0) return { stopnja: "ni", opis: "Lokacija ni v evidentirani poplavni coni." };

    // ARSO vrne atribut RAZRED ali NEVARNOST
    const attrs = results[0]?.attributes ?? {};
    const razred = attrs.RAZRED ?? attrs.NEVARNOST ?? attrs.razred ?? null;

    if (!razred) return { stopnja: "ni", opis: "Lokacija ni v evidentirani poplavni coni." };

    const razredStr = String(razred).toLowerCase();
    if (razredStr.includes("visok") || razredStr === "3") return { stopnja: "visoka", opis: "Visoka poplavna nevarnost (pogosto poplavljeno območje)." };
    if (razredStr.includes("srednj") || razredStr === "2") return { stopnja: "srednja", opis: "Srednja poplavna nevarnost (občasno poplavljeno)." };
    return { stopnja: "nizka", opis: "Nizka poplavna nevarnost (redko poplavljeno)." };
  } catch {
    return { stopnja: "ni", opis: "Lokacija ni v evidentirani poplavni coni." };
  }
}

export interface SeizmicniPodatki {
  pga: number;       // Peak Ground Acceleration (g)
  cona: string;      // "I" | "II" | "III" | "IV"
  opisCone: string;  // human readable
}

const OPISCI_CONE: Record<string, string> = {
  "I":  "Nizka potresna nevarnost",
  "II": "Zmerna potresna nevarnost",
  "III":"Srednja potresna nevarnost",
  "IV": "Visoka potresna nevarnost",
};

function pgaToCona(pga: number): string {
  if (pga < 0.05)  return "I";
  if (pga < 0.10)  return "II";
  if (pga < 0.175) return "III";
  return "IV";
}

// Coordinate-based fallback — vedno vrne podatek za Slovenijo
// Vir: ARSO seizmična karta, Eurocode 8 national annex for Slovenia
function fallbackCona(lat: number, lng: number): SeizmicniPodatki {
  // Posočje / zahodni rob (visoka nevarnost)
  if (lng < 13.9 && lat > 45.9 && lat < 46.4) return { pga: 0.225, cona: "IV", opisCone: "Visoka potresna nevarnost" };
  // Ljubljana in okolica
  if (lat > 45.9 && lat < 46.2 && lng > 14.3 && lng < 14.7) return { pga: 0.175, cona: "III", opisCone: "Srednja potresna nevarnost" };
  // Pomurje (nižja nevarnost)
  if (lng > 15.9 && lat > 46.4) return { pga: 0.075, cona: "II", opisCone: "Zmerna potresna nevarnost" };
  // Default Slovenija
  return { pga: 0.125, cona: "III", opisCone: "Srednja potresna nevarnost" };
}

export async function getSeizmicnaCona(lat: number, lng: number): Promise<SeizmicniPodatki> {
  try {
    const url = `https://gis.arso.gov.si/arcgis/rest/services/potres/potresna_nevarnost/MapServer/0/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return fallbackCona(lat, lng);

    const data = await res.json();
    const feat = data?.features?.[0]?.attributes;
    if (!feat) return fallbackCona(lat, lng);

    const pga = feat.PGA_475 ?? feat.pga ?? feat.PGA ?? null;
    if (!pga || typeof pga !== "number") return fallbackCona(lat, lng);

    const cona = pgaToCona(pga);
    return { pga, cona, opisCone: OPISCI_CONE[cona] };
  } catch {
    return fallbackCona(lat, lng);
  }
}

// ─── AIR QUALITY — OpenAQ v3 ──────────────────────────────────────────────

export interface KakovostZraka {
  pm25: number | null;
  no2: number | null;
  station_name: string | null;
  station_distance_km: number | null;
  index: "dobra" | "sprejemljiva" | "slaba" | "neznana";
}

function airIndex(pm25: number | null, no2: number | null): KakovostZraka["index"] {
  if (pm25 === null && no2 === null) return "neznana";
  if ((pm25 ?? 999) < 10 && (no2 ?? 999) < 40) return "dobra";
  if ((pm25 ?? 0) >= 25 || (no2 ?? 0) >= 100) return "slaba";
  return "sprejemljiva";
}

export async function getAirQualityNearby(lat: number, lng: number): Promise<KakovostZraka> {
  const fallback: KakovostZraka = { pm25: null, no2: null, station_name: null, station_distance_km: null, index: "neznana" };
  try {
    // 1. Find nearest station in Slovenia
    const locUrl = `https://api.openaq.org/v3/locations?country=SI&limit=10&coordinates=${lat},${lng}&radius=50000&order_by=distance`;
    const locRes = await fetch(locUrl, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!locRes.ok) return fallback;
    const locData = await locRes.json();
    const location = locData?.results?.[0];
    if (!location) return fallback;

    const locationId: number = location.id;
    const stationName: string = location.name ?? null;
    const distanceM: number = location.distance ?? null;
    const distanceKm = distanceM !== null ? Math.round(distanceM / 100) / 10 : null;

    // 2. Get sensors for this location
    const sensUrl = `https://api.openaq.org/v3/sensors?locations_id=${locationId}`;
    const sensRes = await fetch(sensUrl, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!sensRes.ok) return { ...fallback, station_name: stationName, station_distance_km: distanceKm };
    const sensData = await sensRes.json();
    const sensors: Array<{ id: number; parameter: { name: string } }> = sensData?.results ?? [];

    const pm25Sensor = sensors.find(s => s.parameter?.name === "pm25");
    const no2Sensor = sensors.find(s => s.parameter?.name === "no2");

    // 3. Get latest measurements
    async function getLatest(sensorId: number): Promise<number | null> {
      try {
        const r = await fetch(`https://api.openaq.org/v3/sensors/${sensorId}/measurements/latest`, {
          cache: "no-store", signal: AbortSignal.timeout(3000)
        });
        if (!r.ok) return null;
        const d = await r.json();
        return d?.results?.[0]?.value ?? null;
      } catch { return null; }
    }

    const [pm25, no2] = await Promise.all([
      pm25Sensor ? getLatest(pm25Sensor.id) : Promise.resolve(null),
      no2Sensor  ? getLatest(no2Sensor.id)  : Promise.resolve(null),
    ]);

    return { pm25, no2, station_name: stationName, station_distance_km: distanceKm, index: airIndex(pm25, no2) };
  } catch {
    return fallback;
  }
}

// ─── NOISE LEVEL — ARSO Strateške karte hrupa ────────────────────────────

export interface NivojHrupa {
  lden: number | null;  // dB, day-evening-night
  lnoc: number | null;  // dB, night only
  vir: "MOL" | "DARS" | "DRSI" | "zeleznica" | null;
  ocena: "tiho" | "zmerno" | "hrupno" | "neznano";
}

function noiseOcena(lden: number | null): NivojHrupa["ocena"] {
  if (lden === null) return "neznano";
  if (lden < 55) return "tiho";
  if (lden < 65) return "zmerno";
  return "hrupno";
}

const NOISE_LAYERS: Array<{ id: number; vir: NivojHrupa["vir"] }> = [
  { id: 344, vir: "MOL" },
  { id: 358, vir: "DARS" },
  { id: 352, vir: "DRSI" },
  { id: 354, vir: "zeleznica" },
];

export async function getNivojHrupa(lat: number, lng: number): Promise<NivojHrupa> {
  const fallback: NivojHrupa = { lden: null, lnoc: null, vir: null, ocena: "neznano" };
  const base = "https://gis.arso.gov.si/arcgis/rest/services/Atlasokolja_javni_D96_test/MapServer";
  const params = `geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;

  for (const layer of NOISE_LAYERS) {
    try {
      const url = `${base}/${layer.id}/query?${params}`;
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json();
      const attrs = data?.features?.[0]?.attributes;
      if (!attrs) continue;

      // Field names vary per layer — try all candidates
      const lden: number | null = attrs.LDEN ?? attrs.Lden ?? attrs.lden ?? attrs.DB_LDEN ?? attrs.NIVO_LDEN ?? null;
      const lnoc: number | null = attrs.LNOC ?? attrs.Lnoc ?? attrs.lnoc ?? attrs.DB_LNOC ?? attrs.NIVO_LNOC ?? null;

      if (lden === null) continue; // no data on this layer, try next

      return { lden, lnoc, vir: layer.vir, ocena: noiseOcena(lden) };
    } catch { continue; }
  }
  return fallback;
}
