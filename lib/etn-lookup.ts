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

export async function getEtnAnaliza(
  koId: number,
  area: number | null,
  energyClass?: string | null,
): Promise<EtnAnaliza | null> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const koStr = String(koId);

  type Row = { cena: string; povrsina: string; leto: string; ime_ko: string | null };

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT
      p.pogodbena_cena_odskodnina AS cena,
      COALESCE(d.uporabna_povrsina, d.povrsina_dela_stavbe) AS povrsina,
      COALESCE(p.leto, EXTRACT(YEAR FROM p.datum_sklenitve_pogodbe::date)::text) AS leto,
      d.ime_ko
    FROM etn_posli p
    JOIN etn_delistavb d ON d.id_posla = p.id_posla
    WHERE
      d.sifra_ko = $1
      AND p.datum_sklenitve_pogodbe >= $2
      AND p.pogodbena_cena_odskodnina IS NOT NULL
      AND p.pogodbena_cena_odskodnina <> ''
      AND p.pogodbena_cena_odskodnina <> '0'
      AND d.povrsina_dela_stavbe IS NOT NULL
      AND d.povrsina_dela_stavbe <> ''
      AND d.povrsina_dela_stavbe <> '0'
      AND p.trznost_posla = '1'
    ORDER BY p.datum_sklenitve_pogodbe DESC
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
      const cena = parseFloat(r.cena);
      const povrsina = parseFloat(r.povrsina);
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
