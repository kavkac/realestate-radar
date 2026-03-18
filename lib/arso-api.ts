export interface SeizmicniPodatki {
  pga: number;       // Peak Ground Acceleration (g)
  cona: string;      // "I" | "II" | "III" | "IV"
  opisCone: string;  // human readable
}

const OPISCI_CONE: Record<string, string> = {
  "I":  "Nizka potresna nevarnost (PGA < 0.05g)",
  "II": "Zmerna potresna nevarnost (PGA 0.05–0.10g)",
  "III":"Srednja potresna nevarnost (PGA 0.10–0.175g)",
  "IV": "Visoka potresna nevarnost (PGA > 0.175g)",
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
  if (lng < 13.9 && lat > 45.9 && lat < 46.4) return { pga: 0.225, cona: "IV", opisCone: "Visoka potresna nevarnost (PGA > 0.175g)" };
  // Ljubljana in okolica
  if (lat > 45.9 && lat < 46.2 && lng > 14.3 && lng < 14.7) return { pga: 0.175, cona: "III", opisCone: "Srednja potresna nevarnost (PGA 0.10–0.175g)" };
  // Pomurje (nižja nevarnost)
  if (lng > 15.9 && lat > 46.4) return { pga: 0.075, cona: "II", opisCone: "Zmerna potresna nevarnost (PGA 0.05–0.10g)" };
  // Default Slovenija
  return { pga: 0.125, cona: "III", opisCone: "Srednja potresna nevarnost (PGA 0.10–0.175g)" };
}

export async function getSeizmicnaCona(lat: number, lng: number): Promise<SeizmicniPodatki> {
  try {
    const url = `https://gis.arso.gov.si/arcgis/rest/services/potres/potresna_nevarnost/MapServer/0/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
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
