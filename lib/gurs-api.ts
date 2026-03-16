const BASE_RPE = "https://storitve.eprostor.gov.si/ows-pub-wfs/wfs";
const BASE_KN = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn-osnovni/wfs";

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
  47: "Stanovanje (starejši zapis)",
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
  });
  return `${base}?${params.toString()}`;
}

async function fetchWfs(url: string): Promise<WfsResponse | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// --- Public API ---

export async function getStreetId(streetName: string): Promise<number | null> {
  const url = buildWfsUrl(
    BASE_RPE,
    "SI.GURS.RPE:UL_G",
    `UL_UIME LIKE '${streetName}'`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;
  return data.features[0].properties.UL_MID as number;
}

export async function getHouseNumberId(
  ulMid: number,
  houseNumber: string,
  suffix?: string,
): Promise<number | null> {
  let filter = `UL_MID=${ulMid} AND HS=${houseNumber}`;
  if (suffix) {
    filter += ` AND HD='${suffix}'`;
  }
  const url = buildWfsUrl(BASE_RPE, "SI.GURS.RPE:HS_G", filter);
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;
  return data.features[0].properties.HS_MID as number;
}

export async function getBuildingEid(hsMid: number): Promise<string | null> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:HISNE_STEVILKE_TABELA",
    `ST_HS=${hsMid}`,
  );
  const data = await fetchWfs(url);
  if (!data || data.features.length === 0) return null;
  return String(data.features[0].properties.EID_STAVBA);
}

export async function getBuilding(
  eidStavba: string,
): Promise<StavbaData | null> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:STAVBE_TABELA",
    `EID_STAVBA='${eidStavba}'`,
  );
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
  };
}

export async function getRooms(eidDelStavbe: string): Promise<ProstorData[]> {
  const url = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:PROSTORI_TABELA",
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
    "SI.GURS.KN:DELI_STAVB_TABELA",
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
} | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;

  const ulMid = await getStreetId(parsed.street);
  if (!ulMid) return null;

  const hsMid = await getHouseNumberId(ulMid, parsed.number, parsed.suffix);
  if (!hsMid) return null;

  const eidStavba = await getBuildingEid(hsMid);
  if (!eidStavba) return null;

  const [stavba, deliStavbe] = await Promise.all([
    getBuilding(eidStavba),
    getBuildingParts(eidStavba),
  ]);

  if (!stavba) return null;
  return { stavba, deliStavbe };
}
