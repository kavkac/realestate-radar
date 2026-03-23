import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lookupByAddress, getParcele, getRenVrednost, getOwnership, getParcelByNumber, getBuildingsByParcel, getBuildingParts, checkGasInfrastructure, getTipPolozajaStavbe, VRSTA_DEJANSKE_RABE, GursServiceUnavailableError } from "@/lib/gurs-api";
import { getSeizmicnaCona, getPoplavnaNevarnost } from "@/lib/arso-api";
import { getAzbestRisk } from "@/lib/azbest";
import { lookupEnergyCertificate } from "@/lib/eiz-lookup";
import { getEtnAnaliza, getEtnNajemAnaliza, getKoRentalYield, getSaleToListRatio } from "@/lib/etn-lookup";
import { getOglasneAnalize } from "@/lib/listings-lookup";
import { buildPropertyContext } from "@/lib/property-context";
import { fetchOsmBuildingData } from "@/lib/osm-api";
import { getPlacesData } from "@/lib/places-api";
import { getLppLineCount } from "@/lib/lpp-lines";
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
        tip: stavba.steviloStanovanj != null && stavba.steviloStanovanj >= 3 ? "Večstanovanjska" : stavba.steviloStanovanj === 2 ? "Dvostanovanjska" : stavba.steviloStanovanj === 1 ? "Enostanovanjska" : stavba.tipStavbe,
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

    let result;
    try {
      result = await lookupByAddress(address);
    } catch (err) {
      if (err instanceof GursServiceUnavailableError) {
        return NextResponse.json(
          { success: false, error: "Kataster GURS je trenutno nedosegljiv. Poskusite znova čez nekaj minut." },
          { status: 503 },
        );
      }
      throw err;
    }
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Naslov ni bil najden v evidenci GURS" },
        { status: 404 },
      );
    }

    let { stavba, deliStavbe, lat, lng } = result;

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
    // If a specific unit is selected → use that unit's area
    // If no unit selected → use total building area (sum of all units)
    const selectedUnit = delStavbe != null ? deliStavbe.find(d => d.stDelaStavbe === delStavbe) : null;
    const totalBuildingArea = deliStavbe.reduce((sum, d) => sum + (d.uporabnaPovrsina ?? d.povrsina ?? 0), 0) || null;
    const useableArea = selectedUnit
      ? (selectedUnit.uporabnaPovrsina ?? selectedUnit.povrsina ?? null)
      : totalBuildingArea;

    // Also compute selected unit area separately for display
    const selectedUnitArea = selectedUnit
      ? (selectedUnit.uporabnaPovrsina ?? selectedUnit.povrsina ?? null)
      : null;

    // Determine property type for ETN filtering
    const etnSourceUnit = selectedUnit ?? deliStavbe[0];
    let etnDejanskaRaba = (etnSourceUnit as { vrstaRabe?: string | null; vrsta?: string | null })?.vrstaRabe ?? etnSourceUnit?.vrsta ?? null;

    // ETN tip filter override — troslojno:
    // 1. Stavba z >3 standovanji = vse enote so stanovanja (GURS oznaka enote je irelevantna)
    // 2. Enota > 25m² z garažno oznako → override na stanovanje
    // 3. Default: ohrani GURS vrsto (za poslovna, garažna, klet brez stavbnega konteksta)
    const jeVecstanovanjska = (stavba.steviloStanovanj ?? 0) > 3;
    if (jeVecstanovanjska && selectedUnit) {
      // V večstanovanjski stavbi — vsaka enota je stanovanje za namen ETN analize
      etnDejanskaRaba = "stanovanje";
    } else {
      // Enota v majhni stavbi — size-based + unicode-safe override
      const unitArea = selectedUnit
        ? (selectedUnit.uporabnaPovrsina ?? selectedUnit.povrsina ?? null)
        : null;
      if (unitArea != null && (unitArea as number) > 25) {
        const raba = (etnDejanskaRaba ?? "").toLowerCase();
        // Unicode-safe: ž=\u017e; pokrijemo vse garažne/parkirne kode iz VRSTA_DEJANSKE_RABE
        const isGarage = raba.includes("gara\u017e") || raba.includes("parkirn") || raba.includes("parking") || raba.includes("garaze") || raba.includes("garaz");
        if (isGarage) {
          etnDejanskaRaba = "stanovanje";
        }
      }
    }

    // Check gas infrastructure via ZK GJI
    const gasInfrastructure =
      lat != null && lng != null
        ? await checkGasInfrastructure(lat, lng).catch(() => null)
        : null;

    // OSM Overpass enrichment (non-blocking, parallel)
    const osmDataPromise =
      lat != null && lng != null
        ? fetchOsmBuildingData(lat, lng).catch(() => null)
        : Promise.resolve(null);

    // Google Places — transit + amenitete (non-blocking, per-usage pricing ~$0.13/lookup)
    const placesDataPromise =
      lat != null && lng != null
        ? getPlacesData(lat, lng).catch(() => null)
        : Promise.resolve(null);

    // Oglasne cene — vzporedno z ostalimi klici
    const oglasneAnalizePromise = getOglasneAnalize(stavba.koId, null).catch(() => null);

    // LPP bus lines via Overpass relations (non-blocking)
    const lppLinesPromise =
      lat != null && lng != null
        ? getLppLineCount(lat, lng).catch(() => null)
        : Promise.resolve(null);

    // Fetch energy certificate, parcele, REN vrednost, ETN analysis, ownership, EV, KN namembnost, and rental yield in parallel
    const [energyCertResult, parcele, renVrednost, etnAnaliza, etnNajemAnaliza, tipPolozaja, seizmicniPodatki, poplavnaNevarnost, osmData, lppLines, koRentalYield, saleToListRatio, evResults, namembnostResults, ...ownershipResults] = await Promise.all([
      lookupEnergyCertificate({
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe,
      }).catch(() => ({ cert: null, source: null as "stanovanje" | "stavba" | null })),
      getParcele(stavba.koId, stavba.stStavbe, lat, lng, stavba.obrisGeom ?? null),
      getRenVrednost(stavba.koId, stavba.stStavbe),
      getEtnAnaliza(stavba.koId, useableArea, null, etnDejanskaRaba, lat, lng, null, stavba.stStavbe)
        .then(r => r ?? getEtnAnaliza(stavba.koId, useableArea, null, null, lat, lng, null, stavba.stStavbe).catch(() => null))
        .catch(() => null),
      getEtnNajemAnaliza(stavba.koId, useableArea).catch(() => null),
      getTipPolozajaStavbe(stavba.eidStavba, stavba.koId).catch(() => null),
      lat != null && lng != null ? getSeizmicnaCona(lat, lng).catch(() => null) : Promise.resolve(null),
      lat != null && lng != null ? getPoplavnaNevarnost(lat, lng).catch(() => null) : Promise.resolve(null),
      osmDataPromise,
      lppLinesPromise,
      getKoRentalYield(stavba.koId).catch(() => null),
      getSaleToListRatio(stavba.koId).catch(() => null),
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

    // Load trusted corrections for this stavba (public corrections from verified users)
    const stavbaId = `${stavba.koId}-${stavba.stStavbe}`;
    const trustedCorrections = await prisma.$queryRawUnsafe<{atribut: string; vrednost: string; vloga_rank: number}[]>(
      `SELECT DISTINCT ON (atribut) atribut, vrednost,
         CASE cl.verification_tier
           WHEN 'lastnik'     THEN 4
           WHEN 'solastnik'   THEN 4
           WHEN 'upravljalec' THEN 3
           WHEN 'agent'       THEN 2
           ELSE 1
         END AS vloga_rank
       FROM user_corrections c
       LEFT JOIN user_property_claims cl ON cl.user_id = c.user_id AND cl.stavba_id = c.stavba_id AND cl.deleted_at IS NULL
       WHERE c.stavba_id = $1 AND c.is_public = true
       ORDER BY atribut, vloga_rank DESC, c.created_at DESC`,
      stavbaId
    ).catch(() => []);

    // Apply corrections to stavba data fields
    const correctionMap = Object.fromEntries(trustedCorrections.map(c => [c.atribut, c.vrednost]));

    // Override stavba fields with trusted user corrections
    if (correctionMap.fasada_leto) {
      stavba = { ...stavba, letoObnoveFasade: parseInt(correctionMap.fasada_leto) || stavba.letoObnoveFasade };
    }
    if (correctionMap.streha_leto) {
      stavba = { ...stavba, letoObnoveStrehe: parseInt(correctionMap.streha_leto) || stavba.letoObnoveStrehe };
    }

    // Fire-and-forget: store OSM data in building record
    if (osmData) {
      const eid = parseInt(stavba.eidStavba, 10);
      if (!isNaN(eid)) {
        prisma.building
          .upsert({
            where: { eidStavba: eid },
            update: { osmData: JSON.parse(JSON.stringify(osmData)) },
            create: {
              eidStavba: eid,
              koId: stavba.koId,
              stStavbe: stavba.stStavbe,
              osmData: JSON.parse(JSON.stringify(osmData)),
            },
          })
          .catch(() => {});
      }
    }

    let energetskaIzkaznica = null;
    if (energyCertResult?.cert) {
      const cert = energyCertResult.cert;
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
        source: energyCertResult.source,
      };
    }

    // Re-run ETN with energy class if cert available (applies correction to value estimate)
    // Lega v stavbi — iz ev_del_stavbe za selected unit
    let idLega: string | null = null;
    let stNadstropja: number | null = null;
    if (selectedUnit && stavba.eidStavba) {
      try {
        const legaRow = await prisma.$queryRawUnsafe<{ id_lega: string; st_nadstropja: string }[]>(
          `SELECT id_lega, st_nadstropja FROM ev_del_stavbe WHERE eid_stavba = $1 AND st_dela_stavbe = $2 LIMIT 1`,
          stavba.eidStavba, String(selectedUnit.stDelaStavbe)
        );
        if (legaRow[0]) {
          idLega = legaRow[0].id_lega ?? null;
          stNadstropja = legaRow[0].st_nadstropja ? parseInt(legaRow[0].st_nadstropja) : null;
        }
      } catch { /* ignore */ }
    }

    let etnAnalizaFinal = etnAnaliza;
    const certEnergyClass = energyCertResult?.cert?.energyClass;
    const osmAmenitiesCount = osmData ? (Object.values(osmData as Record<string, unknown[]>).flat().length) : null;
    if (certEnergyClass && etnAnaliza && useableArea) {
      const corrected = await getEtnAnaliza(stavba.koId, useableArea, certEnergyClass, etnDejanskaRaba, lat, lng, osmAmenitiesCount, stavba.stStavbe, idLega, stNadstropja)
        .then(r => r ?? getEtnAnaliza(stavba.koId, useableArea, certEnergyClass, null, lat, lng, osmAmenitiesCount, stavba.stStavbe, idLega, stNadstropja).catch(() => null))
        .catch(() => null);
      if (corrected) etnAnalizaFinal = corrected;
    } else if (etnAnalizaFinal && (idLega || stNadstropja)) {
      // Re-run with lega even without cert correction
      const withLega = await getEtnAnaliza(stavba.koId, useableArea, certEnergyClass ?? null, etnDejanskaRaba, lat, lng, osmAmenitiesCount, stavba.stStavbe, idLega, stNadstropja).catch(() => null);
      if (withLega) etnAnalizaFinal = withLega;
    }

    // Oglasne analize — dopolni z ETN mediano za razliko
    const oglasneAnalize = await oglasneAnalizePromise.then(r => {
      // Dopolni z ETN mediano za izračun discount-a
      if (r && etnAnalizaFinal?.medianaCenaM2) {
        r.discountVsEtn = Math.round(
          ((r.medianaCenaM2 - etnAnalizaFinal.medianaCenaM2) / etnAnalizaFinal.medianaCenaM2) * 1000
        ) / 10;
      }
      return r;
    }).catch(() => null);

    // Await placesData for context engine
    const placesData = await placesDataPromise;

    // Property Context Engine — deterministični kontekst iz vseh virov
    const propertyContext = buildPropertyContext({
      lat,
      lng,
      letoIzgradnje: stavba.letoIzgradnje ?? null,
      medianaCenaM2: etnAnalizaFinal?.medianaCenaM2 ?? null,
      steviloTransakcij: etnAnalizaFinal?.steviloTransakcij ?? null,
      virEtn: etnAnalizaFinal?.vir ?? null,
      zaupanje: etnAnalizaFinal?.zaupanje ?? null,
      oglasMedianaCenaM2: oglasneAnalize?.medianaCenaM2 ?? null,
      oglasStevilo: oglasneAnalize?.steviloOglasov ?? null,
      poplavnaNevarnost: poplavnaNevarnost?.stopnja === "visoka" || poplavnaNevarnost?.stopnja === "srednja",
      seizmicnaCona: seizmicniPodatki?.cona ?? null,
      kulturnoVarstvo: false, // TODO: iz GURS REN
      placesData: placesData ? {
        transit: {
          busStops: placesData.transit?.busStops,
          trainStations: placesData.transit?.trainStations,
          nearestBusM: placesData.transit?.nearestBusM,
          nearestTrainM: placesData.transit?.nearestTrainM,
          lppLineCount: lppLines?.lineCount ?? null,
          lppLines: lppLines?.lines ?? null,
        },
        services: {
          supermarkets: placesData.services?.supermarkets,
          supermarketDistM: placesData.services?.nearestSupermarketM,
          banks: placesData.services?.banks,
          parks: placesData.services?.parks,
          restaurants: placesData.services?.restaurants,
        },
      } : null,
    });

    // Re-run najemnina with prodajna vrednost for bruto donos calculation
    let etnNajemAnalizaFinal = etnNajemAnaliza;
    const prodajnaVrednost = etnAnalizaFinal?.ocenjenaTrznaVrednost ?? null;
    if (etnNajemAnaliza && prodajnaVrednost && useableArea) {
      const lokacijskiFaktor = etnAnalizaFinal?.lokacijskiPremium?.skupniFaktor ?? null;
      const withDonos = await getEtnNajemAnaliza(stavba.koId, useableArea, prodajnaVrednost, lokacijskiFaktor).catch(() => null);
      if (withDonos) etnNajemAnalizaFinal = withDonos;
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
        tip: stavba.steviloStanovanj != null && stavba.steviloStanovanj >= 3 ? "Večstanovanjska" : stavba.steviloStanovanj === 2 ? "Dvostanovanjska" : stavba.steviloStanovanj === 1 ? "Enostanovanjska" : stavba.tipStavbe,
        datumSys: stavba.datumSys,
        prikljucki: {
          elektrika: stavba.elektrika,
          plin: stavba.plin,
          vodovod: stavba.vodovod,
          kanalizacija: stavba.kanalizacija,
        },
        gasInfrastructure,
        visina: stavba.visina,
        tipPolozaja: tipPolozaja ?? null,
        kompaktnost: stavba.kompaktnost,
        orientacija: stavba.orientacija,
        obrisGeom: stavba.obrisGeom ?? null,
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
      etnAnaliza: etnAnalizaFinal,
      etnNajemAnaliza: etnNajemAnalizaFinal,
      totalBuildingArea,
      selectedUnitArea,
      seizmicniPodatki,
      poplavnaNevarnost,
      azbestRisk: getAzbestRisk(stavba.letoIzgradnje),
      osmData: osmData ?? null,
      placesData,
      lppLines: lppLines ?? null,
      oglasneAnalize: oglasneAnalize ?? null,
      koRentalYield: koRentalYield ?? null,
      saleToListRatio: saleToListRatio ?? null,
      propertyContext,
      trustedCorrections,
      correctionMap,
      // Tip prodaje: ločimo med prodajo enote in prodajo celotne stavbe
      tipProdaje: (() => {
        const imaParcele = parcele && parcele.length > 0;
        const jeEnostanovanjska = (stavba.steviloStanovanj ?? 0) <= 1;
        const imaDeleStavbe = deliStavbe.length > 1;
        const izbranaEnota = stDelaStavbe != null;
        if (imaDeleStavbe && izbranaEnota) return 'enota'; // stanovanje v večstanovanjski
        if (jeEnostanovanjska || !imaDeleStavbe) return 'stavba'; // hiša, vila, cela stavba
        if (imaParcele && !izbranaEnota) return 'parcela_s_stavbo';
        return 'enota'; // default
      })() as 'enota' | 'stavba' | 'parcela_s_stavbo',
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
