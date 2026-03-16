const BASE_RPE = "https://storitve.eprostor.gov.si/ows-pub-wfs/wfs";
const BASE_KN = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn-osnovni/wfs";

interface WfsFeature {
  type: string;
  properties: Record<string, unknown>;
  geometry?: Record<string, unknown>;
}

interface WfsResponse {
  type: string;
  features: WfsFeature[];
}

function buildWfsUrl(
  base: string,
  typeName: string,
  cqlFilter: string
): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: typeName,
    outputFormat: "application/json",
    CQL_FILTER: cqlFilter,
  });
  return `${base}?${params.toString()}`;
}

async function fetchWfs(url: string): Promise<WfsResponse> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`WFS request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export class GursAPI {
  /**
   * Poišče ID ulice po imenu.
   * Returns UL_MID from RPE ulice layer.
   */
  async getStreetId(streetName: string): Promise<number | null> {
    const url = buildWfsUrl(
      BASE_RPE,
      "SI.GURS.RPE:ULICA",
      `UL_UIME='${streetName}'`
    );
    const data = await fetchWfs(url);

    if (data.features.length === 0) return null;
    return data.features[0].properties.UL_MID as number;
  }

  /**
   * Poišče hišno številko po UL_MID in številki.
   * Returns HS_MID.
   */
  async getHouseNumber(
    ulMid: number,
    houseNumber: string,
    houseSuffix?: string
  ): Promise<number | null> {
    let filter = `UL_MID=${ulMid} AND HS=${houseNumber}`;
    if (houseSuffix) {
      filter += ` AND HD='${houseSuffix}'`;
    }

    const url = buildWfsUrl(BASE_RPE, "SI.GURS.RPE:HISNA_STEVILKA", filter);
    const data = await fetchWfs(url);

    if (data.features.length === 0) return null;
    return data.features[0].properties.HS_MID as number;
  }

  /**
   * Poišče ID stavbe (EID_STAVBA) po HS_MID.
   */
  async getBuildingId(hsMid: number): Promise<number | null> {
    const url = buildWfsUrl(
      BASE_RPE,
      "SI.GURS.RPE:NASLOV_STAVBA",
      `HS_MID=${hsMid}`
    );
    const data = await fetchWfs(url);

    if (data.features.length === 0) return null;
    return data.features[0].properties.EID_STAVBA as number;
  }

  /**
   * Pridobi podatke o stavbi iz katastra.
   */
  async getBuilding(
    eidStavba: number
  ): Promise<WfsFeature | null> {
    const url = buildWfsUrl(
      BASE_KN,
      "SI.GURS.KN.STAVBE:STAVBA_OSNOVNI",
      `EID_STAVBA=${eidStavba}`
    );
    const data = await fetchWfs(url);

    if (data.features.length === 0) return null;
    return data.features[0];
  }

  /**
   * Pridobi dele stavbe (enote).
   */
  async getBuildingParts(
    eidStavba: number
  ): Promise<WfsFeature[]> {
    const url = buildWfsUrl(
      BASE_KN,
      "SI.GURS.KN.STAVBE:DEL_STAVBE_OSNOVNI",
      `EID_STAVBA=${eidStavba}`
    );
    const data = await fetchWfs(url);

    return data.features;
  }
}

export const gursApi = new GursAPI();
