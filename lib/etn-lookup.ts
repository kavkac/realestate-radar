import { prisma } from "./prisma";

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
): Promise<EtnNajemAnaliza | null> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
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
      COALESCE(p."LETO", EXTRACT(YEAR FROM TO_DATE(p."DATUM_SKLENITVE_POGODBE", 'DD.MM.YYYY'))::text) AS leto,
      d."IME_KO" AS ime_ko
    FROM etn_np_posli p
    JOIN etn_np_delistavb d ON d."ID_POSLA" = p."ID_POSLA"
    WHERE
      d."SIFRA_KO" = $1
      AND TO_DATE(p."DATUM_SKLENITVE_POGODBE", 'DD.MM.YYYY') >= $2::date
      AND p."POGODBENA_NAJEMNINA" IS NOT NULL
      AND p."POGODBENA_NAJEMNINA" <> ''
      AND p."POGODBENA_NAJEMNINA" <> '0'
      AND d."POVRSINA_ODDANIH_PROSTOROV" IS NOT NULL
      AND d."POVRSINA_ODDANIH_PROSTOROV" <> ''
      AND d."POVRSINA_ODDANIH_PROSTOROV" <> '0'
      AND p."TRZNOST_POSLA" = '1'
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

  // Estimated monthly rent
  let ocenjenaMesecnaNajemnina: number | null = null;
  let ocenjenaNajemninaMin: number | null = null;
  let ocenjenaNajemninaMax: number | null = null;
  if (area && area > 0) {
    const base = med * area;
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
): Promise<EtnAnaliza | null> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
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
      AND p.pogodbena_cena_odskodnina > 0
      AND d.povrsina_dela_stavbe IS NOT NULL
      AND d.povrsina_dela_stavbe > 0
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

  // Ocenjena vrednost = median × površina × energetski faktor, ±10%
  let ocenjenaTrznaVrednost: number | null = null;
  let ocenaVrednostiMin: number | null = null;
  let ocenaVrednostiMax: number | null = null;
  if (area && area > 0) {
    const base = med * area * energyFactor;
    ocenjenaTrznaVrednost = Math.round(base);
    ocenaVrednostiMin = Math.round(base * 0.9);
    ocenaVrednostiMax = Math.round(base * 1.1);
  }

  return {
    steviloTransakcij: parsed.length,
    povprecnaCenaM2: Math.round(avg),
    medianaCenaM2: Math.round(med),
    minCenaM2: Math.round(min),
    maxCenaM2: Math.round(max),
    ocenjenaTrznaVrednost,
    ocenaVrednostiMin,
    ocenaVrednostiMax,
    energetskaKorekcija,
    trendProcent,
    trend,
    zadnjeLeto,
    predLeto,
    imeKo,
    letniPodatki,
  };
}
