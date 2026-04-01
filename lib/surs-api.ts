/**
 * SURS PxWeb API — Indeksi cen stanovanjskih nepremicnin
 * Vir: https://pxweb.stat.si/SiStatData/api/v1/sl/Data/
 * Brez API kljuca, CC BY 4.0
 */

export interface SursMarketTrends {
  // Zadnje razpolozljivo cetrtletje (npr. "2025Q4")
  zadnjeCetrtletje: string;
  // YoY indeksi (baza 100 = isto cetrtl. preteklega leta)
  indeksiYoY: {
    skupaj: number | null;
    rabljenaStan: number | null;
    rabljenaStanLjubljanica: number | null; // MOL
    rabljeneDruzinskeHise: number | null;
  };
  // Zadnjih N cetrtletij za trend sparkline
  trend: Array<{
    cetrtletje: string;
    skupajYoY: number | null;
  }>;
  // Clovesko berljiv povzetek
  povzetek: string;
  vir: "SURS";
  posodobljeno: string;
}

const BASE = "https://pxweb.stat.si/SiStatData/api/v1/sl/Data";

// Cache 6h — trg se ne spreminja po urah
const cache = new Map<string, { data: SursMarketTrends; ts: number }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function getSursMarketTrends(): Promise<SursMarketTrends | null> {
  const cacheKey = "surs-trends";
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.data;

  try {
    const resp = await fetch(`${BASE}/0419001S.px`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: [
          {
            code: "STANOVANJSKE NEPREMIČNINE",
            selection: {
              filter: "item",
              values: ["1", "1.2.1", "1.2.1.1", "1.2.2"],
            },
          },
          {
            code: "ČETRTLETJE",
            selection: { filter: "top", values: ["6"] },
          },
          {
            code: "INDEKS",
            selection: { filter: "item", values: ["3"] },
          },
        ],
        response: { format: "json-stat2" },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) return null;
    const d = await resp.json();

    // Parse json-stat2: dimensions = [nepremicnina x cetrtletje x indeks]
    const nepDim: Record<string, number> = d.dimension["STANOVANJSKE NEPREMIČNINE"]?.category?.index ?? {};
    const cetDim: Record<string, number> = d.dimension["ČETRTLETJE"]?.category?.index ?? {};
    const vals: (number | null)[] = d.value ?? [];

    const nepKeys = Object.keys(nepDim).sort((a, b) => nepDim[a] - nepDim[b]);
    const cetKeys = Object.keys(cetDim).sort((a, b) => cetDim[a] - cetDim[b]);
    const nCet = cetKeys.length;

    // Indeks za (nepremicnina_idx, cetrtletje_idx) -> vals[nep_idx * nCet + cet_idx]
    const getVal = (nep: string, cet: string): number | null => {
      const ni = nepDim[nep];
      const ci = cetDim[cet];
      if (ni == null || ci == null) return null;
      const v = vals[ni * nCet + ci];
      return v == null ? null : Number(v);
    };

    const zadnjeCetrtletje = cetKeys[cetKeys.length - 1] ?? "?";

    const indeksiYoY = {
      skupaj: getVal("1", zadnjeCetrtletje),
      rabljenaStan: getVal("1.2.1", zadnjeCetrtletje),
      rabljenaStanLjubljanica: getVal("1.2.1.1", zadnjeCetrtletje),
      rabljeneDruzinskeHise: getVal("1.2.2", zadnjeCetrtletje),
    };

    const trend = cetKeys.map((cet) => ({
      cetrtletje: cet,
      skupajYoY: getVal("1", cet),
    }));

    // Clovesko berljiv povzetek
    const yoy = indeksiYoY.skupaj;
    const pct = yoy != null ? (yoy - 100).toFixed(1) : null;
    const smer = yoy != null ? (yoy > 100 ? "+" : "") : "";
    const povzetek =
      yoy != null
        ? `Cene stanovanjskih nepremicnin v Sloveniji so v ${zadnjeCetrtletje} ${smer}${pct}% YoY (baza: SURS).`
        : "Trendi cen trenutno niso na voljo.";

    const result: SursMarketTrends = {
      zadnjeCetrtletje,
      indeksiYoY,
      trend,
      povzetek,
      vir: "SURS",
      posodobljeno: d.updated ?? "",
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}
