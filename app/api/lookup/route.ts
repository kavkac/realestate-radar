import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { lookupByAddress, getParcele, getRenVrednost, getOwnership, getParcelByNumber, getBuildingsByParcel, getBuildingParts, checkGasInfrastructure, getTipPolozajaStavbe, VRSTA_DEJANSKE_RABE, GursServiceUnavailableError } from "@/lib/gurs-api";
import { getSeizmicnaCona, getPoplavnaNevarnost, getAirQualityNearby, getNivojHrupa } from "@/lib/arso-api";
import { getAzbestRisk } from "@/lib/azbest";
import { lookupEnergyCertificate } from "@/lib/eiz-lookup";
import { estimateEiz } from "@/lib/eiz-estimator";
import { getEtnAnaliza, getEtnNajemAnaliza, getKoRentalYield, getSaleToListRatio, getEtnPropertySignals, getPriceSurfaceEstimate, getPropertySignals, getSursGrid, getLidarFeatures } from "@/lib/etn-lookup";
import { wgs84ToD96 } from "@/lib/wgs84-to-d96";
import { getOglasneAnalize } from "@/lib/listings-lookup";
import { buildPropertyContext } from "@/lib/property-context";
import { fetchOsmBuildingData } from "@/lib/osm-api";
import { getPlacesData } from "@/lib/places-api";
import { getLppLineCount } from "@/lib/lpp-lines";
import { getAirbnbStats } from "@/lib/airbnb";
import { prisma } from "@/lib/prisma";
import { getNeighborhoodProfile, calcProximityScore, getNearestWalkingTargets } from "@/lib/neighborhood-service";
import { parseListingText, calcListingValuationDelta, type ListingSignals } from "@/lib/listing-nlp";
import { izracunajStavbneKorekcije, izracunajVisinoStropov } from "@/lib/location-premium";
import { getSursMarketTrends } from "@/lib/surs-api";

// Helper: race a promise against a timeout — returns null if timeout fires
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => { onTimeout?.(); resolve(null); }, ms)),
  ]) as Promise<T | null>;
}

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

    // Disambiguation: same street name in multiple cities — ask user to pick
    if ("disambiguation" in result && result.disambiguation) {
      return NextResponse.json(
        { success: false, disambiguation: true, candidates: result.candidates },
        { status: 300 },
      );
    }

    let { stavba, deliStavbe, lat, lng } = result as Exclude<typeof result, import("@/lib/gurs-api").DisambiguationResult>;

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
    // Skupna površina (povrsina) = bruto standard za enote — kar ETN beleži in kar kupci vidijo.
    // uporabnaPovrsina je MANJŠA in jo NE smemo mešati z ETN metriko — nikoli je ne uporabimo.
    const totalBuildingArea = deliStavbe.reduce((sum, d) => sum + (d.povrsina ?? 0), 0) || null;

    // Za ETN analizo: ko ni enote izbrane, ne smemo uporabiti totalBuildingArea
    // (bi iskali "stanovanje 3000m²" → napačni comparables).
    // Namesto tega uporabimo povprečno skupno površino stanovanjskih enot.
    const stanovanjskeEnote = deliStavbe.filter(d => {
      const v = ((d as unknown as { vrstaRabe?: string; vrsta?: string }).vrstaRabe ?? (d as unknown as { vrsta?: string }).vrsta ?? "").toLowerCase();
      return v.includes("stanovan") || v === "" || v === "neznano";
    });
    const avgUnitArea = stanovanjskeEnote.length > 0
      ? stanovanjskeEnote.reduce((sum, d) => sum + (d.povrsina ?? 0), 0) / stanovanjskeEnote.length
      : null;
    // Bruto površina enote = skupna površina (d.povrsina). Nikoli ne pademo nazaj na uporabno.
    const useableArea = selectedUnit
      ? (selectedUnit.povrsina ?? null)
      : (avgUnitArea ?? null);

    // Also compute selected unit area separately for display
    const selectedUnitArea = selectedUnit
      ? (selectedUnit.povrsina ?? null)
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
        ? (selectedUnit.povrsina ?? null)
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

    // Track which external calls hit the timeout
    const timedOut: string[] = [];

    // DB fallback for steviloEtaz — GURS WFS often returns null for this field
    // ev_stavba.st_etaz is populated for 99%+ of buildings
    const stavbaDbRow = stavba.steviloEtaz == null
      ? await prisma.$queryRawUnsafe<{ st_etaz: string | null }[]>(
          `SELECT st_etaz FROM ev_stavba WHERE ko_sifko = $1 AND stev_st = $2 LIMIT 1`,
          stavba.koId,
          stavba.stStavbe,
        ).then(r => r[0] ?? null).catch(() => null)
      : null;
    const steviloEtazFinal: number | null = stavba.steviloEtaz
      ?? (stavbaDbRow?.st_etaz ? parseInt(stavbaDbRow.st_etaz) || null : null);

    // ── Unit-level user corrections resolved after correctionMap (late-bound) ──
    // correctedDvigalo / correctedVisinaM are assigned after correctionMap is built below
    // but declared here so they're in scope for ceiling chain Priority 0
    let correctedDvigalo: boolean | undefined = undefined;
    let correctedVisinaM: number | null = null;
    // (assigned at line ~441 after correctionMap is built)

    // ── Ceiling height priority chain ──────────────────────────────────────
    // Priority 0: user correction (visina_etaze from correctionMap) — HIGHEST
    // Priority 1: ev_del_stavbe.visina_etaze_net / visina_etaze (per unit, from DB)
    // Priority 2: kn_etaze.visina_etaze matched by eid_stavba + floor number
    // Priority 3: GURS WFS visina/etaze (existing fallback in izracunajVisinoStropov)
    // Priority 4: era defaults
    type CeilingRow = { eid_del_stavbe: string; visina_net: string | null; visina: string | null };
    const eidList = deliStavbe.map(d => d.eidDelStavbe).filter(Boolean);
    let ceilingByUnit: Map<string, number> = new Map();

    if (eidList.length > 0) {
      const ceilingRows = await prisma.$queryRawUnsafe<CeilingRow[]>(
        `SELECT eid_del_stavbe::text, visina_etaze_net::text as visina_net, visina_etaze::text as visina
         FROM ev_del_stavbe
         WHERE eid_del_stavbe = ANY($1::text[])
           AND (visina_etaze_net IS NOT NULL OR visina_etaze IS NOT NULL)`,
        eidList.map(String),
      ).catch(() => [] as CeilingRow[]);

      for (const r of ceilingRows) {
        const raw = r.visina_net ?? r.visina;
        const v = raw ? parseFloat(raw) : null;
        if (v && v >= 1.8 && v <= 6.0) {
          ceilingByUnit.set(r.eid_del_stavbe, v);
        }
      }

      // Priority 2: kn_etaze fallback for units not yet covered
      const missing = eidList.filter(e => !ceilingByUnit.has(String(e)));
      if (missing.length > 0 && stavba.eidStavba) {
        type KnRow = { eid_stavba: string; visina_etaze: string | null };
        const knRows = await prisma.$queryRawUnsafe<KnRow[]>(
          `SELECT eid_stavba::text, AVG(visina_etaze::numeric)::text as visina_etaze
           FROM kn_etaze
           WHERE eid_stavba = $1 AND visina_etaze IS NOT NULL
           GROUP BY eid_stavba`,
          stavba.eidStavba,
        ).catch(() => [] as KnRow[]);

        if (knRows[0]?.visina_etaze) {
          const knV = parseFloat(knRows[0].visina_etaze);
          if (knV >= 1.8 && knV <= 6.0) {
            for (const eid of missing) {
              ceilingByUnit.set(String(eid), knV);
            }
          }
        }
      }
    }

    // Priority 0: user correction overrides everything — applies to all units of this stavba
    if (correctedVisinaM != null) {
      for (const eid of eidList) {
        ceilingByUnit.set(String(eid), correctedVisinaM);
      }
    }
    // ── End ceiling height chain ────────────────────────────────────────────

    // Neighborhood profile — prestart BEFORE Promise.all so it runs truly parallel
    // This is the biggest sequential bottleneck (Overpass 5-8s)
    const neighborhoodProfilePromise =
      lat != null && lng != null
        ? withTimeout(getNeighborhoodProfile(lat, lng).catch(() => null), 5000, () => timedOut.push('neighborhood'))
        : Promise.resolve(null);

    // Gas infrastructure — non-blocking, moved into parallel batch below
    const gasInfrastructurePromise =
      lat != null && lng != null
        ? withTimeout(checkGasInfrastructure(lat, lng).catch(() => null), 5000, () => timedOut.push('gasInfrastructure'))
        : Promise.resolve(null);

    // OSM Overpass enrichment (non-blocking, parallel)
    const osmDataPromise =
      lat != null && lng != null
        ? withTimeout(fetchOsmBuildingData(lat, lng).catch(() => null), 5000, () => timedOut.push('osmData'))
        : Promise.resolve(null);

    // Google Places — transit + amenitete (non-blocking, per-usage pricing ~$0.13/lookup)
    const placesDataPromise =
      lat != null && lng != null
        ? withTimeout(getPlacesData(lat, lng).catch(() => null), 5000, () => timedOut.push('placesData'))
        : Promise.resolve(null);

    // Oglasne cene — vzporedno z ostalimi klici
    const oglasneAnalizePromise = getOglasneAnalize(stavba.koId, null).catch(() => null);

    // LPP bus lines via Overpass relations (non-blocking)
    const lppLinesPromise =
      lat != null && lng != null
        ? withTimeout(getLppLineCount(lat, lng).catch(() => null), 5000, () => timedOut.push('lppLines'))
        : Promise.resolve(null);

    // Airbnb short-term rental stats (non-blocking)
    const airbnbStatsPromise =
      lat != null && lng != null
        ? withTimeout(getAirbnbStats(lat, lng, 500).catch(() => null), 5000, () => timedOut.push('airbnbStats'))
        : Promise.resolve(null);

    // Fetch energy certificate, parcele, REN vrednost, ETN analysis, ownership, EV, KN namembnost, and rental yield in parallel
    // Convert lat/lng to D-96/TM for spatial lookups
    const d96Coords = lat != null && lng != null ? wgs84ToD96(lat, lng) : null;

    // Cap ownership lookups to first 8 units to avoid 20+ parallel GURS calls
    const ownershipUnits = deliStavbe.slice(0, 8);

    const [energyCertResult, parcele, renVrednost, etnAnaliza, etnNajemAnaliza, tipPolozaja, seizmicniPodatki, poplavnaNevarnost, kakovostZraka, nivojHrupa, osmData, lppLines, airbnbStats, koRentalYield, saleToListRatio, priceSurface, propSignals, sursGrid, lidarFeatures, evResults, namembnostResults, gasInfrastructure, sursMarketTrends, ...ownershipResults] = await Promise.all([
      lookupEnergyCertificate({
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe,
      }).catch(() => ({ cert: null, source: null as "stanovanje" | "stavba" | null })),
      withTimeout(getParcele(stavba.koId, stavba.stStavbe, lat, lng, stavba.obrisGeom ?? null), 6000, () => timedOut.push('parcele')),
      withTimeout(getRenVrednost(stavba.koId, stavba.stStavbe), 6000, () => timedOut.push('renVrednost')),
      // ETN — single call, no sequential fallback
      getEtnAnaliza(stavba.koId, useableArea, null, etnDejanskaRaba ?? null, lat, lng, null, stavba.stStavbe).catch(() => null),
      getEtnNajemAnaliza(stavba.koId, useableArea).catch(() => null),
      withTimeout(getTipPolozajaStavbe(stavba.eidStavba, stavba.koId).catch(() => null), 5000, () => timedOut.push('tipPolozaja')),
      lat != null && lng != null ? withTimeout(getSeizmicnaCona(lat, lng).catch(() => null), 5000, () => timedOut.push('seizmicniPodatki')) : Promise.resolve(null),
      lat != null && lng != null ? withTimeout(getPoplavnaNevarnost(lat, lng).catch(() => null), 5000, () => timedOut.push('poplavnaNevarnost')) : Promise.resolve(null),
      lat != null && lng != null ? withTimeout(getAirQualityNearby(lat, lng).catch(() => null), 5000, () => timedOut.push('kakovostZraka')) : Promise.resolve(null),
      lat != null && lng != null ? withTimeout(getNivojHrupa(lat, lng).catch(() => null), 5000, () => timedOut.push('nivojHrupa')) : Promise.resolve(null),
      osmDataPromise,
      lppLinesPromise,
      airbnbStatsPromise,
      getKoRentalYield(stavba.koId).catch(() => null),
      getSaleToListRatio(stavba.koId).catch(() => null),
      d96Coords ? getPriceSurfaceEstimate(d96Coords.e, d96Coords.n).catch(() => null) : Promise.resolve(null),
      stavba.eidStavba ? getPropertySignals(stavba.eidStavba).catch(() => null) : Promise.resolve(null),
      d96Coords ? getSursGrid(d96Coords.e, d96Coords.n).catch(() => null) : Promise.resolve(null),
      stavba.eidStavba ? getLidarFeatures(stavba.eidStavba).catch(() => null) : Promise.resolve(null),
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
      // Gas infrastructure now parallel (was sequential await before)
      gasInfrastructurePromise,
      // SURS market trends (cached 6h)
      getSursMarketTrends().catch(() => null),
      ...ownershipUnits.map((d) => withTimeout(getOwnership(d.eidDelStavbe).catch(() => [] as Awaited<ReturnType<typeof getOwnership>>), 5000, () => timedOut.push('ownership')).then(r => r ?? [])),
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

    // Resolve unit-level corrections now that correctionMap is available
    if (correctionMap.dvigalo != null)
      correctedDvigalo = correctionMap.dvigalo === "Da" || correctionMap.dvigalo === "true" || correctionMap.dvigalo === "1";
    if (correctionMap.visina_etaze) {
      const _v = parseFloat(correctionMap.visina_etaze);
      if (!isNaN(_v) && _v > 1.5 && _v < 6) correctedVisinaM = _v;
    }

    // Apply ALL trusted user corrections to stavba/unit fields
    // These override GURS register data for valuation purposes
    if (correctionMap.fasada_leto)
      stavba = { ...stavba, letoObnoveFasade: parseInt(correctionMap.fasada_leto) || stavba.letoObnoveFasade };
    if (correctionMap.streha_leto)
      stavba = { ...stavba, letoObnoveStrehe: parseInt(correctionMap.streha_leto) || stavba.letoObnoveStrehe };
    if (correctionMap.leto_izgradnje)
      stavba = { ...stavba, letoIzgradnje: parseInt(correctionMap.leto_izgradnje) || stavba.letoIzgradnje };

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
      // Uradna EIZ — iz registra energetskih izkaznic (MOP)
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
        sourceStDela: energyCertResult.sourceStDela ?? null,
        ocenjena: false,
      };
    } else if (stavba.eidStavba && lat != null && lng != null) {
      // Ni uradne EIZ — algoritmična ocena (EN 13790)
      try {
        const eizOcena = await estimateEiz({
          eidStavba: stavba.eidStavba,
          eidDelStavbe: selectedUnit?.eidDelStavbe ?? undefined,
          lat,
          lng,
          municipality: null, // TODO: resolve from koId → obcina name
          lidarHeightM: lidarFeatures?.buildingHeightM ?? null,
          lidarRoofAreaM2: lidarFeatures?.roofAreaM2 ?? null,
          lidarWallAreaM2: lidarFeatures?.facadeAreaM2 ?? null,
        });
        if (eizOcena) {
          energetskaIzkaznica = {
            razred: eizOcena.energyClass,
            potrebnaTopota: eizOcena.heatingNeedKwhM2,
            primaryEnergy: eizOcena.primaryEnergyKwhM2,
            co2: eizOcena.co2KgM2,
            kondicionirana: eizOcena.inputs.conditionedAreaM2,
            source: "ocena",
            ocenjena: true,
            ocenaZaupanje: eizOcena.confidence,
            ocenaViriPodatkov: eizOcena.dataQuality,
            ocenaVhodi: eizOcena.inputs,
            ocenaOpomba: eizOcena.disclaimer,
          };
        }
      } catch (e) {
        console.error("[lookup] EIZ estimate failed:", e);
      }
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
    // Če ni uradnega certifikata, uporabi algoritmično oceno (estimateEiz)
    // ocenjena = true pomeni algoritmična ocena, ne uradni certifikat
    const effectiveEnergyClass = certEnergyClass
      ?? (energetskaIzkaznica?.ocenjena ? energetskaIzkaznica.razred : null);
    const osmAmenitiesCount = osmData ? (Object.values(osmData as Record<string, unknown[]>).flat().length) : null;

    // Proximity score — walking-time-based valuation signal
    // Najprej poskusimo iz cache (neighborhood_cache), sicer hitri OSRM fetch
    let proximityScore: number | null = null;
    let neighborhoodTags: string[] | null = null;
    if (lat != null && lng != null) {
      try {
        // Use pre-started promise (running since before main Promise.all)
        const nbProfile = await neighborhoodProfilePromise;
        neighborhoodTags = nbProfile?.characterTags ?? null;
        if ((nbProfile as any)?.proximityScore != null) {
          proximityScore = (nbProfile as any).proximityScore;
        } else {
          // OSRM walking targets — fast (own server), keep sequential but capped
          const walking = await withTimeout(getNearestWalkingTargets(lat, lng), 3000) ?? [];
          const noiseDb = nbProfile?.noiseLdenDb ?? null;
          proximityScore = calcProximityScore(walking, noiseDb);
        }
      } catch { /* proximity je bonus, ne blokiramo valuacije */ }
    }

    // Single refined ETN call (with lega + energy class + proximity)
    // Replaces the previous double sequential fallback pattern
    if (useableArea && (effectiveEnergyClass || idLega || stNadstropja)) {
      const refined = await getEtnAnaliza(
        stavba.koId, useableArea, effectiveEnergyClass ?? null, etnDejanskaRaba,
        lat, lng, osmAmenitiesCount, stavba.stStavbe, idLega, stNadstropja,
        proximityScore, neighborhoodTags,
        energetskaIzkaznica?.ocenjena ?? false  // isOcenjenaEiz — halve negative correction for estimates
      ).catch(() => null);
      if (refined) etnAnalizaFinal = refined;
    }

    // NLP signals — iz shranjenih opisov v listings_oglasi (če obstajajo)
    let listingNlpSignals: ListingSignals | null = null;
    let listingNlpDatum: string | null = null;
    let listingValuationDelta: ReturnType<typeof calcListingValuationDelta> | null = null;
    try {
      // VARNO: matchiramo samo na stavba_eid (ne na KO-nivo!).
      // Ko bo listings_oglasi.stavba_eid implementiran, preberi iz property_signals
      // kjer stavba_eid = stavba.eidStavba AND match_confidence >= 0.95.
      // Dokler stavba_eid kolona ne obstaja, NLP signalov NE prikazujemo —
      // bolje nič kot napačen podatek (Jaka 24.3.2026).
      type CheckRow = { exists: boolean };
      const colCheck = await prisma.$queryRawUnsafe<CheckRow[]>(
        `SELECT EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_name='listings_oglasi' AND column_name='stavba_eid'
         ) as exists`
      );
      const hasEidCol = colCheck[0]?.exists === true;

      if (hasEidCol && stavba.eidStavba) {
        // Matched listing — samo če imamo točen stavba_eid match
        type NlpRow = { nlp_signals: Record<string, unknown> | null; datum_zajet: Date | null; match_confidence: number | null };
        const nlpRows = await prisma.$queryRawUnsafe<NlpRow[]>(
          `SELECT nlp_signals, datum_zajet, match_confidence FROM listings_oglasi
           WHERE stavba_eid = $1 AND nlp_signals IS NOT NULL
             AND COALESCE(match_confidence, 0) >= 0.95
           ORDER BY datum_zajet DESC LIMIT 1`,
          stavba.eidStavba
        );
        if (nlpRows[0]?.nlp_signals) {
          listingNlpSignals = nlpRows[0].nlp_signals as unknown as ListingSignals;
          listingNlpDatum = nlpRows[0].datum_zajet?.toISOString().slice(0, 10) ?? null;
        }
      }
      // else: stavba_eid kolona ne obstaja → ne prikazujemo listing NLP (intentional)

      if (listingNlpSignals) {
        listingValuationDelta = calcListingValuationDelta(listingNlpSignals, stNadstropja);
      }
    } catch { /* NLP je bonus, ne blokiramo */ }

    // ETN property signals — stevilo_sob, parking, novogradnja iz etn_delistavb
    let etnPropertySignals = null;
    try {
      const stDelList = deliStavbe?.map(d => String(d.stDelaStavbe ?? "")).filter(Boolean) ?? [];
      etnPropertySignals = await getEtnPropertySignals(
        String(stavba.koId),
        String(stavba.stStavbe),
        stDelList,
      );
    } catch { /* bonus */ }

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
          supermarkets: placesData.services?.supermarkets ?? 0,
          nearestSupermarketM: placesData.services?.nearestSupermarketM ?? null,
          pharmacies: placesData.services?.pharmacies ?? 0,
          nearestPharmacyM: placesData.services?.nearestPharmacyM ?? null,
          schools: placesData.services?.schools ?? 0,
          kindergartens: placesData.services?.kindergartens ?? 0,
          banks: placesData.services?.banks ?? 0,
          postOffices: placesData.services?.postOffices ?? 0,
          parks: placesData.services?.parks ?? 0,
          nearestParkM: placesData.services?.nearestParkM ?? null,
          restaurants: placesData.services?.restaurants ?? 0,
          doctors: placesData.services?.doctors ?? 0,
          hospitals: placesData.services?.hospitals ?? 0,
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

    // === BLENDED ESTIMATE ===
    let blendedEstimate: { eur_m2: number; method: string; etn_weight: number; surface_weight: number } | null = null;
    const etnEurM2 = etnAnalizaFinal?.medianaCenaM2 ?? null;
    const surfaceEurM2 = priceSurface?.price_eur_m2 ?? null;

    if (etnEurM2 != null && surfaceEurM2 != null) {
      const etnComps = etnAnalizaFinal?.steviloTransakcij ?? 0;
      const etnVir = etnAnalizaFinal?.vir ?? null;
      // Heatmap je fallback — ko ima ETN dobre podatke, ga ne mesamo
      // proximity L1 ali >=5 transakcij → 100% ETN, heatmap ignoriramo
      let etnWeight: number;
      let surfaceWeight: number;
      let blendMethod: string;
      // Dinamicni blend: heatmap nikoli 0 — doda prostorski kontekst (gradient sosescine)
      // Vec ETN podatkov = vecji ETN weight, ampak heatmap vedno prispeva vsaj 15-20%
      if (etnVir === "proximity" && etnComps >= 15) {
        etnWeight = 0.80; surfaceWeight = 0.20; blendMethod = "etn-dominant";
      } else if (etnVir === "proximity" && etnComps >= 8) {
        etnWeight = 0.70; surfaceWeight = 0.30; blendMethod = "etn-dominant";
      } else if (etnComps >= 5) {
        etnWeight = 0.60; surfaceWeight = 0.40; blendMethod = "etn-balanced";
      } else if (etnComps >= 3) {
        etnWeight = 0.40; surfaceWeight = 0.60; blendMethod = "surface-dominant";
      } else {
        etnWeight = 0.20; surfaceWeight = 0.80; blendMethod = "surface-dominant";
      }
      blendedEstimate = {
        eur_m2: Math.round(etnWeight * etnEurM2 + surfaceWeight * surfaceEurM2),
        method: blendMethod,
        etn_weight: etnWeight,
        surface_weight: surfaceWeight,
      };
    }

    // === STAVBNE KOREKCIJE (server-side, enak izračun kot jakakavcic.com) ===
    const selectedUnitForKorekcije = selectedUnit;
    const stavbneKorekcijeResult = izracunajStavbneKorekcije({
      // Varstvo: iz property_signals DB, fallback na propertyContext heuristiko
      // (historicna stavba v centru mesta → verjetno kulturno varstvo)
      varuje: (propSignals?.is_heritage ?? false) ||
        (propertyContext?.stavba?.starostKategorija === "historicna" &&
         propertyContext?.lokacija?.kategorija === "center"),
      dvigalo: selectedUnitForKorekcije?.dvigalo ?? undefined,
      steviloEtaz: stavba.steviloEtaz ?? null,
      letoObnoveInstalacij: selectedUnitForKorekcije?.letoObnoveInstalacij ?? null,
      letoObnoveOken: selectedUnitForKorekcije?.letoObnoveOken ?? null,
      letoObnoveFasade: stavba.letoObnoveFasade ?? null,
      letoObnoveSrehe: stavba.letoObnoveStrehe ?? null,
      letoIzgradnje: stavba.letoIzgradnje ?? null,
      konstrukcija: stavba.nosilnaKonstrukcija ?? null,
      letniPodatki: etnAnalizaFinal?.letniPodatki ?? undefined,
      steviloTransakcij: etnAnalizaFinal?.steviloTransakcij ?? undefined,
      // Nadstropje — floor premium/malus
      stNadstropja: stNadstropja ?? null,
      // LIDAR — viewshed, water/mountain visibility
      lidarViewshedScore: lidarFeatures?.viewshedScore ?? null,
      lidarWaterVisibility: lidarFeatures?.waterVisibility ?? null,
      lidarMountainVisibility: lidarFeatures?.mountainVisibility ?? null,
      lidarPoiVisibility: lidarFeatures?.poiVisibility ?? null,
      lidarMountainDetail: lidarFeatures?.mountainVisibilityDetail ?? null,
      lidarFacadeOrientations: lidarFeatures?.facadeOrientations ?? null,
      lidarRoofAreaM2: lidarFeatures?.roofAreaM2 ?? null,
      lidarFacadeAreaM2: lidarFeatures?.facadeAreaM2 ?? null,
      lidarFloorHeightM: lidarFeatures?.floorHeightM ?? null,
      lidarWaterFloorMin: lidarFeatures?.waterVisibilityFloorMin ?? null,
      lidarWaterDistanceM: lidarFeatures?.waterVisibilityDistanceM ?? null,
      lidarCanopyCover200m: lidarFeatures?.canopyCover200mPct ?? null,
      lidarQualityFlag: lidarFeatures?.qualityFlag ?? null,
    });

    // Višina stropov (stropi korekcija) — iz visinaEtaze enote ali iz starosti stavbe
    const unitCeilingCm = selectedUnitForKorekcije
      ? (selectedUnitForKorekcije as { visinaEtaze?: number | null }).visinaEtaze ?? null
      : null;
    const visinaStropovResult = izracunajVisinoStropov(
      (typeof stavba.visina === "number" ? stavba.visina : null),
      stavba.steviloEtaz ?? null,
      stavba.letoIzgradnje ?? null,
      idLega ?? null,
    );
    // Prefer unit-level ceiling if available, else use building estimate
    const stropiKorekcija = unitCeilingCm != null && unitCeilingCm > 150
      ? (unitCeilingCm >= 320 ? 0.05 : unitCeilingCm >= 290 ? 0.02 : unitCeilingCm < 250 ? -0.03 : 0)
      : visinaStropovResult.korekcija;
    if (stropiKorekcija !== 0) {
      stavbneKorekcijeResult.faktorji.unshift({
        naziv: `${unitCeilingCm ?? visinaStropovResult.visinaCm}cm stropi`,
        ikona: "📐",
        opis: `Svetla višina ${unitCeilingCm ?? visinaStropovResult.visinaCm}cm`,
        korekcija: stropiKorekcija,
      });
      // Recompute skupniFaktor with stropi
      const raw = stavbneKorekcijeResult.faktorji.reduce((acc, f) => acc * (1 + f.korekcija), 1);
      stavbneKorekcijeResult.skupniFaktor = Math.max(0.70, Math.min(1.30, raw));
    }

    // Annotate vsak faktor z virom (zakaj je bil aktiviran) — za debug/pipeline prikaz
    const varujeFallback = !(propSignals?.is_heritage ?? false) &&
      (propertyContext?.stavba?.starostKategorija === "historicna" &&
       propertyContext?.lokacija?.kategorija === "center");
    for (const f of stavbneKorekcijeResult.faktorji) {
      const n = f.naziv?.toLowerCase() ?? "";
      if (n.includes("varstvo")) {
        f.vir = propSignals?.is_heritage
          ? `propertySignals.is_heritage = true`
          : varujeFallback
            ? `Fallback: letoIzgradnje=${stavba.letoIzgradnje} (historična) + lokacija.kategorija=center`
            : `propertySignals.is_heritage = false`;
      } else if (n.includes("dvigalo")) {
        const unit = selectedUnit;
        f.vir = `deliStavbe.dvigalo=${unit?.dvigalo ?? "?"}, steviloEtaz=${stavba.steviloEtaz ?? "?"}`;
      } else if (n.includes("zastar")) {
        f.vir = `letoIzgradnje=${stavba.letoIzgradnje}, nobene sveže obnove <10 let`;
      } else if (n.includes("obnov") || n.includes("svež")) {
        f.vir = `Sveža obnova: instalacije=${selectedUnit?.letoObnoveInstalacij ?? "?"}, okna=${selectedUnit?.letoObnoveOken ?? "?"}, fasada=${stavba.letoObnoveFasade ?? "?"}`;
      } else if (n.includes("stropi") || n.includes("cm")) {
        const unitCeil = selectedUnit ? (selectedUnit as unknown as Record<string, unknown>).visinaEtaze : null;
        f.vir = unitCeil
          ? `deliStavbe.visinaEtaze=${unitCeil}cm`
          : `Ocena iz starosti stavbe: letoIzgradnje=${stavba.letoIzgradnje}`;
      }
    }

    // === PROPERTY SIGNAL MODIFIERS ===
    const appliedModifiers: string[] = [];
    if (blendedEstimate && propSignals) {
      let multiplier = 1.0;

      // river_view multi-source:
      // propSignals.river_view=true = enrich potrdi stavba znotraj 100m vodotoka (OSM)
      // Ob Ljubljanici +10% v lokaciji = soseščinski premium (geografski)
      // river_view signal tukaj = ENOTA-specifičen premium za direktni pogled
      // Prioriteta: LiDAR > etaža (ocena) > pritličje (0)
      if (propSignals.river_view === true) {
        const lidarWater = lidarFeatures?.waterVisibility ?? null;
        const lidarViewshed = lidarFeatures?.viewshedScore ?? null;
        const etaza = stNadstropja ?? null;
        let riverViewPremium = 0;
        let riverViewSource = "";

        if (lidarWater === true) {
          const viewBonus = (lidarViewshed != null && lidarViewshed > 60) ? 0.07
            : (etaza != null && etaza >= 3) ? 0.06 : 0.05;
          riverViewPremium = viewBonus;
          riverViewSource = `LiDAR viewshed potrjen${etaza != null ? `, ${etaza}. nadstropje` : ""}`;
        } else if (lidarWater === false) {
          riverViewPremium = 0;
          // LIDAR pravi ni pogleda — 0, ne dodajamo
        } else {
          // Brez LIDAR — ocena iz etaže
          if (etaza != null && etaza >= 3) {
            riverViewPremium = 0.04;
            riverViewSource = `Verjetni pogled: ${etaza}. nadstropje, stavba ob vodi (brez LiDAR)`;
          } else if (etaza != null && etaza <= 1) {
            riverViewPremium = 0; // pritličje/1. nad — verjetno blokirano
          } else {
            riverViewPremium = 0.02;
            riverViewSource = `Možni pogled: stavba ob vodi, etaža neznana (brez LiDAR)`;
          }
        }

        if (riverViewPremium > 0) {
          multiplier *= (1 + riverViewPremium);
          appliedModifiers.push(`river_view +${Math.round(riverViewPremium * 100)}% (${riverViewSource})`);
        }
      }

      // is_heritage: že v stavbneKorekcije (Varstvo +12%) — ne dodajamo dvakrat
      // heritage_neighborhood: OK — soseska, ne stavba, unikaten signal
      if (propSignals.heritage_neighborhood_score != null && propSignals.heritage_neighborhood_score >= 5) {
        const nbScore = propSignals.heritage_neighborhood_score;
        const nbFactor = nbScore >= 50 ? 0.02 : 0.01; // 50+ → +2%, 5-49 → +1%
        multiplier *= (1 + nbFactor);
        appliedModifiers.push(`heritage_neighborhood ${nbScore}/100 +${Math.round(nbFactor * 100)}%`);
      }

      // energy_rating: že v Node 4 (energetskaKorekcija) — ne apliciramo dvakrat
      // Samo prikažemo v Node 10 za informacijo (brez multiplikacije)
      if (propSignals.energy_rating) {
        appliedModifiers.push(`energy_rating iz DB: ${propSignals.energy_rating} (korekcija že v Node 4)`);
      }

      // --- FLOOD RISK (poplavnaNevarnost) ---
      // Vir: ARSO OPKP Shapefile (arso_flood_zones), 4479 poligonov
      // Literatura: Bin & Polasky (2004): -6% visoka, Lamond et al: -3% srednja
      if (poplavnaNevarnost?.stopnja === "visoka") {
        multiplier *= 0.94;
        appliedModifiers.push(`flood_risk visoka -6% (ARSO OPKP)`);
      } else if (poplavnaNevarnost?.stopnja === "srednja") {
        multiplier *= 0.97;
        appliedModifiers.push(`flood_risk srednja -3% (ARSO OPKP)`);
      } else if (poplavnaNevarnost?.stopnja === "nizka") {
        multiplier *= 0.99;
        appliedModifiers.push(`flood_risk nizka -1% (ARSO OPKP)`);
      }

      // --- NOISE LEVEL (nivojHrupa) ---
      // Vir: ARSO karte hrupa, real-time ArcGIS REST
      // Literatura: Nelson (2004): -0.5% per dB nad 55 dB; Bateman (2001): -0.6% per dB
      if (nivojHrupa?.lden != null) {
        const lden = nivojHrupa.lden;
        if (lden >= 65) {
          const dbOver = Math.min(lden - 65, 20); // cap at 20dB
          const discount = -(dbOver * 0.006 + 0.05); // -5% base + -0.6% per dB nad 65
          multiplier *= (1 + discount);
          appliedModifiers.push(`noise_hrupno ${lden}dB ${Math.round(discount * 100)}% (${nivojHrupa.vir ?? "ARSO"})`);
        } else if (lden >= 55) {
          const dbOver = lden - 55;
          const discount = -(dbOver * 0.005); // -0.5% per dB nad 55
          multiplier *= (1 + discount);
          appliedModifiers.push(`noise_zmerno ${lden}dB ${Math.round(discount * 100)}% (${nivojHrupa.vir ?? "ARSO"})`);
        }
        // lden < 55 = tiho = ni korekcije (ali blagi +1% za mir)
        if (lden < 45) {
          multiplier *= 1.01;
          appliedModifiers.push(`noise_tiho ${lden}dB +1% (${nivojHrupa.vir ?? "ARSO"})`);
        }
      }

      // --- AIR QUALITY (kakovostZraka) ---
      // Vir: OpenAQ v3, ARSO postaje
      // Literatura: Ridker & Henning (1967), Kim et al (2003): -1.5% slaba kakovost
      if (kakovostZraka?.index === "slaba") {
        multiplier *= 0.985;
        appliedModifiers.push(`air_quality slaba (PM2.5=${kakovostZraka.pm25}, NO2=${kakovostZraka.no2}) -1.5%`);
      } else if (kakovostZraka?.index === "dobra" && (kakovostZraka.station_distance_km ?? 99) < 10) {
        multiplier *= 1.005;
        appliedModifiers.push(`air_quality dobra (PM2.5=${kakovostZraka.pm25}) +0.5%`);
      }

      if (multiplier !== 1.0) {
        blendedEstimate.eur_m2 = Math.round(blendedEstimate.eur_m2 * multiplier);
      }
    }

    // Build structured property alerts for frontend banners/badges
    const propertyAlerts: Array<{
      id: string;
      severity: "danger" | "warning" | "info";
      title: string;
      description: string;
      icon: string;
    }> = [];

    if (poplavnaNevarnost?.stopnja === "visoka") {
      propertyAlerts.push({
        id: "flood_high",
        severity: "danger",
        title: "Visoka poplavna nevarnost",
        description: poplavnaNevarnost.opis ?? "Lokacija leži v območju visoke poplavne nevarnosti (ARSO OPKP). Pogosto poplavljeno območje.",
        icon: "🌊",
      });
    } else if (poplavnaNevarnost?.stopnja === "srednja") {
      propertyAlerts.push({
        id: "flood_medium",
        severity: "warning",
        title: "Srednja poplavna nevarnost",
        description: poplavnaNevarnost.opis ?? "Lokacija leži v območju srednje poplavne nevarnosti (ARSO OPKP). Občasno poplavljeno območje.",
        icon: "⚠️",
      });
    } else if (poplavnaNevarnost?.stopnja === "nizka") {
      propertyAlerts.push({
        id: "flood_low",
        severity: "info",
        title: "Nizka poplavna nevarnost",
        description: poplavnaNevarnost.opis ?? "Lokacija leži v območju nizke poplavne nevarnosti (ARSO OPKP).",
        icon: "💧",
      });
    }

    if (nivojHrupa?.ocena === "hrupno" && nivojHrupa.lden != null) {
      propertyAlerts.push({
        id: "noise_high",
        severity: "warning",
        title: `Visok hrup (${nivojHrupa.lden} dB Lden)`,
        description: `Lokacija je izpostavljena visoki ravni hrupa (vir: ${nivojHrupa.vir ?? "promet"}). Vrednost ${nivojHrupa.lden} dB presega priporočenih 65 dB.`,
        icon: "🔊",
      });
    }

    if (kakovostZraka?.index === "slaba") {
      propertyAlerts.push({
        id: "air_poor",
        severity: "warning",
        title: "Slaba kakovost zraka",
        description: `PM2.5: ${kakovostZraka.pm25 ?? "?"} µg/m³, NO2: ${kakovostZraka.no2 ?? "?"} µg/m³ (postaja: ${kakovostZraka.station_name ?? "ARSO"}, ${kakovostZraka.station_distance_km ?? "?"}km)`,
        icon: "💨",
      });
    }

    return NextResponse.json({
      success: true,
      _meta: {
        fast: true,
        timedOut: Array.from(new Set(timedOut)),
      },
      propertyAlerts,
      naslov: address,
      lat,
      lng,
      enolicniId: {
        koId: stavba.koId,
        stStavbe: stavba.stStavbe,
        stDelaStavbe: stDelaStavbe ?? null,
      },
      stavba: {
        eidStavba: stavba.eidStavba,
        nosilnaKonstrukcija: stavba.nosilnaKonstrukcija ?? null,
        letoIzgradnje: stavba.letoIzgradnje,
        letoObnove: {
          fasade: stavba.letoObnoveFasade,
          strehe: stavba.letoObnoveStrehe,
        },
        steviloEtaz: steviloEtazFinal,
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
        visinaEtaze: ceilingByUnit.get(String(d.eidDelStavbe)) ?? null,
        uporabnaPovrsina: d.uporabnaPovrsina,
        vrsta: namembnostResults[i]?.vrstaNamembnosti
          ? (VRSTA_DEJANSKE_RABE[namembnostResults[i]!.vrstaNamembnosti!] ?? d.vrsta)
          : d.vrsta,
        letoObnoveInstalacij: d.letoObnoveInstalacij,
        letoObnoveOken: d.letoObnoveOken,
        // User correction overrides GURS register for dvigalo
        dvigalo: correctedDvigalo !== undefined ? correctedDvigalo : d.dvigalo,
        prostori: d.prostori,
        etazaDelStavbe: d.etazaDelStavbe,
        vrstaStanovanjaUradno: d.vrstaStanovanjaUradno,
        lastnistvo: i < ownershipUnits.length ? (ownershipResults[i] ?? []) : [],
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
      kakovostZraka,
      nivojHrupa,
      azbestRisk: getAzbestRisk(stavba.letoIzgradnje),
      osmData: osmData ?? null,
      placesData,
      lppLines: lppLines ?? null,
      oglasneAnalize: oglasneAnalize ?? null,
      listingNlpSignals: listingNlpSignals ?? null,
      etnPropertySignals: etnPropertySignals ?? null,
      listingNlpDatum: listingNlpDatum ?? null,
      listingValuationDelta: listingValuationDelta ?? null,
      koRentalYield: koRentalYield ?? null,
      saleToListRatio: saleToListRatio ?? null,
      airbnbStats: airbnbStats ?? null,
      priceSurface: priceSurface ?? null,
      propertySignals: propSignals ?? null,
      sursGrid: sursGrid ?? null,
      sursMarketTrends: sursMarketTrends ?? null,
      lidarFeatures: lidarFeatures ?? null,
      stavbneKorekcije: stavbneKorekcijeResult,
      blendedEstimate: blendedEstimate
        ? {
            ...blendedEstimate,
            // Apliciramo stavbneFaktor na blend (energy + location sta v etn dela že)
            eur_m2_corrected: Math.round(blendedEstimate.eur_m2 * stavbneKorekcijeResult.skupniFaktor),
            stavbne_factor: stavbneKorekcijeResult.skupniFaktor,
            appliedModifiers,
          }
        : null,
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

// CORS preflight for rer-pipeline.vercel.app
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://rer-pipeline.vercel.app",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
