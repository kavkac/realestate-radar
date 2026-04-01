// gurs-ogc.ts - GURS OGC Features API connectors (REST/JSON, CC BY 4.0)
// Docs: https://ipi.eprostor.gov.si/wfs-si-gurs-rn/ogc/features/collections
// Per-lookup (not bulk) - called on property detail page.
// Complements gurs-api.ts which uses older WFS XML endpoints.

const OGC_TIMEOUT_MS = 5000;
const RN_BASE = "https://ipi.eprostor.gov.si/wfs-si-gurs-rn/ogc/features/collections";
const KN_BASE = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/ogc/features/collections";

async function ogcFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(OGC_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OGC ${res.status}: ${url}`);
  return res.json();
}

// REGISTER NASLOVOV - address geocoding

export interface GursNaslov {
  eid_naslov: string | null;
  ulica: string | null;
  hs_stevilka: string | null;
  naselje: string | null;
  obcina: string | null;
  postni_okolis: string | null;
  postna_st: number | null;
  e: number | null;  // D96/TM easting
  n: number | null;  // D96/TM northing
}

export async function getGursNasloviForStavba(eidStavba: string | number): Promise<GursNaslov[]> {
  try {
    const url = `${RN_BASE}/SI.GURS.RN:REGISTER_NASLOVOV/items?filter=EID_STAVBA='${eidStavba}'&limit=20`;
    const data = (await ogcFetch(url)) as { features?: Array<{ properties: Record<string, unknown> }> };
    return (data.features ?? []).map(f => {
      const p = f.properties;
      const hs = [p.HS_STEVILKA, p.HS_DODATEK].filter(Boolean).join("");
      return {
        eid_naslov: String(p.EID_NASLOV ?? ""),
        ulica: (p.ULICA_NAZIV as string) ?? null,
        hs_stevilka: hs || null,
        naselje: (p.NASELJE_NAZIV as string) ?? null,
        obcina: (p.OBCINA_NAZIV as string) ?? null,
        postni_okolis: (p.POSTNI_OKOLIS_NAZIV as string) ?? null,
        postna_st: (p.POSTNI_OKOLIS_SIFRA as number) ?? null,
        e: (p.E as number) ?? null,
        n: (p.N as number) ?? null,
      };
    });
  } catch {
    return [];
  }
}

// STAVBE - building metadata from OGC Features

export interface GursStavbaOgc {
  eid_stavba: string | null;
  ko_id: number | null;
  st_stavbe: number | null;
  stevilo_etaz: number | null;
  stevilo_stanovanj: number | null;
  stevilo_poslovnih: number | null;
  bruto_tlorisna_povrsina: number | null;
  tip_stavbe_naziv: string | null;
}

export async function getGursStavbaOgc(eidStavba: string | number): Promise<GursStavbaOgc | null> {
  try {
    const url = `${KN_BASE}/SI.GURS.KN:STAVBE/items?filter=EID_STAVBA='${eidStavba}'&limit=1`;
    const data = (await ogcFetch(url)) as { features?: Array<{ properties: Record<string, unknown> }> };
    const feat = data.features?.[0];
    if (!feat) return null;
    const p = feat.properties;
    return {
      eid_stavba: String(p.EID_STAVBA ?? p.EID ?? ""),
      ko_id: (p.KO_ID as number) ?? null,
      st_stavbe: (p.ST_STAVBE as number) ?? null,
      stevilo_etaz: (p.STEVILO_ETAZ as number) ?? null,
      stevilo_stanovanj: (p.STEVILO_STANOVANJ as number) ?? null,
      stevilo_poslovnih: (p.STEVILO_POSLOVNIH_PROSTOROV as number) ?? null,
      bruto_tlorisna_povrsina: (p.BRUTO_TLORISNA_POVRSINA as number) ?? null,
      tip_stavbe_naziv: (p.TIPI_STAVB_NAZIV_SL as string) ?? null,
    };
  } catch {
    return null;
  }
}

// DELI STAVB - units/apartments in building

export interface GursDelStavbeOgc {
  eid_del: string;
  nadstropje: number | null;
  neto_tlorisna_povrsina: number | null;
  stevilo_sob: number | null;
  namembnost_naziv: string | null;
}

export async function getGursDeliStavbOgc(eidStavba: string | number): Promise<GursDelStavbeOgc[]> {
  try {
    const url = `${KN_BASE}/SI.GURS.KN:DELI_STAVB/items?filter=EID_STAVBA='${eidStavba}'&limit=100`;
    const data = (await ogcFetch(url)) as { features?: Array<{ properties: Record<string, unknown> }> };
    return (data.features ?? []).map(f => {
      const p = f.properties;
      return {
        eid_del: String(p.EID ?? p.FEATUREID ?? ""),
        nadstropje: (p.LEGA_ID as number) ?? null,
        neto_tlorisna_povrsina: (p.NETO_TLORISNA_POVRSINA as number) ?? null,
        stevilo_sob: (p.STEVILO_SOB as number) ?? null,
        namembnost_naziv: (p.NAMEMBNOST_NAZIV_SL ?? p.NAMEMBNOST_NAZIV ?? null) as string | null,
      };
    });
  } catch {
    return [];
  }
}
