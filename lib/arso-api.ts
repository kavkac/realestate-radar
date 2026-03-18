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

// Static fallback by municipality bounding boxes (lat/lng)
// Sources: ARSO seizmična karta, Eurocode 8 national annex for Slovenia
const STATICNE_CONE: { naziv: string; latMin: number; latMax: number; lngMin: number; lngMax: number; pga: number }[] = [
  // Posočje (cona IV, PGA > 0.225g)
  { naziv: "Bovec",    latMin: 46.30, latMax: 46.42, lngMin: 13.50, lngMax: 13.65, pga: 0.250 },
  { naziv: "Kobarid",  latMin: 46.20, latMax: 46.30, lngMin: 13.55, lngMax: 13.70, pga: 0.225 },
  { naziv: "Tolmin",   latMin: 46.15, latMax: 46.25, lngMin: 13.65, lngMax: 13.85, pga: 0.200 },
  // Ljubljana in okolica (cona III, PGA ~0.175g)
  { naziv: "Ljubljana",latMin: 45.98, latMax: 46.12, lngMin: 14.40, lngMax: 14.65, pga: 0.175 },
  { naziv: "Domžale",  latMin: 46.10, latMax: 46.18, lngMin: 14.54, lngMax: 14.65, pga: 0.150 },
  { naziv: "Kranj",    latMin: 46.22, latMax: 46.28, lngMin: 14.32, lngMax: 14.42, pga: 0.150 },
  // Pomurje (cona II)
  { naziv: "Murska Sobota", latMin: 46.62, latMax: 46.70, lngMin: 16.10, lngMax: 16.22, pga: 0.075 },
  { naziv: "Lendava",       latMin: 46.55, latMax: 46.62, lngMin: 16.43, lngMax: 16.55, pga: 0.075 },
];

function staticFallback(lat: number, lng: number): SeizmicniPodatki {
  for (const obmocje of STATICNE_CONE) {
    if (lat >= obmocje.latMin && lat <= obmocje.latMax && lng >= obmocje.lngMin && lng <= obmocje.lngMax) {
      const cona = pgaToCona(obmocje.pga);
      return { pga: obmocje.pga, cona, opisCone: OPISCI_CONE[cona] };
    }
  }
  // Default: cona II (zmerna nevarnost - pokriva večino Slovenija)
  return { pga: 0.075, cona: "II", opisCone: OPISCI_CONE["II"] };
}

export async function getSeizmicnaCona(lat: number, lng: number): Promise<SeizmicniPodatki | null> {
  try {
    const url = `https://gis.arso.gov.si/arcgis/rest/services/potres/potresna_nevarnost/MapServer/0/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return staticFallback(lat, lng);

    const data = await res.json();
    const feat = data?.features?.[0]?.attributes;
    if (!feat) return staticFallback(lat, lng);

    const pga = feat.PGA_475 ?? feat.pga ?? feat.PGA ?? null;
    if (!pga || typeof pga !== "number") return staticFallback(lat, lng);

    const cona = pgaToCona(pga);
    return { pga, cona, opisCone: OPISCI_CONE[cona] };
  } catch {
    return staticFallback(lat, lng);
  }
}
