import { prisma } from "./prisma";
import { izracunajLokacijskiPremium, type LokacijskiPremium } from "./location-premium";

// === KALIBRACIJSKI FAKTORJI (backtest 19,183 ETN stanovanij 2021-2022 vs 2023-2024 mediane) ===
// Generirano avtomatsko — ne urejaj ročno. Ponovno generiraj z: calibration/backtest.py
const KO_KALIBRACIJSKI_FAKTOR: Record<string, number> = {
  "1005": -0.1340,
  "1026": -0.3500,
  "105": -0.0050,
  "1065": -0.3510,
  "1074": -0.0360,
  "1075": -0.0080,
  "1076": -0.1330,
  "1077": -0.0140,
  "1082": -0.1320,
  "1100": -0.1120,
  "1115": -0.1460,
  "1138": -0.0590,
  "1200": -0.0540,
  "1229": 0.2550,
  "1300": -0.1060,
  "1316": -0.1730,
  "1322": -0.0710,
  "1379": 0.0540,
  "1410": -0.0970,
  "1422": -0.0010,
  "1455": 0.0870,
  "1456": -0.1250,
  "1476": 0.1300,
  "1483": 0.0730,
  "1484": -0.1110,
  "1515": -0.1630,
  "1535": -0.0630,
  "1577": -0.1930,
  "1625": -0.0130,
  "1626": 0.0710,
  "1637": 0.1580,
  "1659": 0.2490,
  "166": -0.0070,
  "1676": -0.1710,
  "1695": -0.0930,
  "1697": -0.0320,
  "1700": -0.1080,
  "1720": 0.1050,
  "1721": -0.1580,
  "1722": -0.1990,
  "1723": -0.0740,
  "1725": -0.0740,
  "1726": 0.2100,
  "1727": 0.0960,
  "1728": -0.2340,
  "1730": -0.1090,
  "1732": -0.0570,
  "1734": -0.3760,
  "1735": -0.0280,
  "1736": -0.1490,
  "1737": -0.0180,
  "1738": -0.1160,
  "1739": 0.0080,
  "1740": -0.1580,
  "1749": 0.2480,
  "1751": 0.1590,
  "1753": -0.1670,
  "1754": -0.0510,
  "1755": 0.0580,
  "1756": 0.1210,
  "1757": -0.3170,
  "1761": -0.3660,
  "1770": 0.0540,
  "1772": 0.0000,
  "1773": -0.3790,
  "1783": -0.0400,
  "1784": -0.1840,
  "1786": 0.1860,
  "1810": -0.2860,
  "1812": 0.2320,
  "1820": 0.3290,
  "1835": -0.2390,
  "1838": -0.1950,
  "184": 0.0410,
  "1847": -0.1840,
  "1855": -0.1980,
  "1856": 0.3640,
  "1862": 0.1640,
  "1871": -0.0360,
  "1884": -0.3300,
  "1886": -0.0400,
  "1898": 0.3530,
  "1905": 0.1710,
  "1908": -0.0390,
  "1911": -0.0950,
  "1936": -0.1930,
  "1937": -0.1130,
  "1938": -0.0880,
  "1959": -0.0320,
  "1961": 0.1770,
  "1966": -0.0220,
  "1973": -0.2010,
  "1976": -0.0720,
  "199": -0.0480,
  "1994": -0.2880,
  "1996": 0.3250,
  "200": -0.1890,
  "2002": -0.0300,
  "2004": -0.2520,
  "2016": -0.2640,
  "2017": -0.0720,
  "2027": -0.2200,
  "2029": 0.0160,
  "2030": -0.1220,
  "2035": -0.1190,
  "2062": -0.1530,
  "2087": 0.0500,
  "2098": 0.1900,
  "2100": -0.0840,
  "2101": -0.2550,
  "2119": 0.3300,
  "2121": 0.0190,
  "2122": -0.1120,
  "2123": -0.1310,
  "2131": -0.0110,
  "2143": 0.1220,
  "2144": -0.1800,
  "2155": -0.0560,
  "2156": 0.0230,
  "2157": -0.1260,
  "2169": -0.0100,
  "2171": -0.1320,
  "2175": -0.0960,
  "2178": -0.3580,
  "2191": -0.0310,
  "2200": 0.0420,
  "2207": -0.2170,
  "2248": -0.1880,
  "2304": -0.0840,
  "2315": 0.0400,
  "2357": -0.2460,
  "2358": -0.0710,
  "2380": 0.1450,
  "2392": 0.0100,
  "2452": -0.3440,
  "2455": -0.0480,
  "2490": -0.2070,
  "2501": -0.0160,
  "2524": 0.1080,
  "2525": 0.2030,
  "2560": -0.0010,
  "259": -0.1600,
  "2593": -0.2550,
  "2594": -0.2660,
  "2595": -0.2580,
  "2604": -0.0640,
  "2605": -0.2030,
  "2606": -0.1920,
  "2612": 0.3300,
  "2626": -0.0960,
  "2630": -0.1360,
  "2631": 0.0070,
  "2632": -0.0590,
  "2635": 0.1110,
  "2636": -0.1190,
  "2677": -0.1790,
  "2679": -0.0910,
  "2680": -0.0980,
  "2682": -0.0820,
  "2706": 0.1750,
  "332": -0.0570,
  "392": -0.1350,
  "400": -0.2080,
  "425": 0.1270,
  "520": -0.0530,
  "532": 0.0070,
  "564": -0.2380,
  "566": -0.1560,
  "636": -0.2200,
  "638": -0.2320,
  "653": 0.2530,
  "655": -0.0300,
  "657": 0.0000,
  "658": -0.0640,
  "659": -0.0800,
  "660": -0.2580,
  "661": 0.2020,
  "663": -0.1310,
  "665": -0.1210,
  "676": -0.1910,
  "677": -0.1760,
  "678": -0.0050,
  "680": -0.0370,
  "681": -0.0450,
  "693": 0.0720,
  "716": -0.1210,
  "753": -0.1390,
  "804": 0.2190,
  "808": -0.1050,
  "829": 0.1510,
  "850": 0.0890,
  "864": 0.1510,
  "882": -0.0490,
  "884": 0.1610,
  "889": -0.1390,
  "906": 0.3060,
  "92": -0.1460,
  "920": -0.2250,
  "959": -0.1870,
  "964": -0.0750,
  "992": 0.1200,
  "995": 0.1370,
  "996": -0.2830,
  "997": 0.0140,
};

// Površinski korekcijski faktor (backtest: bias po area bracketih)
function povrsinskaKorekcija(povrsina: number): number {
  if (povrsina > 150) return -0.25;  // bias +34.6% → popravek
  if (povrsina > 120) return -0.20;
  if (povrsina > 90)  return -0.10;
  if (povrsina < 25)  return +0.05;  // majhne enote blago podcenjene
  return 0;
}


// Energetski korekcijski faktorji za oceno tržne vrednosti
const ENERGY_CORRECTION: Record<string, number> = {
  A1: 0.08,
  A2: 0.08,
  B1: 0.04,
  B2: 0.04,
  C: 0,
  D: -0.03,
  E: -0.06,
  F: -0.09,
  G: -0.12,
};

export interface EtnAnaliza {
  steviloTransakcij: number;
  povprecnaCenaM2: number;
  medianaCenaM2: number;
  minCenaM2: number;
  lokacijskiPremium?: LokacijskiPremium | null;
  maxCenaM2: number;
  ocenjenaTrznaVrednost: number | null;
  ocenaVrednostiMin: number | null;
  ocenaVrednostiMax: number | null;
  energetskaKorekcija: { razred: string; faktor: number } | null;
  trendProcent: number | null;
  trend: "rast" | "padec" | "stabilno" | null;
  zadnjeLeto: number | null;
  predLeto: number | null;
  imeKo: string | null;
  letniPodatki: { leto: number; medianaCenaM2: number; steviloPoslov: number }[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface EtnNajemAnaliza {
  steviloPoslov: number;
  medianaNajemnineM2: number; // €/m²/mesec
  povprecnaNajemnineM2: number;
  ocenjenaMesecnaNajemnina: number | null;
  ocenjenaNajemninaMin: number | null;
  ocenjenaNajemninaMax: number | null;
  trendProcent: number | null;
  trend: "rast" | "padec" | "stabilno" | null;
  brutoDonosLetni: number | null;
  imeKo: string | null;
  letniPodatki: { leto: number; medianaNajemnineM2: number; steviloPoslov: number }[];
}

export async function getEtnNajemAnaliza(
  koId: number,
  area: number | null,
  prodajnaVrednost?: number | null,
  lokacijskiFaktor?: number | null,
): Promise<EtnNajemAnaliza | null> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const koStr = String(koId);

  type Row = {
    najemnina: number;
    povrsina: number;
    cas_najema: string;
    leto: string;
    ime_ko: string | null;
  };

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT
      p."POGODBENA_NAJEMNINA"::float AS najemnina,
      COALESCE(d."UPORABNA_POVRSINA_ODDANIH_PROSTOROV", d."POVRSINA_ODDANIH_PROSTOROV")::float AS povrsina,
      p."CAS_NAJEMA" AS cas_najema,
      COALESCE(p."LETO"::text, EXTRACT(YEAR FROM TO_DATE(p."DATUM_SKLENITVE_POGODBE", 'DD.MM.YYYY'))::text) AS leto,
      d."IME_KO" AS ime_ko
    FROM etn_np_posli p
    JOIN etn_np_delistavb d ON d."ID_POSLA" = p."ID_POSLA"
    WHERE
      d."SIFRA_KO" = $1
      AND TO_DATE(p."DATUM_SKLENITVE_POGODBE", 'DD.MM.YYYY') >= $2::date
      AND p."POGODBENA_NAJEMNINA" IS NOT NULL
      AND p."POGODBENA_NAJEMNINA" ~ '^[0-9]+(\.[0-9]+)?$'
      AND p."POGODBENA_NAJEMNINA"::float > 0
      AND COALESCE(d."UPORABNA_POVRSINA_ODDANIH_PROSTOROV", d."POVRSINA_ODDANIH_PROSTOROV") IS NOT NULL
      AND COALESCE(d."UPORABNA_POVRSINA_ODDANIH_PROSTOROV", d."POVRSINA_ODDANIH_PROSTOROV") ~ '^[0-9]+(\.[0-9]+)?$'
      AND COALESCE(d."UPORABNA_POVRSINA_ODDANIH_PROSTOROV", d."POVRSINA_ODDANIH_PROSTOROV")::float > 0
      AND d."VRSTA_ODDANIH_PROSTOROV" IN ('2', '1', '16')
    ORDER BY TO_DATE(p."DATUM_SKLENITVE_POGODBE", 'DD.MM.YYYY') DESC
    LIMIT 500
    `,
    koStr,
    cutoffStr,
  );

  if (!rows || rows.length === 0) return null;

  type Parsed = { najemninaM2Mesec: number; leto: number };
  const parsed: Parsed[] = rows
    .map((r) => {
      const najemnina = Number(r.najemnina);
      const povrsina = Number(r.povrsina);
      if (!isFinite(najemnina) || !isFinite(povrsina) || povrsina <= 0) return null;
      // Normalize to monthly: CAS_NAJEMA '2' = yearly
      const mesecna = r.cas_najema === "2" ? najemnina / 12 : najemnina;
      const najemninaM2Mesec = mesecna / povrsina;
      const leto = parseInt(r.leto ?? "0");
      return { najemninaM2Mesec, leto };
    })
    .filter((r): r is Parsed => r !== null && r.najemninaM2Mesec >= 2 && r.najemninaM2Mesec <= 30);

  if (parsed.length === 0) return null;

  const imeKo = rows[0]?.ime_ko ?? null;

  const prices = parsed.map((r) => r.najemninaM2Mesec);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const med = median(prices);

  // Per-year breakdown
  const byYear = new Map<number, number[]>();
  for (const r of parsed) {
    if (!byYear.has(r.leto)) byYear.set(r.leto, []);
    byYear.get(r.leto)!.push(r.najemninaM2Mesec);
  }
  const letniPodatki = Array.from(byYear.entries())
    .map(([leto, vals]) => ({
      leto,
      medianaNajemnineM2: Math.round(median(vals) * 100) / 100,
      steviloPoslov: vals.length,
    }))
    .sort((a, b) => a.leto - b.leto);

  // Trend
  const now = new Date();
  const lastYear = now.getFullYear() - 1;
  const yearBefore = now.getFullYear() - 2;
  const zadnjeLetoData = letniPodatki.find((l) => l.leto === lastYear);
  const predLetoData = letniPodatki.find((l) => l.leto === yearBefore);

  let trend: EtnNajemAnaliza["trend"] = null;
  let trendProcent: number | null = null;
  if (zadnjeLetoData && predLetoData && predLetoData.medianaNajemnineM2 > 0) {
    const diff = (zadnjeLetoData.medianaNajemnineM2 - predLetoData.medianaNajemnineM2) / predLetoData.medianaNajemnineM2;
    trendProcent = Math.round(diff * 1000) / 10;
    trend = diff > 0.02 ? "rast" : diff < -0.02 ? "padec" : "stabilno";
  }

  // Tržna korekcija najemnine — ETN beleži uradne (pogosto nižje) najemnine.
  // Za premium lokacije (lokacijskiFaktor > 1.15) apliciramo tržni multiplikator.
  // Vir: primerjava ETN registriranih vs. oglašenih tržnih najemnin v LJ centru (~40-60% razlika)
  const lf = lokacijskiFaktor ?? 1;
  const trznaKorekcija = lf > 1.25 ? 1.55 : lf > 1.15 ? 1.40 : lf > 1.05 ? 1.20 : 1.0;

  // Estimated monthly rent
  let ocenjenaMesecnaNajemnina: number | null = null;
  let ocenjenaNajemninaMin: number | null = null;
  let ocenjenaNajemninaMax: number | null = null;
  if (area && area > 0) {
    const base = med * area * trznaKorekcija;
    ocenjenaMesecnaNajemnina = Math.round(base);
    ocenjenaNajemninaMin = Math.round(base * 0.85);
    ocenjenaNajemninaMax = Math.round(base * 1.15);
  }

  // Gross yield
  let brutoDonosLetni: number | null = null;
  if (ocenjenaMesecnaNajemnina && prodajnaVrednost && prodajnaVrednost > 0) {
    brutoDonosLetni = Math.round((ocenjenaMesecnaNajemnina * 12 / prodajnaVrednost) * 1000) / 10;
  }

  return {
    steviloPoslov: parsed.length,
    medianaNajemnineM2: Math.round(med * 100) / 100,
    povprecnaNajemnineM2: Math.round(avg * 100) / 100,
    ocenjenaMesecnaNajemnina,
    ocenjenaNajemninaMin,
    ocenjenaNajemninaMax,
    trendProcent,
    trend,
    brutoDonosLetni,
    imeKo,
    letniPodatki,
  };
}

// Map GURS vrsta/raba to ETN dejanska_raba filter
function etnTipFilter(dejanskaRaba: string | null): string {
  if (!dejanskaRaba) return "";
  const r = dejanskaRaba.toLowerCase();
  if (r.includes("stanovan")) return `AND (d.dejanska_raba_dela_stavbe ILIKE '%stanovan%' OR d.vrsta_dela_stavbe = '2')`;
  if (r.includes("poslovn") || r.includes("pisarn")) return `AND (d.dejanska_raba_dela_stavbe ILIKE '%poslovn%' OR d.vrsta_dela_stavbe IN ('5','6'))`;
  if (r.includes("garaza") || r.includes("parking") || r.includes("parkirn")) return `AND (d.dejanska_raba_dela_stavbe ILIKE '%garaza%' OR d.vrsta_dela_stavbe = '3')`;
  if (r.includes("klet")) return `AND (d.dejanska_raba_dela_stavbe ILIKE '%klet%' OR d.vrsta_dela_stavbe = '14')`;
  if (r.includes("trgov")) return `AND (d.dejanska_raba_dela_stavbe ILIKE '%trgov%' OR d.vrsta_dela_stavbe = '8')`;
  return "";
}

export async function getEtnAnaliza(
  koId: number,
  area: number | null,
  energyClass?: string | null,
  dejanskaRaba?: string | null,
  lat?: number | null,
  lng?: number | null,
  osmAmenitiesCount?: number | null,
): Promise<EtnAnaliza | null> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const koStr = String(koId);

  type Row = { cena: number; povrsina: number; leto: string; ime_ko: string | null };

  const tipFilter = etnTipFilter(dejanskaRaba ?? null);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT
      p.pogodbena_cena_odskodnina::float AS cena,
      COALESCE(d.uporabna_povrsina, d.povrsina_dela_stavbe)::float AS povrsina,
      COALESCE(d.leto::text, EXTRACT(YEAR FROM TO_DATE(p.datum_sklenitve_pogodbe, 'DD.MM.YYYY'))::text) AS leto,
      d.ime_ko
    FROM etn_posli p
    JOIN etn_delistavb d ON d.id_posla = p.id_posla
    WHERE
      d.sifra_ko = $1
      AND TO_DATE(p.datum_sklenitve_pogodbe, 'DD.MM.YYYY') >= $2::date
      AND p.pogodbena_cena_odskodnina IS NOT NULL
      AND p.pogodbena_cena_odskodnina <> ''
      AND p.pogodbena_cena_odskodnina ~ '^[0-9]+(\.[0-9]+)?$'
      AND p.pogodbena_cena_odskodnina::float > 0
      AND d.povrsina_dela_stavbe IS NOT NULL
      AND d.povrsina_dela_stavbe <> ''
      AND d.povrsina_dela_stavbe ~ '^[0-9]+(\.[0-9]+)?$'
      AND d.povrsina_dela_stavbe::float > 0
      AND p.trznost_posla IN ('1','2','5')
      AND p.vrsta_kupoprodajnega_posla = '1'
      ${tipFilter}
    ORDER BY TO_DATE(p.datum_sklenitve_pogodbe, 'DD.MM.YYYY') DESC
    LIMIT 500
    `,
    koStr,
    cutoffStr,
  );

  if (!rows || rows.length === 0) return null;

  // Parse + filter outliers
  type Parsed = { cenaM2: number; leto: number };
  const parsed: Parsed[] = rows
    .map((r) => {
      const cena = Number(r.cena);
      const povrsina = Number(r.povrsina);
      if (!isFinite(cena) || !isFinite(povrsina) || povrsina <= 0) return null;
      const cenaM2 = cena / povrsina;
      const leto = parseInt(r.leto ?? "0");
      return { cenaM2, leto };
    })
    .filter((r): r is Parsed => r !== null && r.cenaM2 >= 500 && r.cenaM2 <= 15000);

  if (parsed.length === 0) return null;

  const imeKo = rows[0]?.ime_ko ?? null;

  const prices = parsed.map((r) => r.cenaM2);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const med = median(prices);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Per-year breakdown
  const byYear = new Map<number, number[]>();
  for (const r of parsed) {
    if (!byYear.has(r.leto)) byYear.set(r.leto, []);
    byYear.get(r.leto)!.push(r.cenaM2);
  }
  const letniPodatki = Array.from(byYear.entries())
    .map(([leto, vals]) => ({
      leto,
      medianaCenaM2: Math.round(median(vals)),
      steviloPoslov: vals.length,
    }))
    .sort((a, b) => a.leto - b.leto);

  // Trend: last full year vs year before
  const now = new Date();
  const lastYear = now.getFullYear() - 1;
  const yearBefore = now.getFullYear() - 2;

  const zadnjeLetoData = letniPodatki.find((l) => l.leto === lastYear);
  const predLetoData = letniPodatki.find((l) => l.leto === yearBefore);

  const zadnjeLeto = zadnjeLetoData?.medianaCenaM2 ?? null;
  const predLeto = predLetoData?.medianaCenaM2 ?? null;

  let trend: EtnAnaliza["trend"] = null;
  let trendProcent: number | null = null;
  if (zadnjeLeto != null && predLeto != null && predLeto > 0) {
    const diff = (zadnjeLeto - predLeto) / predLeto;
    trendProcent = Math.round(diff * 1000) / 10; // e.g. 12.3%
    trend = diff > 0.02 ? "rast" : diff < -0.02 ? "padec" : "stabilno";
  }

  // Energetska korekcija
  let energetskaKorekcija: EtnAnaliza["energetskaKorekcija"] = null;
  let energyFactor = 1;
  if (energyClass) {
    const normalized = energyClass.toUpperCase().replace(/\s/g, "");
    const correction = ENERGY_CORRECTION[normalized];
    if (correction !== undefined) {
      energyFactor = 1 + correction;
      energetskaKorekcija = { razred: normalized, faktor: correction };
    }
  }

    // Lokacijski premium
  const lokacijskiPremium = lat != null && lng != null
    ? izracunajLokacijskiPremium(lat, lng, osmAmenitiesCount)
    : null;
  const lokacijskiFaktor = lokacijskiPremium?.skupniFaktor ?? 1;

  // Kalibracijski faktorji (backtest 19,183 transakcij)
  const koKorekcija = KO_KALIBRACIJSKI_FAKTOR[koStr] ?? 0;
  const povrsinaKor = area ? povrsinskaKorekcija(area) : 0;
  const kalibracijskiFaktor = 1 + koKorekcija + povrsinaKor;

  // Kalibrirana mediana
  const medKalibrirana = med * kalibracijskiFaktor;

  // Ocenjena vrednost = median × površina × energetski faktor × lokacijski faktor × kalibracija, ±10%
  let ocenjenaTrznaVrednost: number | null = null;
  let ocenaVrednostiMin: number | null = null;
  let ocenaVrednostiMax: number | null = null;
  if (area && area > 0) {
    const base = medKalibrirana * area * energyFactor * lokacijskiFaktor;
    ocenjenaTrznaVrednost = Math.round(base);
    ocenaVrednostiMin = Math.round(base * 0.9);
    ocenaVrednostiMax = Math.round(base * 1.1);
  }

  return {
    steviloTransakcij: parsed.length,
    povprecnaCenaM2: Math.round(avg),
    medianaCenaM2: Math.round(medKalibrirana),
    minCenaM2: Math.round(min),
    maxCenaM2: Math.round(max),
    ocenjenaTrznaVrednost,
    ocenaVrednostiMin,
    ocenaVrednostiMax,
    energetskaKorekcija,
    lokacijskiPremium,
    trendProcent,
    trend,
    zadnjeLeto,
    predLeto,
    imeKo,
    letniPodatki,
  };
}
