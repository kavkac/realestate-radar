/**
 * Property Context Engine — deterministični algoritem za oceno prednosti/slabosti nepremičnine.
 *
 * Zasnovan na statistični analizi ETN podatkov (n=12,018 transakcij):
 * - KO lokacija:   R² 59.8% — absolutni kralj
 * - Leto izgradnje: R² 8.4%  — edini ne-lokacijski signal
 * - Površina:       R² 0.7%  — šum, ignoriramo
 * - Nadstropje:     R² 0.9%  — šum, ignoriramo
 * - EIZ razred:     R² 1.9%  — šum + napačen matching, ignoriramo
 * - OSM amenity:    kolinearen z KO, ignoriramo
 *
 * KO_KALIBRACIJSKI_FAKTOR ostane ZUNAJ PropertyContext — kalibrira base_price.
 * PropertyContext meri odmik od kalibriranega baseline-a.
 */

export interface LocationScore {
  distancaCenterKm: number | null;
  kategorija: "center" | "primestno" | "obrobje" | "ruralno" | null;
  score: number; // 0–100
  confidence: number; // 0–1
}

export interface BuildingScore {
  letoIzgradnje: number | null;
  starostKategorija:
    | "novo"
    | "moderna"
    | "srednja"
    | "stara"
    | "historicna"
    | null;
  score: number; // 0–100
  confidence: number; // 0–1
}

export interface MarketScore {
  medianaCenaM2: number | null;
  steviloTransakcij: number | null;
  virEtn: "proximity" | "ko" | "regija" | "nacional" | null;
  zaupanje: 1 | 2 | 3 | 4 | 5 | null;
  // Oglasne cene (leading indicator)
  oglasMedianaCenaM2: number | null;
  oglasStevilo: number | null;
  discountEtnOglas: number | null; // % razlika med ETN in oglasi (+ = oglasi višji)
  trendYoY: number | null; // % sprememba YoY iz ETN
  score: number; // 0–100
  confidence: number; // 0–1
}

export interface RiskPenalty {
  poplavnaNevarnost: boolean;
  visokaSeizmicnost: boolean; // zona 3+
  kulturnoVarstvo: boolean; // omejitve prenove
  brezParkinga: boolean;
  staraElektrika: boolean; // pre-1970 brez dokazila o obnovi
  penalty: number; // 0–50 (odšteto od skupnega scorea)
}

export interface PropertyContext {
  lokacija: LocationScore;
  stavba: BuildingScore;
  trg: MarketScore;
  tveganja: RiskPenalty;
  prednosti: string[];
  slabosti: string[];
  scoreTotal: number; // 0–100, weighted composite
  confidence: number; // 0–1, skupna zanesljivost
}

// ─── Mestni centri (D96/TM koordinate se ne rabijo — delamo z WGS84 v API-ju) ──

interface CityCenter {
  name: string;
  lat: number;
  lng: number;
  radius: { center: number; primestno: number; obrobje: number }; // km
}

const CITY_CENTERS: CityCenter[] = [
  {
    name: "Ljubljana",
    lat: 46.0569,
    lng: 14.5058,
    radius: { center: 2.5, primestno: 8, obrobje: 20 },
  },
  {
    name: "Maribor",
    lat: 46.5547,
    lng: 15.6459,
    radius: { center: 2, primestno: 6, obrobje: 15 },
  },
  {
    name: "Koper",
    lat: 45.5481,
    lng: 13.7301,
    radius: { center: 2, primestno: 5, obrobje: 12 },
  },
  {
    name: "Celje",
    lat: 46.2297,
    lng: 15.2677,
    radius: { center: 1.5, primestno: 5, obrobje: 12 },
  },
  {
    name: "Kranj",
    lat: 46.2392,
    lng: 14.3556,
    radius: { center: 1.5, primestno: 5, obrobje: 12 },
  },
  {
    name: "Velenje",
    lat: 46.3592,
    lng: 15.1114,
    radius: { center: 1.5, primestno: 4, obrobje: 10 },
  },
  {
    name: "Novo Mesto",
    lat: 45.8011,
    lng: 15.1698,
    radius: { center: 1.5, primestno: 4, obrobje: 10 },
  },
];

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── LOCATION SCORE ───────────────────────────────────────────────────────────

function computeLocationScore(
  lat: number | null,
  lng: number | null
): LocationScore {
  if (lat == null || lng == null) {
    return {
      distancaCenterKm: null,
      kategorija: null,
      score: 50,
      confidence: 0,
    };
  }

  // Najdi najbližji mestni center
  let minDist = Infinity;
  let bestCity: CityCenter | null = null;
  for (const city of CITY_CENTERS) {
    const d = haversineKm(lat, lng, city.lat, city.lng);
    if (d < minDist) {
      minDist = d;
      bestCity = city;
    }
  }

  if (!bestCity) {
    return {
      distancaCenterKm: minDist,
      kategorija: "ruralno",
      score: 20,
      confidence: 0.5,
    };
  }

  const r = bestCity.radius;
  let kategorija: LocationScore["kategorija"];
  let score: number;

  if (minDist <= r.center) {
    kategorija = "center";
    score = 85 + Math.round((1 - minDist / r.center) * 15); // 85–100
  } else if (minDist <= r.primestno) {
    kategorija = "primestno";
    const t = (minDist - r.center) / (r.primestno - r.center);
    score = Math.round(85 - t * 30); // 55–85
  } else if (minDist <= r.obrobje) {
    kategorija = "obrobje";
    const t = (minDist - r.primestno) / (r.obrobje - r.primestno);
    score = Math.round(55 - t * 25); // 30–55
  } else {
    kategorija = "ruralno";
    score = Math.max(10, Math.round(30 - (minDist - r.obrobje) * 1.5));
  }

  return {
    distancaCenterKm: Math.round(minDist * 10) / 10,
    kategorija,
    score: Math.min(100, Math.max(0, score)),
    confidence: 0.9,
  };
}

// ─── BUILDING SCORE ───────────────────────────────────────────────────────────

function computeBuildingScore(letoIzgradnje: number | null): BuildingScore {
  if (letoIzgradnje == null || letoIzgradnje < 1800) {
    return {
      letoIzgradnje: null,
      starostKategorija: null,
      score: 50,
      confidence: 0,
    };
  }

  const leto = letoIzgradnje;
  let starostKategorija: BuildingScore["starostKategorija"];
  let score: number;

  // Nelinearno — nova gradnja premium, potem padec, nato historični charakter
  if (leto >= 2015) {
    starostKategorija = "novo";
    score = 90 + Math.min(10, Math.round((leto - 2015) * 0.7)); // 90–100
  } else if (leto >= 2000) {
    starostKategorija = "moderna";
    score = 75 + Math.round(((leto - 2000) / 15) * 15); // 75–90
  } else if (leto >= 1980) {
    starostKategorija = "srednja";
    score = 55 + Math.round(((leto - 1980) / 20) * 20); // 55–75
  } else if (leto >= 1945) {
    starostKategorija = "stara";
    score = 35 + Math.round(((leto - 1945) / 35) * 20); // 35–55
  } else {
    starostKategorija = "historicna";
    // Predvojna gradnja — charakter ampak tveganje (odvisno od obnove)
    score = 45; // nevtralno — potrebuje kontekst obnove
  }

  return {
    letoIzgradnje: leto,
    starostKategorija,
    score: Math.min(100, Math.max(0, score)),
    confidence: 0.85,
  };
}

// ─── MARKET SCORE ─────────────────────────────────────────────────────────────

function computeMarketScore(params: {
  medianaCenaM2: number | null;
  steviloTransakcij: number | null;
  virEtn: "proximity" | "ko" | "regija" | "nacional" | null;
  zaupanje: 1 | 2 | 3 | 4 | 5 | null;
  oglasMedianaCenaM2: number | null;
  oglasStevilo: number | null;
}): MarketScore {
  const {
    medianaCenaM2,
    steviloTransakcij,
    virEtn,
    zaupanje,
    oglasMedianaCenaM2,
    oglasStevilo,
  } = params;

  // Likvidnost score na podlagi št. transakcij
  let likvidnostScore = 50;
  if (steviloTransakcij != null) {
    if (steviloTransakcij >= 50) likvidnostScore = 90;
    else if (steviloTransakcij >= 20) likvidnostScore = 75;
    else if (steviloTransakcij >= 10) likvidnostScore = 60;
    else if (steviloTransakcij >= 5) likvidnostScore = 45;
    else likvidnostScore = 30;
  }

  // Zaupanje v ETN vir
  const zaupanjeScore = zaupanje != null ? zaupanje * 20 : 50;

  // Discount ETN vs oglas
  let discountEtnOglas: number | null = null;
  if (medianaCenaM2 != null && oglasMedianaCenaM2 != null) {
    discountEtnOglas =
      Math.round(
        ((oglasMedianaCenaM2 - medianaCenaM2) / medianaCenaM2) * 1000
      ) / 10; // %
  }

  const score = Math.round((likvidnostScore + zaupanjeScore) / 2);

  return {
    medianaCenaM2,
    steviloTransakcij,
    virEtn,
    zaupanje,
    oglasMedianaCenaM2,
    oglasStevilo,
    discountEtnOglas,
    trendYoY: null, // TODO: iz ETN quarterly data
    score: Math.min(100, Math.max(0, score)),
    confidence:
      zaupanje != null ? Math.min(1, zaupanje / 5) : 0.3,
  };
}

// ─── RISK PENALTY ─────────────────────────────────────────────────────────────

function computeRiskPenalty(params: {
  poplavnaNevarnost: boolean;
  seizmicnaCona?: string | null;
  kulturnoVarstvo?: boolean;
  letoIzgradnje?: number | null;
}): RiskPenalty {
  const { poplavnaNevarnost, seizmicnaCona, kulturnoVarstvo, letoIzgradnje } =
    params;

  const visokaSeizmicnost =
    seizmicnaCona != null &&
    (seizmicnaCona.includes("3") ||
      seizmicnaCona.includes("4") ||
      seizmicnaCona.toLowerCase().includes("visok"));

  const staraElektrika =
    letoIzgradnje != null && letoIzgradnje < 1970;

  let penalty = 0;
  if (poplavnaNevarnost) penalty += 20;
  if (visokaSeizmicnost) penalty += 10;
  if (kulturnoVarstvo) penalty += 5; // omejitve prenove
  if (staraElektrika) penalty += 5;

  return {
    poplavnaNevarnost,
    visokaSeizmicnost,
    kulturnoVarstvo: kulturnoVarstvo ?? false,
    brezParkinga: false, // TODO: iz GURS parkirišča
    staraElektrika,
    penalty: Math.min(50, penalty),
  };
}

// ─── AMENITY SCORE ────────────────────────────────────────────────────────────

function computeAmenityScore(places: BuildPropertyContextParams["placesData"]): {
  score: number; // 0-100
  prednosti: string[];
  slabosti: string[];
} {
  if (!places) return { score: 50, prednosti: [], slabosti: [] };

  const prednosti: string[] = [];
  const slabosti: string[] = [];
  let score = 50;

  const { transit, services } = places;

  // Transit — prefer line count (number of different bus lines) over stop count
  const lineCount = transit?.lppLineCount ?? null;
  const busCount = transit?.busStops ?? 0;
  const trainCount = transit?.trainStations ?? 0;
  const nearestBus = transit?.nearestBusM ?? null;

  if (trainCount >= 1) {
    prednosti.push(`Železniška postaja v bližini (${transit?.nearestTrainM ?? "?"}m)`);
    score += 15;
  }

  // Use line count if available, otherwise fall back to stop count
  if (lineCount !== null && lineCount > 0) {
    if (lineCount >= 5) {
      prednosti.push(`Odlična dostopnost z LPP (${lineCount} linij)`);
      score += 10;
    } else if (lineCount >= 2) {
      prednosti.push(`Dobra dostopnost z LPP (${lineCount} linij)`);
      score += 5;
    } else {
      // 1 line — basic access
      prednosti.push(`Dostop do LPP (${lineCount} linija)`);
      score += 2;
    }
  } else if (lineCount === 0 || (busCount === 0 && nearestBus === null)) {
    slabosti.push("Ni javnega prevoza v bližini");
    score -= 10;
  } else if (busCount >= 5) {
    // Fallback to stop count if no line data
    prednosti.push(`Odlična dostopnost z LPP (${busCount} postajališč)`);
    score += 10;
  } else if (busCount >= 2) {
    prednosti.push(`Dobra dostopnost z LPP (${busCount} postajališč)`);
    score += 5;
  }

  // Supermarket
  const supermarkets = services?.supermarkets ?? 0;
  const supermarketDist = services?.supermarketDistM ?? null;
  if (supermarkets >= 1 && supermarketDist !== null && supermarketDist <= 300) {
    prednosti.push(`Trgovina v neposredni bližini (${supermarketDist}m)`);
    score += 5;
  } else if (supermarkets === 0) {
    slabosti.push("Ni trgovine v bližini");
    score -= 5;
  }

  // Parks
  const parks = services?.parks ?? 0;
  if (parks >= 2) {
    prednosti.push(`${parks} parkov v bližini`);
    score += 5;
  }

  // Banks
  const banks = services?.banks ?? 0;
  if (banks >= 1) {
    prednosti.push("Bančne storitve v bližini");
    score += 3;
  }

  // Restaurants
  const restaurants = services?.restaurants ?? 0;
  if (restaurants >= 5) {
    prednosti.push(`Živahno okolje (${restaurants} restavracij)`);
    score += 3;
  }

  // Clamp 0-100
  score = Math.max(0, Math.min(100, score));

  return { score, prednosti, slabosti };
}

// ─── PREDNOSTI / SLABOSTI ─────────────────────────────────────────────────────

function buildProsConsLists(ctx: {
  lokacija: LocationScore;
  stavba: BuildingScore;
  trg: MarketScore;
  tveganja: RiskPenalty;
  placesData?: BuildPropertyContextParams["placesData"];
}): { prednosti: string[]; slabosti: string[] } {
  const prednosti: string[] = [];
  const slabosti: string[] = [];

  // Lokacija
  if (ctx.lokacija.kategorija === "center")
    prednosti.push("Lokacija v mestnem centru");
  else if (ctx.lokacija.kategorija === "primestno")
    prednosti.push("Primestna lokacija z dobro dostopnostjo");
  else if (ctx.lokacija.kategorija === "obrobje")
    slabosti.push("Obrobna lokacija — daljša pot do centra");
  else if (ctx.lokacija.kategorija === "ruralno")
    slabosti.push("Ruralna lokacija — omejena infrastruktura");

  // Amenity (dostopnost storitev)
  const amenity = computeAmenityScore(ctx.placesData);
  prednosti.push(...amenity.prednosti);
  slabosti.push(...amenity.slabosti);

  // Stavba
  if (ctx.stavba.starostKategorija === "novo")
    prednosti.push(`Nova gradnja (${ctx.stavba.letoIzgradnje})`);
  else if (ctx.stavba.starostKategorija === "moderna")
    prednosti.push(`Moderna gradnja (${ctx.stavba.letoIzgradnje})`);
  else if (ctx.stavba.starostKategorija === "stara")
    slabosti.push(`Starejša gradnja (${ctx.stavba.letoIzgradnje}) — možne obnove`);

  // Trg
  if (
    ctx.trg.steviloTransakcij != null &&
    ctx.trg.steviloTransakcij >= 20
  )
    prednosti.push("Likviden trg — enostavna prodaja");
  else if (
    ctx.trg.steviloTransakcij != null &&
    ctx.trg.steviloTransakcij < 8
  )
    slabosti.push("Malo primerljivih transakcij — ocena manj zanesljiva");

  if (ctx.trg.discountEtnOglas != null) {
    if (ctx.trg.discountEtnOglas > 10)
      slabosti.push(
        `Oglasi ${ctx.trg.discountEtnOglas.toFixed(1)}% nad transakcijskimi cenami — pogajalski prostor`
      );
    else if (ctx.trg.discountEtnOglas < 2)
      prednosti.push("Oglasne cene blizu transakcijskim — aktiven trg");
  }

  if (ctx.trg.virEtn === "nacional" || ctx.trg.virEtn === "regija")
    slabosti.push("Vrednotenje temelji na regionalnih podatkih — nižja natančnost");

  // Tveganja
  if (ctx.tveganja.poplavnaNevarnost)
    slabosti.push("⚠️ Poplavljeno območje — zavarovanje dražje");
  if (ctx.tveganja.visokaSeizmicnost)
    slabosti.push("⚠️ Visoka potresna nevarnost");
  if (ctx.tveganja.kulturnoVarstvo)
    prednosti.push("Kulturna dediščina — zgodovinska vrednost");
  if (ctx.tveganja.staraElektrika)
    slabosti.push("Stara gradnja — možna posodobitev inštalacij");

  return { prednosti, slabosti };
}

// ─── GLAVNI ENTRY POINT ───────────────────────────────────────────────────────

export interface BuildPropertyContextParams {
  lat: number | null;
  lng: number | null;
  letoIzgradnje: number | null;
  // ETN tržni podatki
  medianaCenaM2: number | null;
  steviloTransakcij: number | null;
  virEtn: "proximity" | "ko" | "regija" | "nacional" | null;
  zaupanje: 1 | 2 | 3 | 4 | 5 | null;
  // Oglasne cene
  oglasMedianaCenaM2: number | null;
  oglasStevilo: number | null;
  // Tveganja
  poplavnaNevarnost: boolean;
  seizmicnaCona?: string | null;
  kulturnoVarstvo?: boolean;
  // Places/amenity data
  placesData?: {
    transit?: { busStops?: number; trainStations?: number; nearestBusM?: number | null; nearestTrainM?: number | null; lppLineCount?: number | null; lppLines?: string[] | null };
    services?: { supermarkets?: number; supermarketDistM?: number | null; banks?: number; parks?: number; restaurants?: number };
  } | null;
}

export function buildPropertyContext(
  params: BuildPropertyContextParams
): PropertyContext {
  const lokacija = computeLocationScore(params.lat, params.lng);
  const stavba = computeBuildingScore(params.letoIzgradnje);
  const trg = computeMarketScore({
    medianaCenaM2: params.medianaCenaM2,
    steviloTransakcij: params.steviloTransakcij,
    virEtn: params.virEtn,
    zaupanje: params.zaupanje,
    oglasMedianaCenaM2: params.oglasMedianaCenaM2,
    oglasStevilo: params.oglasStevilo,
  });
  const tveganja = computeRiskPenalty({
    poplavnaNevarnost: params.poplavnaNevarnost,
    seizmicnaCona: params.seizmicnaCona,
    kulturnoVarstvo: params.kulturnoVarstvo,
    letoIzgradnje: params.letoIzgradnje,
  });

  const { prednosti, slabosti } = buildProsConsLists({
    lokacija,
    stavba,
    trg,
    tveganja,
    placesData: params.placesData,
  });

  // Weighted composite score
  // Uteži utemeljene na R² iz statistične analize:
  // lokacija=59.8% → 50% uteži, stavba=8.4% → 20%, trg=20%, tveganja=10%
  const weights = { lokacija: 0.50, stavba: 0.20, trg: 0.20, tveganja: 0.10 };
  const riskPenaltyNorm = tveganja.penalty; // 0–50 točk odbitka

  // Blend amenity score into lokacija (15% amenity, 85% base lokacija)
  const amenity = computeAmenityScore(params.placesData);
  const lokacijaBlended = Math.round(lokacija.score * 0.85 + amenity.score * 0.15);

  const weightedRaw =
    lokacijaBlended * weights.lokacija +
    stavba.score * weights.stavba +
    trg.score * weights.trg +
    (100 - riskPenaltyNorm * 2) * weights.tveganja;

  const scoreTotal = Math.min(
    100,
    Math.max(0, Math.round(weightedRaw - riskPenaltyNorm * 0.3))
  );

  // Skupna zanesljivost = minimum zanesljivosti kategorij z podatki
  const confidences = [
    lokacija.confidence > 0 ? lokacija.confidence : null,
    stavba.confidence > 0 ? stavba.confidence : null,
    trg.confidence > 0 ? trg.confidence : null,
  ].filter((c): c is number => c !== null);
  const confidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : 0.3;

  return {
    lokacija,
    stavba,
    trg,
    tveganja,
    prednosti,
    slabosti,
    scoreTotal,
    confidence,
  };
}
