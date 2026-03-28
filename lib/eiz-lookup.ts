import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface EizLookupParams {
  koId: number;
  stStavbe: number;
  stDelaStavbe?: number;
}

export type EizSource = "stanovanje" | "stavba" | "del_iste_stavbe" | null;

export interface EizLookupResult {
  cert: Awaited<ReturnType<typeof prisma.energyCertificate.findFirst>>;
  source: EizSource;
  sourceStDela?: number | null; // kateri del stavbe je vir (pri del_iste_stavbe)
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

  // 3. Fallback: katera koli veljavna EIZ za isto stavbo (drug del)
  // Transparentno označeno v UI — dobre enote delijo ovojnico, ogrevanje, izolacijo
  const anyUnitCert = await prisma.energyCertificate.findFirst({
    where: {
      koId,
      stStavbe,
      stDelaStavbe: { not: null, gt: 0 },
      validUntil: { gte: new Date() },
    },
    orderBy: { issueDate: "desc" },
  });
  if (anyUnitCert) return { cert: anyUnitCert, source: "del_iste_stavbe", sourceStDela: anyUnitCert.stDelaStavbe };

  return { cert: null, source: null };
}

/**
 * Poišče EIZ za koordinatno bližnje stavbe (30m radius) v isti KO.
 * Fallback ko GURS lookup vrne pomožno zgradbo (garaža, drvarnica) brez EIZ.
 * Koristi koordinate iz ev_stavba za geoproximity lookup.
 */
export async function lookupEizNearby(
  koId: number,
  stStavbe: number,
) {
  // Najprej dobimo koordinate primarne stavbe iz ev_stavba
  const primary = await prisma.$queryRaw<Array<{ e: string; n: string }>>`
    SELECT e, n FROM ev_stavba
    WHERE ko_sifko = ${String(koId)} AND stev_st = ${String(stStavbe)}
    LIMIT 1
  `;
  if (!primary[0]?.e || !primary[0]?.n) return null;

  const e = parseFloat(primary[0].e);
  const n = parseFloat(primary[0].n);
  const radius = 30; // metrov

  // Iščemo stavbe v 30m radiju z EIZ
  const nearby = await prisma.$queryRaw<Array<{ stev_st: string }>>`
    SELECT s.stev_st FROM ev_stavba s
    WHERE s.ko_sifko = ${String(koId)}
      AND s.stev_st != ${String(stStavbe)}
      AND s.e IS NOT NULL AND s.n IS NOT NULL
      AND sqrt(power(s.e::float - ${e}, 2) + power(s.n::float - ${n}, 2)) < ${radius}
    ORDER BY sqrt(power(s.e::float - ${e}, 2) + power(s.n::float - ${n}, 2))
    LIMIT 10
  `;

  for (const nb of nearby) {
    const cert = await prisma.energyCertificate.findFirst({
      where: {
        koId,
        stStavbe: parseInt(nb.stev_st),
        validUntil: { gte: new Date() },
      },
      orderBy: { issueDate: "desc" },
    });
    if (cert) return cert;
  }
  return null;
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
