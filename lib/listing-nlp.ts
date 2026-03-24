/**
 * listing-nlp.ts
 *
 * NLP parser za slovenske nepremičninske oglase.
 * Iz prostobesedilnega opisa izvleče strukturirane signale
 * ki vplivajo na ceno ali kakovost nepremičnine.
 *
 * Pristop: rule-based regex (hiter, brez AI stroškov, pokriva 80%+ primerov)
 * + opcijski LLM fallback za edge cases.
 */

export interface ListingSignals {
  // Orientacija / lega
  orientacija: ("S" | "J" | "V" | "Z" | "SV" | "SZ" | "JV" | "JZ")[] | null;
  pogled: ("alpe" | "gore" | "morje" | "reka" | "jezero" | "park" | "mesto" | "panorama") | null;

  // Energetika
  toplotnaCarpalka: boolean | null;       // toplotna črpalka (zrak-voda, zemlja-voda)
  talnoGretje: boolean | null;
  rekuperator: boolean | null;
  soncniPaneli: boolean | null;           // ali predpriprava
  evPolnilnica: boolean | null;           // ali predpriprava
  klimatizacija: boolean | null;

  // Varnost
  protivlomniAlarm: boolean | null;
  videodogledovanje: boolean | null;

  // Stanje
  stanje: "kljuc_v_roke" | "vseljivo_takoj" | "za_renovacijo" | "prenovljeno" | null;
  letoObnove: number | null;             // leto obnove iz opisa ("prenovljeno 2022")

  // Gradnja
  gradnja: "opeka" | "beton" | "les" | "montazna" | "kamen" | null;

  // Prostori (dodatni, ki niso v GURS)
  stKopalnic: number | null;
  imaPisarno: boolean | null;
  imaShrambo: boolean | null;
  imaLopo: boolean | null;
  imaAtrij: boolean | null;
  imaTeraso: boolean | null;
  imaBalkon: boolean | null;
  imaVrt: boolean | null;
  imaBasen: boolean | null;
  imaGarderoba: boolean | null;

  // Parkirišče
  stParkingMest: number | null;
  imaGaraza: boolean | null;

  // Investicijski signal
  primernOddajanje: boolean | null;       // "idealno za oddajanje", "investicija"
  novogradnja: boolean | null;

  // Dostopnost
  blizinaVrtca: boolean | null;
  blizinaSole: boolean | null;
  blizinaFakultete: boolean | null;
  blizinaUKC: boolean | null;
  blizinaLPP: boolean | null;            // javni prevoz
  blizinaObvoznice: boolean | null;

  // Kakovost zaznave
  confidence: number;                    // 0–1, delež zadetih signalov
}

// ── Regex patterns ────────────────────────────────────────────────────────────

const PATTERNS = {
  // Orientacija
  legaJ:   /\b(lega|stran|orientacij[ao]|okna)\s*(je\s*)?(J|jug(na|ni|o)?|južn[ao]?)\b/i,
  legaJV:  /\b(JV|jugovzhod(na|ni|o)?)\b/i,
  legaJZ:  /\b(JZ|jugozahod(na|ni|o)?)\b/i,
  legaV:   /\b(lega|stran|orientacij[ao])?\s*(V|vzhodna?|vzhod)\b/i,
  legaZ:   /\b(lega|stran|orientacij[ao])?\s*(Z|zahod(na|ni|o)?)\b/i,
  legaS:   /\b(lega|stran|orientacij[ao])?\s*(S|sever(na|ni|o)?)\b/i,
  legaSV:  /\b(SV|severovzhod(na|ni|o)?)\b/i,
  legaSZ:  /\b(SZ|severozahod(na|ni|o)?)\b/i,

  // Pogled
  pogledAlpe:    /pogled\s+na\s+(alpe|julian[a-z]*\s+alpe)/i,
  pogledGore:    /pogled\s+na\s+(gore|gorsk[io]|planin[ae]|kamniš|karavanke)/i,
  pogledMorje:   /pogled\s+na\s+(morje|jadran|zaliv)/i,
  pogledReka:    /pogled\s+na\s+(reko?|savo|dravo|sočo|ljubljanic[ao]|drnic[ao])/i,
  pogledJezero:  /pogled\s+na\s+(jezero|bled|bohinj)/i,
  pogledPark:    /pogled\s+na\s+(park|tivoli|gozd|zelen)/i,
  pogledMesto:   /pogled\s+na\s+(mestu?o?|center|panoram)/i,
  panorama:      /panoram(ski|ičen|a)/i,

  // Energetika
  toplotnaCarpalka: /toplotn[ao]\s+č(r|rl)palko?/i,
  talnoGretje:    /taln[oa]\s+gretj[eo]/i,
  rekuperator:    /rekuperator/i,
  soncniPaneli:   /(sončni?\s+panel|fotovoltai|predpriprav[ao]\s+za\s+sončn)/i,
  evPolnilnica:   /(električ\w+\s+polnilnic|EV\s+polnilnic|polnilnic[ao]\s+za\s+elektr|predpriprav[ao]\s+za\s+(EV|električ))/i,
  klima:          /(klimatsk[ao]\s+enot|klimatizacij|klima\s+naprav|split\s+sistem)/i,

  // Varnost
  protivlomni:    /(protivlomn|alarmn|alarm\s+sistem|varnostn[ao]\s+sistem)/i,
  videodogled:    /(videodogledo|kamer[ae]\s+za\s+nadzor|CCTV)/i,

  // Stanje
  kljucVRoke:     /(ključ\s+v\s+roke|na\s+ključ|turnkey)/i,
  vseljivoTakoj:  /(vseljivo\s+takoj|takoj\s+vseljivo|prosto\s+takoj)/i,
  zaRenovacijo:   /(za\s+renov|potrebuje\s+renov|starejša?\s+stavba|za\s+urejanje|starejš[eo]\s+stanovanje)/i,
  prenovljeno:    /(v\s+celoti\s+prenovlje|popolnoma\s+prenovlje|sveže?\s+prenovlje|novo\s+prenovlje)/i,
  letoObnove:     /prenovlje\w*\s+(?:l\.|leta\s+|l\s+)?(\d{4})/i,

  // Gradnja
  opeka:     /(opečna[at]|opek[ae]\s+gradnja|opečnat[ao])/i,
  beton:     /(betonsk[ao]|armiran\s+beton|AB\s+konstrukcij)/i,
  les:       /(lesena?\s+gradnja|masivn[ao]\s+les|les\s+konstrukcij)/i,
  montazna:  /(montažna?\s+gradnja|montažn[ao]\s+hiš|montiran)/i,
  kamen:     /(kamnita?\s+gradnja|kamen\s+gradnja)/i,

  // Prostori
  kopalnice:    /(\d+)\s*kopalnic[aei]/i,
  pisarna:      /(pisarna|kabinet|delovni\s+prostor|home\s+office)/i,
  shramba:      /(shramba|shramb[eo]|kletna\s+shramba)/i,
  lopa:         /\blopa\b/i,
  atrij:        /(atrij|notranje?\s+dvorišče)/i,
  terasa:       /\b(terasa|teraso)\b/i,
  balkon:       /\b(balkon|balkona?)\b/i,
  vrt:          /\b(vrt|vrtom?|vrtiček)\b/i,
  bazen:        /\b(bazen|bazenom?|plavaln[io])\b/i,
  garderoba:    /\b(garderoba|walk-in\s+clos|walk\s+in)\b/i,

  // Parking
  parkingMesta: /(\d+)\s*(lastniški[a-z]*\s+)?(parkirni[a-z]*\s+mest|parkirišč[ae]|garažn[a-z]*\s+mest)/i,
  garaza:       /\b(garaža|garažo|garažno\s+parkirn)/i,

  // Investicija
  oddajanje:    /(idealne?\s+za\s+oddajanje|primern[oa]\s+za\s+oddajanje|investicij[ao]|donose?|za\s+najem)/i,
  novogradnja:  /(novogradnja|nova\s+gradnja|zgrajeno?\s+l\.\s*202|na\s+ključ.*202)/i,

  // Dostopnost
  vrtec:        /(bliž(ini|ina|nji|e)\s+(vrtca?|vrtec)|vrtec\s+v\s+bliž)/i,
  sola:         /(bliž(ini|ina|nji|e)\s+(osnov|šole|šola)|šola\s+v\s+bliž)/i,
  fakulteta:    /(bliž(ini|ina|nji|e)\s+(fakult|univerze|univers)|medicinska?\s+fakult)/i,
  ukc:          /(UKC|klinični?\s+center|bolnišnica\s+v\s+bliž)/i,
  javniPrevoz:  /(LPP|avtobusn[ao]\s+postajs?|javni\s+prevoz|linij[ae]\s+avtobusa?|tramvaj)/i,
  obvoznica:    /(obvoznica|hiter\s+dostop\s+do\s+(centra|mesta|LJ)|priključek\s+na\s+avtoc)/i,
};

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseListingText(text: string): ListingSignals {
  const t = text;
  let hits = 0;
  let total = 0;

  function check(pattern: RegExp): boolean | null {
    total++;
    const matched = pattern.test(t);
    if (matched) hits++;
    return matched || null;
  }

  // Orientacija — zberi vse ki se pojavijo
  const orientacije: ListingSignals["orientacija"] = [];
  if (PATTERNS.legaJV.test(t)) orientacije.push("JV");
  else if (PATTERNS.legaJZ.test(t)) orientacije.push("JZ");
  else if (PATTERNS.legaJ.test(t)) orientacije.push("J");
  if (PATTERNS.legaSV.test(t)) orientacije.push("SV");
  else if (PATTERNS.legaSZ.test(t)) orientacije.push("SZ");
  else if (PATTERNS.legaS.test(t)) orientacije.push("S");
  if (PATTERNS.legaV.test(t) && !orientacije.some(o => o.includes("V"))) orientacije.push("V");
  if (PATTERNS.legaZ.test(t) && !orientacije.some(o => o.includes("Z"))) orientacije.push("Z");

  // Pogled
  let pogled: ListingSignals["pogled"] = null;
  if (PATTERNS.pogledAlpe.test(t)) pogled = "alpe";
  else if (PATTERNS.pogledMorje.test(t)) pogled = "morje";
  else if (PATTERNS.pogledGore.test(t)) pogled = "gore";
  else if (PATTERNS.pogledJezero.test(t)) pogled = "jezero";
  else if (PATTERNS.pogledReka.test(t)) pogled = "reka";
  else if (PATTERNS.pogledPark.test(t)) pogled = "park";
  else if (PATTERNS.panorama.test(t)) pogled = "panorama";
  else if (PATTERNS.pogledMesto.test(t)) pogled = "mesto";

  // Stanje
  let stanje: ListingSignals["stanje"] = null;
  if (PATTERNS.kljucVRoke.test(t)) stanje = "kljuc_v_roke";
  else if (PATTERNS.vseljivoTakoj.test(t)) stanje = "vseljivo_takoj";
  else if (PATTERNS.prenovljeno.test(t)) stanje = "prenovljeno";
  else if (PATTERNS.zaRenovacijo.test(t)) stanje = "za_renovacijo";

  const letoObnoveMatch = PATTERNS.letoObnove.exec(t);
  const letoObnove = letoObnoveMatch ? parseInt(letoObnoveMatch[1]) : null;

  // Gradnja
  let gradnja: ListingSignals["gradnja"] = null;
  if (PATTERNS.opeka.test(t)) gradnja = "opeka";
  else if (PATTERNS.montazna.test(t)) gradnja = "montazna";
  else if (PATTERNS.les.test(t)) gradnja = "les";
  else if (PATTERNS.beton.test(t)) gradnja = "beton";
  else if (PATTERNS.kamen.test(t)) gradnja = "kamen";

  // Število kopalnic
  const kopMatch = PATTERNS.kopalnice.exec(t);
  const stKopalnic = kopMatch ? parseInt(kopMatch[1]) : null;

  // Parking
  const parkMatch = PATTERNS.parkingMesta.exec(t);
  const stParkingMest = parkMatch ? parseInt(parkMatch[1]) : null;

  return {
    orientacija: orientacije.length > 0 ? orientacije : null,
    pogled,

    toplotnaCarpalka: check(PATTERNS.toplotnaCarpalka),
    talnoGretje: check(PATTERNS.talnoGretje),
    rekuperator: check(PATTERNS.rekuperator),
    soncniPaneli: check(PATTERNS.soncniPaneli),
    evPolnilnica: check(PATTERNS.evPolnilnica),
    klimatizacija: check(PATTERNS.klima),

    protivlomniAlarm: check(PATTERNS.protivlomni),
    videodogledovanje: check(PATTERNS.videodogled),

    stanje,
    letoObnove,
    gradnja,

    stKopalnic,
    imaPisarno: check(PATTERNS.pisarna),
    imaShrambo: check(PATTERNS.shramba),
    imaLopo: check(PATTERNS.lopa),
    imaAtrij: check(PATTERNS.atrij),
    imaTeraso: check(PATTERNS.terasa),
    imaBalkon: check(PATTERNS.balkon),
    imaVrt: check(PATTERNS.vrt),
    imaBasen: check(PATTERNS.bazen),
    imaGarderoba: check(PATTERNS.garderoba),

    stParkingMest,
    imaGaraza: check(PATTERNS.garaza),

    primernOddajanje: check(PATTERNS.oddajanje),
    novogradnja: check(PATTERNS.novogradnja),

    blizinaVrtca: check(PATTERNS.vrtec),
    blizinaSole: check(PATTERNS.sola),
    blizinaFakultete: check(PATTERNS.fakulteta),
    blizinaUKC: check(PATTERNS.ukc),
    blizinaLPP: check(PATTERNS.javniPrevoz),
    blizinaObvoznice: check(PATTERNS.obvoznica),

    confidence: total > 0 ? hits / total : 0,
  };
}

// ── Valuation impact ──────────────────────────────────────────────────────────

export interface ListingValuationDelta {
  delta: number;           // skupni multiplikator (npr. 0.08 = +8%)
  faktorji: { naziv: string; delta: number; ikona: string }[];
}

/**
 * Iz NLP signalov izračuna vrednostni delta.
 * Kliče se kot ADITIVNI bonus nad osnovno ETN oceno.
 * Konzervativne vrednosti — vse brez LiDAR verifikacije so označene kot "ocenjeno".
 */
export function calcListingValuationDelta(
  s: ListingSignals,
  stNadstropja?: number | null,
): ListingValuationDelta {
  const faktorji: ListingValuationDelta["faktorji"] = [];

  // Energetika
  if (s.toplotnaCarpalka) faktorji.push({ naziv: "Toplotna črpalka", delta: 0.04, ikona: "♨️" });
  if (s.talnoGretje) faktorji.push({ naziv: "Talno gretje", delta: 0.02, ikona: "🌡️" });
  if (s.rekuperator) faktorji.push({ naziv: "Rekuperator", delta: 0.02, ikona: "💨" });
  if (s.soncniPaneli) faktorji.push({ naziv: "Sončni paneli / predpriprava", delta: 0.02, ikona: "☀️" });
  if (s.evPolnilnica) faktorji.push({ naziv: "EV polnilnica / predpriprava", delta: 0.015, ikona: "⚡" });

  // Gradnja
  if (s.gradnja === "opeka") faktorji.push({ naziv: "Opečnata gradnja", delta: 0.03, ikona: "🧱" });
  if (s.gradnja === "montazna") faktorji.push({ naziv: "Montažna gradnja", delta: -0.03, ikona: "🏗️" });
  if (s.gradnja === "les" && s.novogradnja) faktorji.push({ naziv: "Sodobna lesena gradnja", delta: 0.04, ikona: "🪵" });

  // Pogled — konzervativno brez LiDAR verifikacije
  if (s.pogled === "alpe" || s.pogled === "gore") {
    const viewDelta = stNadstropja && stNadstropja >= 3 ? 0.08 : 0.04; // višje nadstropje = bolj verjetno
    faktorji.push({ naziv: `Pogled na ${s.pogled === "alpe" ? "Alpe" : "gore"} (oglas, nepreverjen)`, delta: viewDelta, ikona: "🏔️" });
  } else if (s.pogled === "morje") {
    faktorji.push({ naziv: "Pogled na morje (oglas, nepreverjen)", delta: 0.12, ikona: "🌊" });
  } else if (s.pogled === "reka" || s.pogled === "jezero") {
    faktorji.push({ naziv: `Pogled na ${s.pogled} (oglas, nepreverjen)`, delta: 0.05, ikona: "💧" });
  } else if (s.pogled === "panorama") {
    faktorji.push({ naziv: "Panoramski pogled (oglas, nepreverjen)", delta: 0.04, ikona: "🌄" });
  }

  // Investicijski signal
  if (s.primernOddajanje) faktorji.push({ naziv: "Investicijska nepremičnina", delta: 0.03, ikona: "💰" });

  // Stanje
  if (s.stanje === "kljuc_v_roke" || s.stanje === "prenovljeno") faktorji.push({ naziv: "Prenovljeno / ključ v roke", delta: 0.04, ikona: "🔑" });
  if (s.stanje === "za_renovacijo") faktorji.push({ naziv: "Potrebuje renovacijo", delta: -0.08, ikona: "🏚️" });

  // Cap na ±20%
  const raw = faktorji.reduce((sum, f) => sum + f.delta, 0);
  const delta = Math.max(-0.20, Math.min(0.20, raw));

  return { delta, faktorji };
}
