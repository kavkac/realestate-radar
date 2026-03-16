import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface EizLookupParams {
  koId: number;
  stStavbe: number;
  stDelaStavbe?: number;
}

/**
 * Poišče energetsko izkaznico iz baze po koId, stStavbe in stDelaStavbe.
 * Vrne najnovejšo veljavno izkaznico.
 */
export async function lookupEnergyCertificate({
  koId,
  stStavbe,
  stDelaStavbe,
}: EizLookupParams) {
  const certificate = await prisma.energyCertificate.findFirst({
    where: {
      koId,
      stStavbe,
      ...(stDelaStavbe != null ? { stDelaStavbe } : {}),
      validUntil: { gte: new Date() },
    },
    orderBy: { issueDate: "desc" },
  });

  return certificate;
}

/**
 * Poišče transakcije za nepremičnino.
 */
export async function lookupTransactions({
  koId,
  stStavbe,
  stDelaStavbe,
}: EizLookupParams) {
  const transactions = await prisma.transaction.findMany({
    where: {
      koId,
      stStavbe,
      ...(stDelaStavbe != null ? { stDelaStavbe } : {}),
    },
    orderBy: { date: "desc" },
    take: 10,
  });

  return transactions;
}
