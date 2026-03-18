import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lookupByAddress, getParcele, getRenVrednost, getOwnership, getParcelByNumber, getBuildingsByParcel, getBuildingParts, checkGasInfrastructure, VRSTA_DEJANSKE_RABE } from "@/lib/gurs-api";
import { lookupEnergyCertificate } from "@/lib/eiz-lookup";
import { getEtnAnaliza } from "@/lib/etn-lookup";
import { prisma } from "@/lib/prisma";

const LookupSchema = z.object({
  address: z.string().min(3, "Naslov mora vsebovati vsaj 3 znake"),
  delStavbe: z.number().optional(),
});

// --- Rate limiting ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parcela = searchParams.get("parcela");
  const koStr = searchParams.get("ko");

  if (!parcela || !koStr) {
    return NextResponse.json(
      { success: false, error: "Manjkata parametra parcela in ko" },
      { status: 400 },
    );
  }

  const koId = parseInt(koStr, 10);
  if (isNaN(koId)) {
    return NextResponse.json(
      { success: false, error: "Neveljaven ko parameter (mora biti število)" },
      { status: 400 },
    );
  }

  // Rate limit
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: "Preveč zahtevkov. Poskusite znova čez minuto." },
      { status: 429 },
    );
  }

  try {
    const parcelaData = await getParcelByNumber(koId, parcela);
    if (!parcelaData) {
      return NextResponse.json(
        { success: false, error: "Parcela ni bila najdena v evidenci GURS" },
        { status: 404 },
      );
    }

    // Get all buildings on this parcel
    const stavbe = await getBuildingsByParcel(parcelaData.eidParcele);

    // For each building get its parts
    const stavbeWithParts = await Promise.all(
      stavbe.map(async (stavba) => {
        const deliStavbe = await getBuildingParts(stavba.eidStavba);
        return { stavba, deliStavbe };
      }),
    );

    return NextResponse.json({
      success: true,
      parcela: parcelaData,
      stavbe: stavbeWithParts.map(({ stavba, deliStavbe }) => ({
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        eidStavba: stavba.eidStavba,
        letoIzgradnje: stavba.letoIzgradnje,
        letoObnove: {
          fasade: stavba.letoObnoveFasade,
          strehe: stavba.letoObnoveStrehe,
        },
        steviloEtaz: stavba.steviloEtaz,
        steviloStanovanj: stavba.steviloStanovanj,
        povrsina: stavba.brutoTlorisnaPovrsina,
        konstrukcija: stavba.nosilnaKonstrukcija,
        tip: stavba.tipStavbe,
        prikljucki: {
          elektrika: stavba.elektrika,
          plin: stavba.plin,
          vodovod: stavba.vodovod,
          kanalizacija: stavba.kanalizacija,
        },
        deliStavbe: deliStavbe.map((d) => ({
          stDela: d.stDelaStavbe,
          povrsina: d.povrsina,
          uporabnaPovrsina: d.uporabnaPovrsina,
          vrsta: d.vrsta,
          prostori: d.prostori,
        })),
      })),
    });
  } catch (error) {
    console.error("Parcel lookup error:", error);
    return NextResponse.json(
      { success: false, error: "Napaka pri iskanju parcele" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: "Preveč zahtevkov. Poskusite znova čez minuto." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const { address, delStavbe } = LookupSchema.parse(body);

    const result = await lookupByAddress(address);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Naslov ni bil najden v evidenci GURS" },
        { status: 404 },
      );
    }

    const { stavba, deliStavbe, lat, lng } = result;

    // Validate requested del stavbe
    if (delStavbe != null) {
      const exists = deliStavbe.some(d => d.stDelaStavbe === delStavbe);
      if (!exists) {
        return NextResponse.json({
          success: false,
          error: `Del stavbe ${delStavbe} ne obstaja. Stavba ima dele: ${deliStavbe.map(d => d.stDelaStavbe).join(', ')}.`
        }, { status: 400 });
      }
    }

    // Determine stDelaStavbe for energy cert lookup
    const stDelaStavbe =
      delStavbe ?? (deliStavbe.length === 1 ? deliStavbe[0].stDelaStavbe : undefined);

    // Useable area for ETN analysis
    const useableArea =
      deliStavbe[0]?.uporabnaPovrsina ?? deliStavbe[0]?.povrsina ?? null;

    // Check gas infrastructure via ZK GJI
    const gasInfrastructure =
      lat != null && lng != null
        ? await checkGasInfrastructure(lat, lng).catch(() => null)
        : null;

    // Fetch energy certificate, parcele, REN vrednost, ETN analysis, ownership, EV, and KN namembnost in parallel
    const [energyCertResult, parcele, renVrednost, etnAnaliza, evResults, namembnostResults, ...ownershipResults] = await Promise.all([
      lookupEnergyCertificate({
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe,
      }).catch(() => null),
      getParcele(stavba.koId, stavba.stStavbe),
      getRenVrednost(stavba.koId, stavba.stStavbe),
      getEtnAnaliza(stavba.koId, useableArea).catch(() => null),
      Promise.all(
        deliStavbe.map((d) =>
          prisma.evidencaVrednotenja
            .findUnique({ where: { eidDelStavbe: String(d.eidDelStavbe) } })
            .catch(() => null)
        )
      ),
      Promise.all(
        deliStavbe.map((d) =>
          prisma.deliStavbNamembnost
            .findUnique({ where: { eidDelStavbe: String(d.eidDelStavbe) } })
            .catch(() => null)
        )
      ),
      ...deliStavbe.map((d) => getOwnership(d.eidDelStavbe).catch(() => [] as Awaited<ReturnType<typeof getOwnership>>)),
    ]);

    let energetskaIzkaznica = null;
    if (energyCertResult) {
      const cert = energyCertResult;
      energetskaIzkaznica = {
        razred: cert.energyClass,
        tip: cert.type,
        datumIzdaje: cert.issueDate.toISOString().split("T")[0],
        veljaDo: cert.validUntil.toISOString().split("T")[0],
        potrebnaTopota: cert.heatingNeed,
        dovedenaEnergija: cert.deliveredEnergy,
        celotnaEnergija: cert.totalEnergy,
        elektricnaEnergija: cert.electricEnergy,
        primaryEnergy: cert.primaryEnergy,
        co2: cert.co2Emissions,
        kondicionirana: cert.conditionedArea,
      };
    }

    return NextResponse.json({
      success: true,
      naslov: address,
      lat,
      lng,
      enolicniId: {
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe: stDelaStavbe ?? null,
      },
      stavba: {
        letoIzgradnje: stavba.letoIzgradnje,
        letoObnove: {
          fasade: stavba.letoObnoveFasade,
          strehe: stavba.letoObnoveStrehe,
        },
        steviloEtaz: stavba.steviloEtaz,
        steviloStanovanj: stavba.steviloStanovanj,
        povrsina: stavba.brutoTlorisnaPovrsina,
        konstrukcija: stavba.nosilnaKonstrukcija,
        tip: stavba.tipStavbe,
        datumSys: stavba.datumSys,
        prikljucki: {
          elektrika: stavba.elektrika,
          plin: stavba.plin,
          vodovod: stavba.vodovod,
          kanalizacija: stavba.kanalizacija,
        },
        gasInfrastructure,
        visina: stavba.visina,
      },
      deliStavbe: deliStavbe.map((d, i) => ({
        stDela: d.stDelaStavbe,
        povrsina: d.povrsina,
        uporabnaPovrsina: d.uporabnaPovrsina,
        vrsta: namembnostResults[i]?.vrstaNamembnosti
          ? (VRSTA_DEJANSKE_RABE[namembnostResults[i]!.vrstaNamembnosti!] ?? d.vrsta)
          : d.vrsta,
        letoObnoveInstalacij: d.letoObnoveInstalacij,
        letoObnoveOken: d.letoObnoveOken,
        dvigalo: d.dvigalo,
        prostori: d.prostori,
        etazaDelStavbe: d.etazaDelStavbe,
        vrstaStanovanjaUradno: d.vrstaStanovanjaUradno,
        lastnistvo: ownershipResults[i] ?? [],
        vrednotenje: evResults[i]
          ? {
              posplosenaVrednost: evResults[i]!.posplosenaVrednost,
              vrednostNaM2: evResults[i]!.vrednostNaM2,
              idModel: evResults[i]!.idModel,
              letoIzgradnje: evResults[i]!.letoIzgradnje,
              povrsina: evResults[i]!.povrsina,
            }
          : null,
      })),
      energetskaIzkaznica,
      parcele,
      renVrednost,
      etnAnaliza,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 },
      );
    }

    console.error("Lookup error:", error);
    return NextResponse.json(
      { success: false, error: "Napaka pri iskanju nepremičnine" },
      { status: 500 },
    );
  }
}
