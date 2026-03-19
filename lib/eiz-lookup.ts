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
  // 1. Najprej poskusi z izbrano enoto
  if (stDelaStavbe != null) {
    const unitCert = await prisma.energyCertificate.findFirst({
      where: { koId, stStavbe, stDelaStavbe, validUntil: { gte: new Date() } },
      orderBy: { issueDate: "desc" },
    });
    if (unitCert) return unitCert;
  }

  // 2. Fallback: stavbni certifikat (stDelaStavbe = null ali 0)
  const buildingCert = await prisma.energyCertificate.findFirst({
    where: {
      koId,
      stStavbe,
      OR: [{ stDelaStavbe: null }, { stDelaStavbe: 0 }],
      validUntil: { gte: new Date() },
    },
    orderBy: { issueDate: "desc" },
  });
  if (buildingCert) return buildingCert;

  // 3. Zadnji fallback: katerakoli izkaznica za to stavbo (brez filtra na enoto)
  return prisma.energyCertificate.findFirst({
    where: { koId, stStavbe, validUntil: { gte: new Date() } },
    orderBy: { issueDate: "desc" },
  });
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
