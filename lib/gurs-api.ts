import { getCached, setCached } from "./wfs-cache";

/** Preveri ali katerakoli točka poligona A leži v poligonu B ali obratno → presečišče */
function polygonsIntersect(ringA: number[][], ringB: number[][]): boolean {
  for (const pt of ringA) {
    if (pointInPolygon(pt as [number, number], ringB)) return true;
  }
  for (const pt of ringB) {
    if (pointInPolygon(pt as [number, number], ringA)) return true;
  }
  return false;
}

/** Ray-casting point-in-polygon (WGS84 coords [lng, lat]) */
function pointInPolygon(point: [number, number], ring: number[][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const BASE_RPE = "https://storitve.eprostor.gov.si/ows-pub-wfs/wfs";
const BASE_KN = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs";
const BASE_KN_JV = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs";

// --- Šifranti ---

const NOSILNA_KONSTRUKCIJA: Record<number, string> = {
  1: "Masivna (kamen, opeka)",
  2: "Montažna",
  3: "Lesena",
  4: "Kombinirana",
  5: "Armiran beton",
  6: "Jeklo",
  9: "Neznano",
};

const TIP_STAVBE: Record<number, string> = {
  1: "Enostanovanjska",
  2: "Dvostanovanjska",
  3: "Večstanovanjska",
  4: "Poslovna",
  5: "Industrijska",
  6: "Kmetijska",
  9: "Drugo",
};

export const VRSTA_DEJANSKE_RABE: Record<number, string> = {
  1: "Stanovanje",
  2: "Pisarna",
  3: "Trgovska ali storitvena dejavnost",
  4: "Gostinska dejavnost",
  5: "Industrijska dejavnost",
  6: "Garaža",
  7: "Klet",
  8: "Shramba",
  9: "Skupni prostori",
  10: "Drugo",
  11: "Poslovni prostor",
  12: "Gostinski lokal",
  13: "Turistična nastanitev",
  14: "Zdravstveni prostor",
  15: "Izobraževalni prostor",
  16: "Kulturni prostor",
  17: "Športni prostor",
  18: "Verski prostor",
  19: "Pokopališki prostor",
  20: "Kmetijski prostor",
  21: "Gozdarski prostor",
  22: "Vodna površina",
  23: "Skupna raba",
  24: "Poslovni prostor v stanovanjski stavbi",
  25: "Stanovanje v poslovni stavbi",
  26: "Nestanovanjska raba",
  30: "Garažno mesto",
  31: "Parkirno mesto",
  32: "Kolesarnica",
  33: "Tehnični prostor",
  34: "Stopnišče",
  35: "Hodnik",
  36: "Dvigalo",
  37: "Kotlovnica",
  38: "Smetnjak",
  40: "Zunanja površina",
  41: "Balkon",
  42: "Terasa",
  43: "Lopa",
  44: "Vrt",
  45: "Dvorišče",
  46: "Neznano",
  47: "Stanovanje (starejši zapis)",
  48: "Pisarna (starejši zapis)",
  49: "Poslovni prostor (starejši zapis)",
  50: "Garaža (starejši zapis)",
};

export const VRSTA_PROSTORA: Record<number, string> = {
  1: "Bivalni prostor",
  2: "Kuhinja",
  3: "Kopalnica, WC",
  4: "Shramba, sušilnica, pralnica",
  5: "Odprta terasa, balkon, loža",
  6: "Zaprta terasa, balkon, loža",
  7: "Garaža",
  8: "Tehnični prostor",
  9: "Klet",
  10: "Podstrešje",
  11: "Skupni prostor",
  12: "Poslovni prostor",
  13: "Drugo",
};

// --- Types ---

export type TipPolozajaStavbe = "samostojna" | "vogalna" | "vmesna vrstna" | null;

// --- Geometry helpers ---

interface StavbaGeometrija {
  kompaktnost: number | null;
  orientacija: "S" | "SV" | "V" | "JV" | "J" | "JZ" | "Z" | "SZ" | null;
}

function izracunajGeometrijo(obrisGeom: any): StavbaGeometrija {
  if (!obrisGeom || obrisGeom.type !== "Polygon") return { kompaktnost: null, orientacija: null };

  const coords = obrisGeom.coordinates[0] as [number, number][];
  if (!coords || coords.length < 4) return { kompaktnost: null, orientacija: null };

  // Površina (Shoelace formula)
  let povrsina = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    povrsina += coords[i][0] * coords[i + 1][1];
    povrsina -= coords[i + 1][0] * coords[i][1];
  }
  povrsina = Math.abs(povrsina) / 2;

  // Obseg
  let obseg = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    obseg += Math.sqrt(dx * dx + dy * dy);
  }

  // Kompaktnost: obseg² / (4π × površina) — 1.0 = krog, kvadrat ≈ 1.27
  const kompaktnost = povrsina > 0 ? (obseg * obseg) / (4 * Math.PI * povrsina) : null;

  // Orientacija: najdaljša stranica določa smer fasade
  let maxDolzina = 0;
  let kotGlavneFasade = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxDolzina) {
      maxDolzina = d;
      kotGlavneFasade = Math.atan2(dy, dx) * 180 / Math.PI;
    }
  }

  // Fasada je pravokotna na najdaljšo stranico
  const kotFasade = (kotGlavneFasade + 90) % 360;
  const norm = ((kotFasade % 360) + 360) % 360;

  let orientacija: StavbaGeometrija["orientacija"];
  if (norm < 22.5 || norm >= 337.5) orientacija = "S";
  else if (norm < 67.5) orientacija = "SV";
  else if (norm < 112.5) orientacija = "V";
  else if (norm < 157.5) orientacija = "JV";
  else if (norm < 202.5) orientacija = "J";
  else if (norm < 247.5) orientacija = "JZ";
  else if (norm < 292.5) orientacija = "Z";
  else orientacija = "SZ";

  return { kompaktnost, orientacija };
}

export interface StavbaData {
  koId: number;
  stStavbe: number;
  eidStavba: string;
  letoIzgradnje: number | null;
  letoObnoveFasade: number | null;
  letoObnoveStrehe: number | null;
  steviloEtaz: number | null;
  steviloStanovanj: number | null;
  brutoTlorisnaPovrsina: number | null;
  elektrika: boolean;
  plin: boolean;
  vodovod: boolean;
  kanalizacija: boolean;
  nosilnaKonstrukcija: string | null;
  tipStavbe: string | null;
  datumSys: string | null;
  visina: number | null; // VISINA_H2 - VISINA_H3
  tipPolozaja: TipPolozajaStavbe;
  kompaktnost: number | null;
  orientacija: "S" | "SV" | "V" | "JV" | "J" | "JZ" | "Z" | "SZ" | null;
  obrisGeom: { type: "Polygon"; coordinates: number[][][] } | null;
}

export interface ProstorData {
  vrsta: string;
  povrsina: number | null;
}

export interface DelStavbeData {
  stDelaStavbe: number;
  eidDelStavbe: string;
  povrsina: number | null;
  uporabnaPovrsina: number | null;
  vrsta: string | null;
  letoObnoveInstalacij: number | null;
  letoObnoveOken: number | null;
  dvigalo: boolean;
  prostori: ProstorData[];
  etazaDelStavbe: number | null; // ETAZE_DELA_STAVBE
  vrstaStanovanjaUradno: string | null; // VRSTE_STANOVANJ_NAZIV_SL
}

interface WfsFeature {
  type: string;
  properties: Record<string, unknown>;
  geometry?: Record<string, unknown>;
}

interface WfsResponse {
  type: string;
  features: WfsFeature[];
}

// --- WFS helpers ---

/** GURS WFS uses 1=Da, 2=Ne for boolean fields */
function wfsBool(val: unknown): boolean {
  return val === 1 || val === "1";
}

function buildWfsUrl(
  base: string,
  typeName: string,
  cqlFilter: string,
): string {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: typeName,
    OUTPUTFORMAT: "application/json",
    CQL_FILTER: cqlFilter,
    ...(base.includes("wfs-si-gurs-kn") ? { REFERER_APP_CODE: "JV" } : {}),
  });
  return `${base}?${params.toString()}`;
}

async function fetchWfs(url: string): Promise<WfsResponse | null> {
  try {
    const cached = getCached(url);
    if (cached) {
      return JSON.parse(cached) as WfsResponse;
    }
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    setCached(url, text);
    return JSON.parse(text) as WfsResponse;
  } catch {
    return null;
  }
}

// --- Public API ---

export async function getStreetId(streetName: string): Promise<number | null> {
  const url = buildWfsUrl(
    BASE_RPE,
    "SI.GURS.RPE:UL_G",
    `UL_UIME ILIKE '${streetName.trim()}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;
  return data.features[0].properties.UL_MID as number;
}

/** Fallback za podeželske naslove brez ulice: išče po NASELJE + hišna številka */
export async function getHouseBySettlement(
  settlementName: string,
  houseNumber: string,
  suffix?: string,
): Promise<{ hsMid: number; lat: number | null; lng: number | null } | null> {
  // 1. Poišči NA_MID za naselje
  const naUrl = buildWfsUrl(BASE_RPE, "SI.GURS.RPE:NA_G", `NA_UIME ILIKE '${settlementName.trim()}'`);
  const naData = await fetchWfs(naUrl);
  if (!naData || naData.features.length === 0) return null;
  const naMid = naData.features[0].properties.NA_MID as number;

  // 2. Poišči hišno številko po NA_MID
  let filter = `NA_MID=${naMid} AND HS=${houseNumber}`;
  if (suffix) filter += ` AND HD='${suffix}'`;
  const hsUrl = `${buildWfsUrl(BASE_RPE, "SI.GURS.RPE:HS_G", filter)}&SRSNAME=EPSG:4326`;
  const hsData = await fetchWfs(hsUrl);
  if (!hsData || hsData.features.length === 0) return null;

  const feature = hsData.features[0];
  const hsMid = feature.properties.HS_MID as number;
  let lat: number | null = null;
  let lng: number | null = null;
  const geom = feature.geometry as { type?: string; coordinates?: number[] } | null;
  if (geom?.type === "Point" && geom.coordinates) {
    lng = geom.coordinates[0];
    lat = geom.coordinates[1];
  }
  return { hsMid, lat, lng };
}

export async function getHouseNumberId(
  ulMid: number,
  houseNumber: string,
  suffix?: string,
): Promise<{ hsMid: number; lat: number | null; lng: number | null } | null> {
  let filter = `UL_MID=${ulMid} AND HS=${houseNumber}`;
  if (suffix) {
    filter += ` AND HD='${suffix}'`;
  }
  // Request WGS84 coordinates for Google Maps
  const baseUrl = buildWfsUrl(BASE_RPE, "SI.GURS.RPE:HS_G", filter);
  const url = `${baseUrl}&SRSNAME=EPSG:4326`;
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;

  const feature = data.features[0];
  const hsMid = feature.properties.HS_MID as number;

  let lat: number | null = null;
  let lng: number | null = null;
  const geom = feature.geometry as { type?: string; coordinates?: number[] } | null;
  if (geom?.type === "Point" && geom.coordinates) {
    lng = geom.coordinates[0];
    lat = geom.coordinates[1];
  }

  return { hsMid, lat, lng };
}

export async function getBuildingEid(hsMid: number): Promise<string | null> {
  // Najprej veljavna tablica (STATUS_VELJAVNOSTI='V'), nato brez filtra kot fallback
  const urlV = buildWfsUrl(BASE_KN, "SI.GURS.KN:HISNE_STEVILKE_H", `ST_HS=${hsMid} AND STATUS_VELJAVNOSTI='V'`);
  const dataV = await fetchWfs(urlV);
  if (dataV && dataV.features.length > 0) {
    return String(dataV.features[0].properties.EID_STAVBA);
  }
  const url = buildWfsUrl(BASE_KN, "SI.GURS.KN:HISNE_STEVILKE_H", `ST_HS=${hsMid}`);
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;
  return String(data.features[0].properties.EID_STAVBA);
}

export async function getBuilding(
  eidStavba: string,
): Promise<StavbaData | null> {
  const url = buildWfsUrl(BASE_KN, "SI.GURS.KN:STAVBE_H", `EID_STAVBA='${eidStavba}'`) + "&SRSNAME=EPSG:4326";
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;

  const p = data.features[0].properties;
  return {
    koId: p.KO_ID as number,
    stStavbe: p.ST_STAVBE as number,
    eidStavba,
    letoIzgradnje: (p.LETO_IZGRADNJE as number) || null,
    letoObnoveFasade: (p.LETO_OBNOVE_FASADE as number) || null,
    letoObnoveStrehe: (p.LETO_OBNOVE_STREHE as number) || null,
    steviloEtaz: (p.STEVILO_ETAZ as number) || null,
    steviloStanovanj: (p.STEVILO_STANOVANJ as number) || null,
    brutoTlorisnaPovrsina: (p.BRUTO_TLORISNA_POVRSINA as number) || null,
    elektrika: wfsBool(p.ELEKTRIKA),
    plin: wfsBool(p.PLIN),
    vodovod: wfsBool(p.VODOVOD),
    kanalizacija: wfsBool(p.KANALIZACIJA),
    nosilnaKonstrukcija:
      NOSILNA_KONSTRUKCIJA[p.NOSILNA_KONSTRUKCIJA_ID as number] ?? null,
    tipStavbe: TIP_STAVBE[p.TIP_STAVBE_ID as number] ?? null,
    datumSys: p.DATUM_SYS ? String(p.DATUM_SYS) : null,
    visina: (p.VISINA_H2 != null && p.VISINA_H3 != null) ? (p.VISINA_H2 as number) - (p.VISINA_H3 as number) : null,
    tipPolozaja: null,
    obrisGeom: (p.OBRIS_GEOM && (p.OBRIS_GEOM as any).type === "Polygon") ? (p.OBRIS_GEOM as { type: "Polygon"; coordinates: number[][][] }) : null,
    ...izracunajGeometrijo(p.OBRIS_GEOM),
  };
}

export async function getRooms(eidDelStavbe: string): Promise<ProstorData[]> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:PROSTORI_H",
    `EID_DEL_STAVBE='${eidDelStavbe}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return [];

  return data.features.map((f) => {
    const p = f.properties;
    return {
      vrsta: VRSTA_PROSTORA[p.VRSTA_PROSTORA_ID as number] ?? "Drugo",
      povrsina: (p.POVRSINA as number) || null,
    };
  });
}

export async function getBuildingParts(
  eidStavba: string,
): Promise<DelStavbeData[]> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:DELI_STAVB",
    `EID_STAVBA='${eidStavba}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return [];

  // First pass: parse parts and collect EIDs for room queries
  const parts = data.features.map((f) => {
    const p = f.properties;
    return {
      stDelaStavbe: p.ST_DELA_STAVBE as number,
      eidDelStavbe: String(p.EID_DEL_STAVBE),
      povrsina: (p.POVRSINA as number) || null,
      uporabnaPovrsina: (p.UPORABNA_POVRSINA as number) || null,
      vrsta:
        VRSTA_DEJANSKE_RABE[p.VRSTA_DEJANSKE_RABE_DEL_ST_ID as number] ??
        "Neznano",
      letoObnoveInstalacij: (p.LETO_OBNOVE_INSTALACIJ as number) || null,
      letoObnoveOken: (p.LETO_OBNOVE_OKEN as number) || null,
      dvigalo: wfsBool(p.DVIGALO),
      prostori: [] as ProstorData[],
      etazaDelStavbe: p.ETAZE_DELA_STAVBE != null ? (p.ETAZE_DELA_STAVBE as number) : null,
      vrstaStanovanjaUradno: p.VRSTE_STANOVANJ_NAZIV_SL != null ? String(p.VRSTE_STANOVANJ_NAZIV_SL) : null,
    };
  });

  // Fetch rooms for all parts in parallel
  const roomResults = await Promise.all(
    parts.map((part) => getRooms(part.eidDelStavbe)),
  );
  for (let i = 0; i < parts.length; i++) {
    parts[i].prostori = roomResults[i];
  }

  return parts;
}

// --- Parcel types ---

export interface ParcelaFullData {
  eidParcele: string;
  koId: number;
  stParcele: string;
  povrsina: number | null;
  vrstaRabe: string | null;
  geometry: Record<string, unknown> | null;
}

// --- Parcel lookups ---

export async function getParcelByNumber(
  koId: number,
  stParcele: string,
): Promise<ParcelaFullData | null> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:PARCELE_H",
    `KO_ID=${koId} AND ST_PARCELE='${stParcele}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;

  const f = data.features[0];
  const p = f.properties;
  return {
    eidParcele: String(p.EID_PARCELE),
    koId: p.KO_ID as number,
    stParcele: String(p.ST_PARCELE ?? stParcele),
    povrsina: (p.POVRSINA as number) || null,
    vrstaRabe: VRSTA_RABE[p.VRSTA_RABE_ID as number] ?? null,
    geometry: (f.geometry as Record<string, unknown>) ?? null,
  };
}

export async function getParcelById(
  eidParcele: string,
): Promise<ParcelaFullData | null> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:PARCELE_H",
    `EID_PARCELE='${eidParcele}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;

  const f = data.features[0];
  const p = f.properties;
  return {
    eidParcele,
    koId: p.KO_ID as number,
    stParcele: String(p.ST_PARCELE ?? ""),
    povrsina: (p.POVRSINA as number) || null,
    vrstaRabe: VRSTA_RABE[p.VRSTA_RABE_ID as number] ?? null,
    geometry: (f.geometry as Record<string, unknown>) ?? null,
  };
}

export async function getBuildingsByParcel(
  eidParcele: string,
): Promise<StavbaData[]> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:STAVBE_H",
    `EID_PARCELE='${eidParcele}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return [];

  return data.features.map((feat) => {
    const p = feat.properties;
    return {
      koId: p.KO_ID as number,
      stStavbe: p.ST_STAVBE as number,
      eidStavba: String(p.EID_STAVBA),
      letoIzgradnje: (p.LETO_IZGRADNJE as number) || null,
      letoObnoveFasade: (p.LETO_OBNOVE_FASADE as number) || null,
      letoObnoveStrehe: (p.LETO_OBNOVE_STREHE as number) || null,
      steviloEtaz: (p.STEVILO_ETAZ as number) || null,
      steviloStanovanj: (p.STEVILO_STANOVANJ as number) || null,
      brutoTlorisnaPovrsina: (p.BRUTO_TLORISNA_POVRSINA as number) || null,
      elektrika: wfsBool(p.ELEKTRIKA),
      plin: wfsBool(p.PLIN),
      vodovod: wfsBool(p.VODOVOD),
      kanalizacija: wfsBool(p.KANALIZACIJA),
      nosilnaKonstrukcija:
        NOSILNA_KONSTRUKCIJA[p.NOSILNA_KONSTRUKCIJA_ID as number] ?? null,
      tipStavbe: TIP_STAVBE[p.TIP_STAVBE_ID as number] ?? null,
      datumSys: p.DATUM_SYS ? String(p.DATUM_SYS) : null,
      visina: (p.VISINA_H2 != null && p.VISINA_H3 != null) ? (p.VISINA_H2 as number) - (p.VISINA_H3 as number) : null,
      tipPolozaja: null,
      kompaktnost: null,
      orientacija: null,
      obrisGeom: null,
    };
  });
}

// --- Zemljišče šifrant ---

const VRSTA_RABE: Record<number, string> = {
  1: "Njiva",
  2: "Vrt",
  6: "Travnik",
  21: "Gozd",
  30: "Pozidano stavišče",
  31: "Cesta",
  39: "Park",
  41: "Ostalo",
};

// --- Parcele & REN types ---

export interface ParcelaData {
  parcelnaStevila: string;
  povrsina: number | null;
  vrstaRabe: string | null;
  boniteta: number | null;
  katastrskiRazred: number | null;
  katastrskiDohodek: number | null;
  geometry?: Record<string, unknown> | null;
}

export interface RenVrednostData {
  vrednost: number;
  datumOcene: string;
}

// --- Parcele lookup ---

export async function getParcele(
  koId: number,
  stStavbe: number,
  lat?: number | null,
  lng?: number | null,
  obrisGeom?: { type: "Polygon"; coordinates: number[][][] } | null,
): Promise<ParcelaData[]> {
  // First: get STAVBE_TABELA to find parcel link
  const stavbaUrl = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:STAVBE_H",
    `KO_ID=${koId} AND ST_STAVBE=${stStavbe}`,
  );
  const stavbaData = await fetchWfs(stavbaUrl);

  let parceleData: WfsResponse | null = null;

  if (stavbaData && stavbaData.features.length > 0) {
    const p = stavbaData.features[0].properties;
    const parcelaRef = p.PARCELA ?? p.ST_PARCELE;

    if (parcelaRef != null) {
      const parceleUrl = buildWfsUrl(BASE_KN, "SI.GURS.KN:PARCELE_H", `KO_ID=${koId} AND ST_PARCELE='${parcelaRef}'`) + "&SRSNAME=EPSG:4326";
      parceleData = await fetchWfs(parceleUrl);
    }
  }

  // Fallback: try linking by ST_STAVBE
  if (!parceleData || parceleData.features.length === 0) {
    const fallbackUrl = buildWfsUrl(BASE_KN, "SI.GURS.KN:PARCELE_H", `KO_ID=${koId} AND ST_STAVBE=${stStavbe}`) + "&SRSNAME=EPSG:4326";
    parceleData = await fetchWfs(fallbackUrl);
  }

  // Fallback 2: BBOX + point-in-polygon filter (INTERSECTS v GURS WFS ne deluje z EPSG:4326)
  if ((!parceleData || parceleData.features.length === 0) && lat != null && lng != null) {
    const d = 0.001; // ~100m BBOX
    const bboxUrl = buildWfsUrl(
      BASE_KN,
      "SI.GURS.KN:PARCELE_H",
      `KO_ID=${koId} AND BBOX(GEOM,${lng - d},${lat - d},${lng + d},${lat + d},'EPSG:4326')`,
    ) + "&SRSNAME=EPSG:4326";
    const bboxData = await fetchWfs(bboxUrl).catch(() => null);
    if (bboxData && bboxData.features.length > 0) {
      const buildingRing = obrisGeom?.coordinates?.[0];
      const totalPts = buildingRing?.length ?? 0;

      // Oceni površino tlorisa stavbe (Shoelace formula, m²) za določitev max velikosti parcele
      let buildingAreaM2 = 0;
      if (buildingRing && buildingRing.length > 2) {
        let area = 0;
        for (let i = 0, j = buildingRing.length - 1; i < buildingRing.length; j = i++) {
          area += (buildingRing[j][0] + buildingRing[i][0]) * (buildingRing[j][1] - buildingRing[i][1]);
        }
        // Convert degrees² → m² (approx: 1° lat ≈ 111320m, 1° lng ≈ 71000m at 46°N)
        buildingAreaM2 = Math.abs(area) / 2 * 111320 * 71000;
      }
      // Max parcela: 15x površina stavbe ali vsaj 3000m² (za majhne stavbe), max 8000m²
      const maxParcelaArea = buildingAreaM2 > 0
        ? Math.min(Math.max(buildingAreaM2 * 15, 3000), 8000)
        : 4000;

      const scored = bboxData.features.map((f) => {
        const geom = f.geometry as { type: string; coordinates: number[][][] } | null;
        if (!geom || geom.type !== "Polygon") return { f, score: 0, hasCenter: false, area: Infinity };
        const parcelRing = geom.coordinates[0];
        const hasCenter = pointInPolygon([lng, lat], parcelRing);
        const area = (f.properties?.POVRSINA as number) ?? Infinity;
        if (buildingRing && totalPts > 0) {
          const hits = buildingRing.filter(pt => pointInPolygon(pt as [number, number], parcelRing)).length;
          return { f, score: hits, hasCenter, area };
        }
        return { f, score: hasCenter ? 1 : 0, hasCenter, area };
      });

      // Strategija: vertex score ima prednost (reka/cesta dobi 0 scored ker stavbni tloris ni nad njo)
      // Fallback: center containment za stavbe brez tlorisa
      const threshold = Math.max(1, Math.round(totalPts * 0.25));
      const byScore = scored
        .filter(x => x.score >= threshold && x.area <= maxParcelaArea)
        .sort((a, b) => b.score !== a.score ? b.score - a.score : a.area - b.area)
        .slice(0, 2).map(x => x.f);

      if (byScore.length > 0) {
        parceleData = { ...bboxData, features: byScore };
      } else {
        // Ni tlorisa ali vertex match — vzemi najmanjšo parcelo znotraj maxParcelaArea ki vsebuje center
        const centerParcels = scored
          .filter(x => x.hasCenter && x.area <= maxParcelaArea)
          .sort((a, b) => a.area - b.area);
        if (centerParcels.length > 0) {
          parceleData = { ...bboxData, features: [centerParcels[0].f] };
        } else {
          // Nič razumnega — ne prikaži napačne parcele
          parceleData = { ...bboxData, features: [] };
        }
      }
    }
  }

  if (!parceleData || parceleData.features.length === 0) return [];

  return parceleData.features.map((f) => {
    const fp = f.properties;
    return {
      parcelnaStevila: String(fp.ST_PARCELE ?? ""),
      povrsina: (fp.POVRSINA as number) || null,
      vrstaRabe: VRSTA_RABE[fp.VRSTA_RABE_ID as number] ?? null,
      boniteta: (fp.BONITETA_TALA as number) || null,
      katastrskiRazred: (fp.KATASTRSKI_RAZRED as number) || null,
      katastrskiDohodek: (fp.KATASTRSKI_DOHODEK as number) || null,
      geometry: (f.geometry as Record<string, unknown>) ?? null,
    };
  });
}

// --- REN vrednost ---

export async function getRenVrednost(
  koId: number,
  stStavbe: number,
): Promise<RenVrednostData | null> {
  try {
    const url = buildWfsUrl(
      BASE_RPE,
      "SI.GURS.REN:VREDNOST_NEPREMICNINE",
      `KO_ID=${koId} AND ST_STAVBE=${stStavbe}`,
    );
    const data = await fetchWfs(url);
    if (!data || data.features.length === 0) return null;

    const p = data.features[0].properties;
    const vrednost =
      (p["POSPLOŠENA_TRŽNA_VREDNOST"] as number) ??
      (p.VREDNOST as number) ??
      null;
    const datumOcene = p.DATUM_OCENE ? String(p.DATUM_OCENE) : "";

    if (vrednost == null) return null;
    return { vrednost, datumOcene };
  } catch {
    return null;
  }
}

/** Parse "Slovenčeva ulica 4A" → { street, number, suffix } */
export function parseAddress(raw: string): {
  street: string;
  number: string;
  suffix?: string;
} | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+(\d+)\s*([A-Za-z]?)$/);
  if (!match) return null;
  return {
    street: match[1].trim(),
    number: match[2],
    suffix: match[3] ? match[3].toUpperCase() : undefined,
  };
}

/** Full lookup chain: address string → building + parts with rooms */
export async function lookupByAddress(address: string): Promise<{
  stavba: StavbaData;
  deliStavbe: DelStavbeData[];
  lat: number | null;
  lng: number | null;
} | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;

  const ulMid = await getStreetId(parsed.street);

  // Fallback za podeželske naslove brez ulice (npr. "Spodnje Loke 30")
  let hsResult;
  if (!ulMid) {
    hsResult = await getHouseBySettlement(parsed.street, parsed.number, parsed.suffix);
  } else {
    hsResult = await getHouseNumberId(ulMid, parsed.number, parsed.suffix);
  }
  if (!hsResult) return null;

  const eidStavba = await getBuildingEid(hsResult.hsMid);
  if (!eidStavba) return null;

  const [stavba, deliStavbe] = await Promise.all([
    getBuilding(eidStavba),
    getBuildingParts(eidStavba),
  ]);

  if (!stavba) return null;
  return { stavba, deliStavbe, lat: hsResult.lat, lng: hsResult.lng };
}

// --- Ownership (JV WFS endpoint) ---

const TIP_LASTNISTVA: Record<number, string> = {
  1: "Lastninsko pravo",
  2: "Solastninsko pravo",
  3: "Skupna lastnina",
};

export interface OwnershipRight {
  tipLastnistva: string;
  tipOsebe: "Pravna oseba" | "Fizična oseba";
  delez: string;
  datumVpisa: string;
  nazivPravneOsebe: string | null;
}

function buildJvWfsUrl(typeName: string, cqlFilter: string): string {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: typeName,
    OUTPUTFORMAT: "application/json",
    REFERER_APP_CODE: "JV",
    CQL_FILTER: cqlFilter,
  });
  return `${BASE_KN_JV}?${params.toString()}`;
}

export async function getOwnership(
  eidDelStavbe: string,
): Promise<OwnershipRight[]> {
  // Fetch ownership rights and legal entity ownership in parallel
  const rightsUrl = buildJvWfsUrl(
    "SI.GURS.KN:PRAVICE_LASTNISTVA_H",
    `EID_DEL_STAVBE='${eidDelStavbe}' AND STATUS_VELJAVNOSTI='V'`,
  );
  const legalUrl = buildJvWfsUrl(
    "SI.GURS.KN:LASTNISTVO_PRAVNIH_OSEB",
    `EID_DEL_STAVBE='${eidDelStavbe}'`,
  );

  const [rightsData, legalData] = await Promise.all([
    fetchWfs(rightsUrl),
    fetchWfs(legalUrl),
  ]);

  // Build set of legal entity ownership IDs for cross-reference
  const legalMap = new Map<number, string>();
  if (legalData) {
    for (const f of legalData.features) {
      const p = f.properties;
      legalMap.set(
        p.OSEBA_ID as number,
        (p.NAZIV as string) ?? "Pravna oseba",
      );
    }
  }

  if (!rightsData || rightsData.features.length === 0) {
    // If no rights data but we have legal entity data, show that
    if (legalData && legalData.features.length > 0) {
      return legalData.features.map((f) => {
        const p = f.properties;
        return {
          tipLastnistva: TIP_LASTNISTVA[p.TIP_LASTNISTVA as number] ?? "Lastninsko pravo",
          tipOsebe: "Pravna oseba",
          delez: "1/1",
          datumVpisa: "",
          nazivPravneOsebe: (p.NAZIV as string) ?? null,
        };
      });
    }
    return [];
  }

  return rightsData.features.map((f) => {
    const p = f.properties;
    const stevec = (p.DELEZ_STEVEC as number) ?? 1;
    const imenovalec = (p.DELEZ_IMENOVALEC as number) ?? 1;
    const datumVpisa = p.DATUM_VPISA ? String(p.DATUM_VPISA) : "";
    const isLegal = legalMap.size > 0;

    return {
      tipLastnistva: TIP_LASTNISTVA[p.TIP_LASTNISTVA as number] ?? "Lastninsko pravo",
      tipOsebe: isLegal ? ("Pravna oseba" as const) : ("Fizična oseba" as const),
      delez: `${stevec}/${imenovalec}`,
      datumVpisa,
      nazivPravneOsebe: isLegal ? (legalMap.values().next().value ?? null) : null,
    };
  });
}

// --- ZK GJI: Gas Infrastructure ---

const BASE_KGI = "https://ipi.eprostor.gov.si/wfs-si-gurs-kgi/wfs";

export type GasConfidence = "high" | "medium" | "low" | "none";

/**
 * Preveri plinsko infrastrukturo v bližini z razdaljo in confidence nivojem.
 * Prag: <20m = visoka (verjetno priključen), 20-80m = srednja (v bližini), >80m = none
 */
export async function checkGasInfrastructure(
  lat: number,
  lng: number,
): Promise<{ found: boolean; distanceM: number | null; confidence: GasConfidence }> {
  // Iščemo v ~200m BBOX, da dobimo vse plinovode v okolici
  const latBuf = 0.0018; // ~200m
  const lngBuf = 0.0025;

  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "SI.GURS.KGI:LINIJE_ZEMELJSKI_PLIN_G",
    OUTPUTFORMAT: "application/json",
    COUNT: "10",
    SRSNAME: "EPSG:4326",
    CQL_FILTER: `BBOX(GEOM,${lng - lngBuf},${lat - latBuf},${lng + lngBuf},${lat + latBuf},'EPSG:4326')`,
  });

  try {
    const url = `${BASE_KGI}?${params.toString()}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return { found: false, distanceM: null, confidence: "none" };
    const data = await res.json();
    if (!data?.features?.length) return { found: false, distanceM: null, confidence: "none" };

    // Izračunaj minimalno razdaljo do kateregakoli segmenta plinovoda
    let minDistM = Infinity;
    for (const f of data.features) {
      const geom = f.geometry as { type: string; coordinates: number[][] | number[][][] } | null;
      if (!geom) continue;
      const lines: number[][][] = geom.type === "LineString"
        ? [geom.coordinates as number[][]]
        : geom.type === "MultiLineString" ? geom.coordinates as number[][][] : [];
      for (const line of lines) {
        for (const [pLng, pLat] of line) {
          // Haversine approx (m) za kratke razdalje
          const dLat = (pLat - lat) * 111320;
          const dLng = (pLng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
          const d = Math.sqrt(dLat * dLat + dLng * dLng);
          if (d < minDistM) minDistM = d;
        }
      }
    }

    const distanceM = Math.round(minDistM);
    let confidence: GasConfidence;
    if (distanceM < 25) confidence = "high";
    else if (distanceM < 100) confidence = "medium";
    else confidence = "low";

    return { found: true, distanceM, confidence };
  } catch {
    return { found: false, distanceM: null, confidence: "none" };
  }
}

export async function getTipPolozajaStavbe(
  eidStavba: string,
  koId: number,
): Promise<TipPolozajaStavbe> {
  try {
    // Najprej pridobi bounding box te stavbe
    const stavbaUrl = buildWfsUrl(
      BASE_KN,
      "SI.GURS.KN:STAVBE_H",
      `EID_STAVBA='${eidStavba}' AND STATUS_VELJAVNOSTI='V'`,
    );
    const stavbaData = await fetchWfs(stavbaUrl);
    if (!stavbaData?.features?.[0]) return null;

    const geom = stavbaData.features[0].properties?.OBRIS_GEOM as any;
    if (!geom || geom.type !== "Polygon") return null;

    // Izračunaj BBOX z 1.5m bufferjem
    const coords = geom.coordinates[0] as [number, number][];
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const buf = 1.5;
    const minX = Math.min(...xs) - buf;
    const maxX = Math.max(...xs) + buf;
    const minY = Math.min(...ys) - buf;
    const maxY = Math.max(...ys) + buf;

    // Poišči sosednje stavbe v BBOX (ista KO)
    const sosediUrl = buildWfsUrl(
      BASE_KN,
      "SI.GURS.KN:STAVBE_H",
      `BBOX(OBRIS_GEOM,${minX},${minY},${maxX},${maxY},'EPSG:3794') AND KO_ID=${koId} AND STATUS_VELJAVNOSTI='V' AND EID_STAVBA<>'${eidStavba}'`,
    );
    const sosediData = await fetchWfs(sosediUrl);
    const steviloSosedov = sosediData?.features?.length ?? 0;

    if (steviloSosedov === 0) return "samostojna";
    if (steviloSosedov === 1) return "vogalna";
    return "vmesna vrstna";
  } catch {
    return null;
  }
}

// --- Ocena stanja stavbe (condition score) ---

export interface OcenaStanja {
  ocena: number; // 0-100
  opis: string;
  razred: "odlično" | "dobro" | "srednje" | "slabše" | "slabo";
  color: "green" | "lime" | "amber" | "orange" | "red";
}

const LIFESPAN: Record<string, number> = {
  "Masivna (kamen, opeka)": 80,
  "Armiran beton": 80,
  "Montažna": 40,
  "Lesena": 60,
  "Jeklo": 70,
  "Kombinirana": 60,
};

const DEFAULT_LIFESPAN = 65;

export function izracunajOcenaStanja(stavba: {
  letoIzgradnje: number | null;
  letoObnove?: { fasade: number | null; strehe: number | null } | null;
  konstrukcija?: string | null;
}): OcenaStanja | null {
  if (!stavba.letoIzgradnje) return null;

  const leto = new Date().getFullYear();
  const lifespan = LIFESPAN[stavba.konstrukcija ?? ""] ?? DEFAULT_LIFESPAN;

  // Efektivna starost: upoštevaj renovacije kot delno pomlajenje
  let starostBase = leto - stavba.letoIzgradnje;

  // Renovacije zmanjšajo efektivno starost
  const renovacij = [stavba.letoObnove?.fasade, stavba.letoObnove?.strehe].filter(Boolean) as number[];
  if (renovacij.length > 0) {
    const zadnjaRenovacija = Math.max(...renovacij);
    const starostPoRenovaciji = leto - zadnjaRenovacija;
    // Vsaka renovacija "pomladiti" stavbo za 30% efektivne starosti
    const bonus = (starostBase - starostPoRenovaciji) * 0.3;
    starostBase = starostBase - bonus;
  }

  const ratio = Math.min(starostBase / lifespan, 0.70);
  const ocena = Math.round((1 - ratio) * 100);

  let razred: OcenaStanja["razred"];
  let color: OcenaStanja["color"];
  let opis: string;

  if (ocena >= 80) {
    razred = "odlično"; color = "green";
    opis = "Stavba je v odličnem stanju glede na starost in tip konstrukcije.";
  } else if (ocena >= 60) {
    razred = "dobro"; color = "lime";
    opis = "Stavba je v dobrem stanju. Manjše vzdrževanje je pričakovano.";
  } else if (ocena >= 40) {
    razred = "srednje"; color = "amber";
    opis = "Stavba kaže znake staranja. Priporoča se pregled ključnih komponent.";
  } else if (ocena >= 20) {
    razred = "slabše"; color = "orange";
    opis = "Stavba je v slabšem stanju. Večja investicija v prenovo je verjetna.";
  } else {
    razred = "slabo"; color = "red";
    opis = "Stavba je v slabem stanju. Celovita prenova je nujno potrebna.";
  }

  return { ocena, opis, razred, color };
}
