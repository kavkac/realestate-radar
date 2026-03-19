/**
 * Oglasne cene — leading indicator za tržni kontekst.
 * Iz tabele listings_oglasi (scraped iz nepremičninskih portalov).
 *
 * Sale-to-list ratio: razlika med oglasno (danes) in ETN transakcijsko (zakasnjena) ceno
 * = pogajalski prostor + tržni sentiment.
 */

import { prisma } from "@/lib/prisma";

export interface OglasneAnalize {
  medianaCenaM2: number;
  steviloOglasov: number;
  zadnjiScrape: Date | null;
  discountVsEtn: number | null; // % razlika (+ = oglasi višji od ETN transakcij)
}

export async function getOglasneAnalize(
  koId: number,
  etnMedianaCenaM2?: number | null
): Promise<OglasneAnalize | null> {
  try {
    type Row = { median_m2: number; n: number; zadnji: Date };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY cena_m2) AS median_m2,
        COUNT(*)::int AS n,
        MAX(datum_zajet) AS zadnji
      FROM listings_oglasi
      WHERE ko_sifko = $1
        AND cena_m2 > 0
        AND cena_m2 BETWEEN 500 AND 20000
        AND datum_zajet >= NOW() - INTERVAL '60 days'`,
      String(koId)
    );

    if (!rows || rows.length === 0 || !rows[0].median_m2) return null;
    const row = rows[0];

    let discountVsEtn: number | null = null;
    if (etnMedianaCenaM2 && etnMedianaCenaM2 > 0) {
      discountVsEtn =
        Math.round(
          ((row.median_m2 - etnMedianaCenaM2) / etnMedianaCenaM2) * 1000
        ) / 10;
    }

    return {
      medianaCenaM2: Math.round(row.median_m2),
      steviloOglasov: row.n,
      zadnjiScrape: row.zadnji,
      discountVsEtn,
    };
  } catch {
    return null;
  }
}
