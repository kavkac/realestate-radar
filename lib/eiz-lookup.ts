import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface EizLookupParams {
  koId: number;
  stStavbe: number;
  stDelaStavbe?: number;
}

export type EizSource = "stanovanje" | "stavba" | null;

export interface EizLookupResult {
  cert: Awaited<ReturnType<typeof prisma.energyCertificate.findFirst>>;
  source: EizSource;
}

/**
 * Poišče energetsko izkaznico iz baze po koId, stStavbe in stDelaStavbe.
 * Vrne najnovejšo veljavno izkaznico z virom (stanovanje ali stavba).
 */
export async function lookupEnergyCertificate({
  koId,
  stStavbe,
  stDelaStavbe,
}: EizLookupParams): Promise<EizLookupResult> {
  // 1. Najprej poskusi z izbrano enoto (apartment-level cert)
  if (stDelaStavbe != null) {
    const unitCert = await prisma.energyCertificate.findFirst({
      where: { koId, stStavbe, stDelaStavbe, validUntil: { gte: new Date() } },
      orderBy: { issueDate: "desc" },
    });
    if (unitCert) return { cert: unitCert, source: "stanovanje" };
  }

  // 2. Fallback: stavbni certifikat (building-level: stDelaStavbe = null ali 0)
  const buildingCert = await prisma.energyCertificate.findFirst({
    where: {
      koId,
      stStavbe,
      OR: [{ stDelaStavbe: null }, { stDelaStavbe: 0 }],
      validUntil: { gte: new Date() },
    },
    orderBy: { issueDate: "desc" },
  });
  if (buildingCert) return { cert: buildingCert, source: "stavba" };

  // 3. Zadnji fallback: katerakoli izkaznica za to stavbo (brez filtra na enoto)
  const anyCert = await prisma.energyCertificate.findFirst({
    where: { koId, stStavbe, validUntil: { gte: new Date() } },
    orderBy: { issueDate: "desc" },
  });
  return { cert: anyCert, source: anyCert ? "stavba" : null };
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
