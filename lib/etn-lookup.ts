import { prisma } from "./prisma";

export interface EtnAnaliza {
  steviloTransakcij: number;
  povprecnaCenaM2: number;
  minCenaM2: number;
  maxCenaM2: number;
  ocenjenaTrznaVrednost: number | null;
  trend: "rast" | "padec" | "stabilno" | null;
  zadnjeLeto: number | null;
  predLeto: number | null;
}

export async function getEtnAnaliza(
  koId: number,
  area: number | null,
): Promise<EtnAnaliza | null> {
  const transactions = await prisma.transaction.findMany({
    where: { koId, pricePerM2: { not: null } },
    orderBy: { date: "desc" },
    take: 50,
  });
  if (transactions.length === 0) return null;

  const prices = transactions.map((t) => t.pricePerM2!);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  const now = new Date();
  const lastYear = now.getFullYear() - 1;
  const yearBefore = now.getFullYear() - 2;

  const lastYearTx = transactions.filter(
    (t) => t.date.getFullYear() === lastYear,
  );
  const yearBeforeTx = transactions.filter(
    (t) => t.date.getFullYear() === yearBefore,
  );

  let trend: EtnAnaliza["trend"] = null;
  let zadnjeLeto: number | null = null;
  let predLeto: number | null = null;

  if (lastYearTx.length > 0 && yearBeforeTx.length > 0) {
    const lastAvg =
      lastYearTx.map((t) => t.pricePerM2!).reduce((a, b) => a + b, 0) /
      lastYearTx.length;
    const prevAvg =
      yearBeforeTx.map((t) => t.pricePerM2!).reduce((a, b) => a + b, 0) /
      yearBeforeTx.length;
    zadnjeLeto = Math.round(lastAvg);
    predLeto = Math.round(prevAvg);
    const diff = (lastAvg - prevAvg) / prevAvg;
    trend = diff > 0.02 ? "rast" : diff < -0.02 ? "padec" : "stabilno";
  }

  return {
    steviloTransakcij: transactions.length,
    povprecnaCenaM2: Math.round(avg),
    minCenaM2: Math.round(min),
    maxCenaM2: Math.round(max),
    ocenjenaTrznaVrednost: area ? Math.round(avg * area) : null,
    trend,
    zadnjeLeto,
    predLeto,
  };
}
