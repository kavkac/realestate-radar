import { getCached, setCached } from "./wfs-cache";

const BASE_RPE = "https://storitve.eprostor.gov.si/ows-pub-wfs/wfs";
const BASE_KN = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn-osnovni/wfs";
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
}

export interface RenVrednostData {
  vrednost: number;
  datumOcene: string;
}

// --- Parcele lookup ---

export async function getParcele(
  koId: number,
  stStavbe: number,
): Promise<ParcelaData[]> {
  // First: get STAVBE_TABELA to find parcel link
  const stavbaUrl = buildWfsUrl(
    BASE_KN,
    "SI.GURS.KN:STAVBE_TABELA",
    `KO_ID=${koId} AND ST_STAVBE=${stStavbe}`,
  );
  const stavbaData = await fetchWfs(stavbaUrl);

  let parceleData: WfsResponse | null = null;

  if (stavbaData && stavbaData.features.length > 0) {
    const p = stavbaData.features[0].properties;
    const parcelaRef = p.PARCELA ?? p.ST_PARCELE;

    if (parcelaRef != null) {
      const parceleUrl = buildWfsUrl(
        BASE_KN,
        "SI.GURS.KN:PARCELE_TABELA",
        `KO_ID=${koId} AND ST_PARCELE='${parcelaRef}'`,
      );
      parceleData = await fetchWfs(parceleUrl);
    }
  }

  // Fallback: try linking by ST_STAVBE
  if (!parceleData || parceleData.features.length === 0) {
    const fallbackUrl = buildWfsUrl(
      BASE_KN,
      "SI.GURS.KN:PARCELE_TABELA",
      `KO_ID=${koId} AND ST_STAVBE=${stStavbe}`,
    );
    parceleData = await fetchWfs(fallbackUrl);
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
  if (!ulMid) return null;

  const hsResult = await getHouseNumberId(ulMid, parsed.number, parsed.suffix);
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
