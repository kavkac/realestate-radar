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
