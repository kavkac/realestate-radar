// Location premium calculator — adjusts property value based on qualitative location factors
// Used to enrich ETN-based valuation with context-aware corrections

export interface LokacijskiFaktor {
  naziv: string;
  opis: string;
  korekcija: number; // e.g. 0.08 = +8%
  ikona: string;
}

export interface LokacijskiPremium {
  skupniFaktor: number; // final multiplier, e.g. 1.12
  faktorji: LokacijskiFaktor[];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Slovenian city centers with premium radii
const CITY_CENTERS = [
  { name: "Ljubljana", lat: 46.0511, lng: 14.5058, radiusPremium: 2000, radiusCenter: 600 },
  { name: "Maribor", lat: 46.5547, lng: 15.6459, radiusPremium: 2000, radiusCenter: 500 },
  { name: "Celje", lat: 46.2311, lng: 15.2686, radiusPremium: 1500, radiusCenter: 400 },
  { name: "Koper", lat: 45.5480, lng: 13.7301, radiusPremium: 1500, radiusCenter: 400 },
  { name: "Kranj", lat: 46.2392, lng: 14.3556, radiusPremium: 1500, radiusCenter: 400 },
  { name: "Novo Mesto", lat: 45.8011, lng: 15.1696, radiusPremium: 1200, radiusCenter: 300 },
  { name: "Velenje", lat: 46.3592, lng: 15.1112, radiusPremium: 1200, radiusCenter: 300 },
  { name: "Nova Gorica", lat: 45.9560, lng: 13.6480, radiusPremium: 1200, radiusCenter: 300 },
];

function findNearestCity(lat: number, lng: number): { city: typeof CITY_CENTERS[0]; distanceKm: number } {
  let nearest = CITY_CENTERS[0];
  let minDist = haversineKm(lat, lng, nearest.lat, nearest.lng);
  for (const city of CITY_CENTERS.slice(1)) {
    const dist = haversineKm(lat, lng, city.lat, city.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = city;
    }
  }
  return { city: nearest, distanceKm: minDist };
}

// Key Ljubljana landmarks (Ljubljana-specific premium factors)
const LANDMARKS = {
  ljubljanica: [
    // Polyline approximation: key points along Ljubljanica through city center
    [46.0501, 14.5046], [46.0489, 14.5058], [46.0475, 14.5071],
    [46.0461, 14.5085], [46.0449, 14.5099], [46.0437, 14.5112],
  ] as [number, number][],
  grad: [46.0488, 14.5086] as [number, number],
  kongresniTrg: [46.0508, 14.5044] as [number, number],
  bežigrajskiPark: [46.0629, 14.5083] as [number, number],
  tivoli: [46.0548, 14.4935] as [number, number],
  bTC: [46.0661, 14.5267] as [number, number],
};

function distToPolylineKm(lat: number, lng: number, polyline: [number, number][]): number {
  return Math.min(...polyline.map(([plat, plng]) => haversineKm(lat, lng, plat, plng)));
}

/**
 * Neighborhood tag → valuation premium (kalibriran na SLO trgu)
 * Vir: Calculus analiza ETN transakcij + SLO hedonic pricing literatura
 */
export function neighborhoodTagPremium(tags: string[]): number {
  let premium = 0;
  for (const tag of tags) {
    if (tag.includes("Tiho območje"))        premium += 0.030;
    if (tag.includes("Zelena soseska"))      premium += 0.025;
    if (tag.includes("Tramvajska dostopnost")) premium += 0.020;
    if (tag.includes("Dobra javna pot"))     premium += 0.010;
    if (tag.includes("Izobrazbeno razvito")) premium += 0.015;
    if (tag.includes("Družinsko"))           premium += 0.015;
    if (tag.includes("Živahno"))             premium += 0.010;  // mestni center
    if (tag.includes("Mlada soseska"))       premium += 0.008;
    if (tag.includes("Prometno"))            premium -= 0.045;
    if (tag.includes("Industrijsko"))        premium -= 0.060;
    if (tag.includes("Starejša soseska"))    premium -= 0.010;
    if (tag.includes("Zdravstveno"))         premium += 0.005;  // dostopnost, ne hrup
  }
  // Cap: ±10% max kumulativni neighborhood premium
  return Math.max(-0.10, Math.min(0.10, premium));
}

export function izracunajLokacijskiPremium(
  lat: number,
  lng: number,
  /** @deprecated — zamenjaj z proximityScore iz neighborhood-service */
  osmAmenitiesCount?: number | null,
  /** Predizračunan walking-time-based score iz calcProximityScore() (-0.15..+0.20) */
  proximityScore?: number | null,
  /** Character tags iz neighborhood-service.deriveCharacter() */
  neighborhoodTags?: string[] | null,
): LokacijskiPremium {
  const faktorji: LokacijskiFaktor[] = [];

  // 1. Bližina Ljubljanice
  const distLjubljanica = distToPolylineKm(lat, lng, LANDMARKS.ljubljanica);
  if (distLjubljanica < 0.1) {
    faktorji.push({ naziv: "Ob Ljubljanici", opis: `${Math.round(distLjubljanica * 1000)}m od reke`, korekcija: 0.10, ikona: "🌊" });
  } else if (distLjubljanica < 0.25) {
    faktorji.push({ naziv: "Blizu Ljubljanice", opis: `${Math.round(distLjubljanica * 1000)}m od reke`, korekcija: 0.05, ikona: "🌊" });
  }

  // 2. Bližina Gradu / potencialen pogled (viewshed brez LiDAR ni preverljiv)
  // Apliciramo samo za nadstropja ≥3 ali ko ni podatka, z "potencialen" oznako
  const distGrad = haversineKm(lat, lng, LANDMARKS.grad[0], LANDMARKS.grad[1]);
  if (distGrad < 0.3) {
    // Zelo blizu — samo premija za bližino, pogled ne garantiran brez viewshed
    faktorji.push({ naziv: "Bližina Gradu", opis: `${Math.round(distGrad * 1000)}m od gradu — pogled možen v višjih nadstropjih (viewshed bo potrjen z LiDAR)`, korekcija: 0.04, ikona: "🏰" });
  } else if (distGrad < 0.6) {
    faktorji.push({ naziv: "Blizu Gradu", opis: `${Math.round(distGrad * 1000)}m od Ljubljanskega gradu`, korekcija: 0.02, ikona: "🏰" });
  }

  // 3. Mestno jedro — nearest city center (generalized for all Slovenian cities)
  const { city: nearestCity, distanceKm: distCenter } = findNearestCity(lat, lng);
  const centerThreshold = nearestCity.radiusCenter / 1000; // convert m to km
  const premiumThreshold = nearestCity.radiusPremium / 1000;
  if (distCenter < centerThreshold) {
    faktorji.push({ naziv: "Strogo mestno jedro", opis: `Center ${nearestCity.name} — visoka vrednost lokacije`, korekcija: 0.07, ikona: "🏛️" });
  } else if (distCenter < premiumThreshold / 2) {
    faktorji.push({ naziv: "Mestno jedro", opis: `${Math.round(distCenter * 1000)}m od centra ${nearestCity.name}`, korekcija: 0.03, ikona: "🏛️" });
  }

  // 4. Bližina parka (Tivoli)
  const distTivoli = haversineKm(lat, lng, LANDMARKS.tivoli[0], LANDMARKS.tivoli[1]);
  if (distTivoli < 0.2) {
    faktorji.push({ naziv: "Ob Tivoliju", opis: `${Math.round(distTivoli * 1000)}m od parka Tivoli`, korekcija: 0.06, ikona: "🌳" });
  } else if (distTivoli < 0.5) {
    faktorji.push({ naziv: "Blizu Tivolija", opis: `${Math.round(distTivoli * 1000)}m od parka`, korekcija: 0.03, ikona: "🌳" });
  }

  // 5. Proximity score — walking-time-based (neighborhood-service)
  // Prednost pred osmAmenitiesCount: baziran na dejanski razdalji hoje, vključuje hrup
  if (proximityScore != null) {
    if (proximityScore >= 0.10) {
      faktorji.push({ naziv: "Odlična dostopnost", opis: `Šole, prevoz, storitve v kratki hoji (walking score +${Math.round(proximityScore * 100)}%)`, korekcija: proximityScore, ikona: "🚶" });
    } else if (proximityScore >= 0.03) {
      faktorji.push({ naziv: "Dobra dostopnost", opis: `Osnovna infrastruktura dostopna peš (+${Math.round(proximityScore * 100)}%)`, korekcija: proximityScore, ikona: "🚶" });
    } else if (proximityScore <= -0.05) {
      faktorji.push({ naziv: "Slaba dostopnost / hrup", opis: `Oddaljenost ali visok hrup (${Math.round(proximityScore * 100)}%)`, korekcija: proximityScore, ikona: "🔇" });
    } else if (proximityScore < 0) {
      faktorji.push({ naziv: "Zmerna dostopnost", opis: `Omejene storitve ali zmeren hrup (${Math.round(proximityScore * 100)}%)`, korekcija: proximityScore, ikona: "📍" });
    }
    // neutralen proximityScore (0–0.03) → ni posebnega faktorja
  }

  // 6b. Neighborhood character premium (OSM + SURS + ARSO)
  if (neighborhoodTags && neighborhoodTags.length > 0) {
    const nbPremium = neighborhoodTagPremium(neighborhoodTags);
    if (nbPremium > 0.005) {
      const tagStr = neighborhoodTags.filter(t =>
        t.includes("Tiho") || t.includes("Zelena") || t.includes("Tram") || t.includes("Izobrazbeno") || t.includes("Živ")
      ).slice(0, 2).join(", ");
      faktorji.push({ naziv: "Ugoden karakter soseske", opis: `${tagStr || neighborhoodTags[0]} (+${Math.round(nbPremium * 100)}%)`, korekcija: nbPremium, ikona: "🏘️" });
    } else if (nbPremium < -0.005) {
      const tagStr = neighborhoodTags.filter(t =>
        t.includes("Prometno") || t.includes("Industrijsko")
      ).slice(0, 2).join(", ");
      faktorji.push({ naziv: "Neugoden karakter soseske", opis: `${tagStr || neighborhoodTags[0]} (${Math.round(nbPremium * 100)}%)`, korekcija: nbPremium, ikona: "⚠️" });
    }
  }

  if (osmAmenitiesCount != null && proximityScore == null) {
    // Fallback na stari sistem če proximityScore ni na voljo
    if (osmAmenitiesCount >= 20) {
      faktorji.push({ naziv: "Odlična dostopnost", opis: `${osmAmenitiesCount}+ točk storitev v bližini`, korekcija: 0.05, ikona: "🏪" });
    } else if (osmAmenitiesCount >= 10) {
      faktorji.push({ naziv: "Dobra dostopnost", opis: `${osmAmenitiesCount} točk storitev v bližini`, korekcija: 0.02, ikona: "🏪" });
    } else if (osmAmenitiesCount <= 2) {
      faktorji.push({ naziv: "Slabša dostopnost", opis: "Malo storitev v neposredni bližini", korekcija: -0.03, ikona: "🏚️" });
    }
  }

  // 6. Periferija / oddaljenost od centra (malus) — scaled by city size
  const peripheryThreshold = premiumThreshold * 1.5; // 1.5x premium radius = periphery start
  const remoteThreshold = premiumThreshold * 2.5;    // 2.5x premium radius = remote
  if (distCenter > remoteThreshold) {
    faktorji.push({ naziv: "Periferna lokacija", opis: `${(distCenter).toFixed(1)}km od centra ${nearestCity.name}`, korekcija: -0.10, ikona: "📍" });
  } else if (distCenter > peripheryThreshold) {
    faktorji.push({ naziv: "Oddaljena lokacija", opis: `${Math.round(distCenter * 1000)}m od centra ${nearestCity.name}`, korekcija: -0.05, ikona: "📍" });
  }

  // Premium synergy: ko >=3 pozitivni premium signali skupaj (reka, varstvo, grad, mestno jedro, proximity)
  // → premium tier nepremičnina, dodaj sinergijski bonus + dvigni cap
  const pozitivniFaktorji = faktorji.filter(f => f.korekcija > 0.03);
  const isPremiumTier = pozitivniFaktorji.length >= 3;
  if (isPremiumTier) {
    faktorji.push({
      naziv: "Premium sinergija",
      opis: `${pozitivniFaktorji.length} premium signalov skupaj — kupec plača za celoten paket, ne vsoto delov`,
      korekcija: 0.08,
      ikona: "⭐",
    });
  }

  // Cap: ±25% normalno, ±35% za premium tier
  const cap = isPremiumTier ? 0.35 : 0.25;
  const skupna = faktorji.reduce((sum, f) => sum + f.korekcija, 0);
  const skupniFaktor = 1 + Math.max(-cap, Math.min(cap, skupna));

  return { skupniFaktor, faktorji };
}

export interface VisinaSstropov {
  visinaCm: number;
  metoda: "ren_declared" | "kn_declared" | "izmerjena" | "ocenjena_leto" | "ocenjena_default";
  opis: string;
  korekcija: number; // vrednostna korekcija
}

export function izracunajVisinoStropov(
  visinaStvabe: number | null,
  steviloEtaz: number | null,
  letoIzgradnje: number | null,
  idLega?: string | null,
): VisinaSstropov {
  // Mansardna/podstrešna stanovanja — GURS id_lega vsebuje "MANSARDA" ali "PODSTREŠJE"
  // Poševni strop pomeni manjšo povprečno svetlo višino (~80% normalne)
  const isMansarda = idLega != null && /mansard|podstreš|podstre[sš]/i.test(idLega);
  // Metoda 1: Iz izmerjene višine stavbe / število etaž
  if (visinaStvabe && visinaStvabe > 0 && steviloEtaz && steviloEtaz > 0) {
    // GURS VISINA_H2–H3 vključuje strešno konstrukcijo za stare stavbe:
    // - predvojna gradnja (< 1945): strma streha ~1.5m → odštejemo pred deljenjem
    // - sodobna gradnja (>= 1945): ravna/nizka streha ~0.5m
    // Dedukcija za medetažno ploščo je odvisna od gradnje:
    // - zidana/kamena (< 1945): 0.40m (debelejše plošče)
    // - železobeton (>= 1945): 0.30m
    const roofOffset = letoIzgradnje != null && letoIzgradnje < 1945 ? 1.5 : 0.5;
    const slabThickness = letoIzgradnje != null && letoIzgradnje < 1945 ? 0.40 : 0.30;

    const adjustedHeight = Math.max(visinaStvabe - roofOffset, visinaStvabe * 0.8);
    const brutoNaEtazo = adjustedHeight / steviloEtaz;
    const netoCm = Math.round((brutoNaEtazo - slabThickness) * 100);

    if (netoCm >= 200 && netoCm <= 500) {
      // Mansardna korekcija: poševni strop → ~80% povprečne svetle višine
      const adjustedCm = isMansarda ? Math.round(netoCm * 0.80) : netoCm;
      const korekcija = adjustedCm >= 320 ? 0.05 : adjustedCm >= 290 ? 0.02 : adjustedCm < 250 ? -0.03 : 0;
      return {
        visinaCm: adjustedCm,
        metoda: "izmerjena",
        opis: isMansarda ? `Mansarda · ${brutoNaEtazo.toFixed(1)}m poševno` : `${brutoNaEtazo.toFixed(1)}m neto / etažo`,
        korekcija,
      };
    }
  }

  // Metoda 2: Ocena iz leta izgradnje (kalibrirano na realne meritve)
  // Vrednosti so svetla višina (neto), ne etažna višina
  if (letoIzgradnje) {
    const base = letoIzgradnje < 1918 ? { visinaCm: 320, opis: "Predvojna gradnja", korekcija: 0.04 as number }
      : letoIzgradnje < 1945 ? { visinaCm: 300, opis: "Medvojna gradnja", korekcija: 0.02 as number }
      : letoIzgradnje < 1965 ? { visinaCm: 280, opis: "Povojska gradnja", korekcija: 0.01 as number }
      : letoIzgradnje < 1990 ? { visinaCm: 260, opis: "Socialistična gradnja", korekcija: 0 as number }
      : letoIzgradnje < 2005 ? { visinaCm: 265, opis: "Gradnja 90ih", korekcija: 0 as number }
      : { visinaCm: 270, opis: "Sodobna gradnja", korekcija: 0.01 as number };
    if (isMansarda) {
      return { visinaCm: Math.round(base.visinaCm * 0.80), metoda: "ocenjena_leto", opis: `Mansarda · ${base.opis}`, korekcija: -0.03 };
    }
    return { ...base, metoda: "ocenjena_leto" };
  }

  const defaultCm = isMansarda ? 208 : 260;
  return { visinaCm: defaultCm, metoda: "ocenjena_default", opis: isMansarda ? "Mansarda · povprečna vrednost" : "Povprečna vrednost", korekcija: isMansarda ? -0.03 : 0 };
}

export interface StavbnaKorekcija {
  naziv: string;
  ikona: string;
  opis: string;
  korekcija: number;
}

export interface StavbneKorekcije {
  faktorji: StavbnaKorekcija[];
  skupniFaktor: number; // multiplikativni produkt vseh korekcij, capped ±30%
}

interface StavbneKorekcijeInput {
  // Varstvo
  varuje?: boolean;
  varstvo?: string | null;
  // Dvigalo + etaže
  dvigalo?: boolean;
  steviloEtaz?: number | null;
  // Obnova
  letoObnoveInstalacij?: number | null;
  letoObnoveOken?: number | null;
  letoObnoveFasade?: number | null;
  letoObnoveSrehe?: number | null;
  letoIzgradnje?: number | null;
  // Konstrukcija
  konstrukcija?: string | null;
  // ETN apreciacija (iz letniPodatki)
  letniPodatki?: { leto: number; medianaCenaM2: number; steviloPoslov: number }[];
  steviloTransakcij?: number;
  // EV vs ETN
  evVrednost?: number | null;
  etnEstimate?: number | null;
  // Lastniška struktura (delež pravnih oseb)
  lastniki?: { tipOsebe: string }[];
  // OSM javni promet
  busStopsCount?: number;
  trainStationsCount?: number;
  tramStopsCount?: number;
  // OSM wall material
  wallMaterial?: string | null;
}

export function izracunajStavbneKorekcije(input: StavbneKorekcijeInput): StavbneKorekcije {
  const faktorji: StavbnaKorekcija[] = [];
  const now = new Date().getFullYear();

  // 1. VARSTVO NEPREMIČNINE
  if (input.varuje) {
    faktorji.push({
      naziv: "Varstvo",
      ikona: "🏛️",
      opis: `Stavba pod spomeniškim varstvom${input.varstvo ? `: ${input.varstvo}` : ""} — kakovostna arhitektura, privilegirana lokacija`,
      korekcija: 0.12,
    });
  }

  // 2. DVIGALO + NADSTROPJA
  if (input.steviloEtaz != null && input.steviloEtaz >= 4) {
    if (input.dvigalo === false) {
      const malus = input.steviloEtaz >= 6 ? -0.10 : -0.06;
      faktorji.push({
        naziv: "Brez dvigala",
        ikona: "🪜",
        opis: `${input.steviloEtaz}-etažna stavba brez dvigala — fizični napor, nizka dostopnost`,
        korekcija: malus,
      });
    } else if (input.dvigalo === true) {
      faktorji.push({
        naziv: "Dvigalo",
        ikona: "🛗",
        opis: "Stavba ima dvigalo — udobna dostopnost",
        korekcija: 0.03,
      });
    }
  }

  // 3. OBNOVA — vsak svežo obnovljen element +2%
  const obnovaElements: { leto: number | null | undefined; naziv: string }[] = [
    { leto: input.letoObnoveInstalacij, naziv: "instalacije" },
    { leto: input.letoObnoveOken, naziv: "okna" },
    { leto: input.letoObnoveFasade, naziv: "fasada" },
    { leto: input.letoObnoveSrehe, naziv: "streha" },
  ];
  const svezaObnova = obnovaElements.filter(e => e.leto != null && now - e.leto! <= 10);
  if (svezaObnova.length > 0) {
    const k = Math.min(svezaObnova.length * 0.02, 0.08);
    faktorji.push({
      naziv: "Sveža obnova",
      ikona: "🔧",
      opis: `Obnovljeno v zadnjih 10 letih: ${svezaObnova.map(e => e.naziv).join(", ")}`,
      korekcija: k,
    });
  }
  // Stara neobnova malus
  if (input.letoIzgradnje && now - input.letoIzgradnje > 40 && svezaObnova.length === 0) {
    faktorji.push({
      naziv: "Zastarelo",
      ikona: "🏚️",
      opis: `Stavba iz ${input.letoIzgradnje}, brez evidentirane obnove — višji stroški vzdrževanja`,
      korekcija: -0.05,
    });
  }

  // 4. KONSTRUKCIJA
  if (input.konstrukcija) {
    const k = input.konstrukcija.toLowerCase();
    if (k.includes("masivn") || k.includes("kamen") || k.includes("opeka")) {
      faktorji.push({ naziv: "Masivna gradnja", ikona: "🧱", opis: "Opeka/kamen — trajnost, zvočna izolacija, kakovost", korekcija: 0.03 });
    } else if (k.includes("montažn") || k.includes("panel")) {
      faktorji.push({ naziv: "Montažna gradnja", ikona: "🏗️", opis: "Montažna/panelna konstrukcija — nižja kakovost gradnje", korekcija: -0.04 });
    } else if (k.includes("les")) {
      // Lesena: premium če nova, malus če stara
      const letoBonus = input.letoIzgradnje && input.letoIzgradnje >= 2010 ? 0.05 : -0.03;
      faktorji.push({ naziv: "Lesena gradnja", ikona: "🪵", opis: input.letoIzgradnje && input.letoIzgradnje >= 2010 ? "Sodobna lesena gradnja — ekološko, premium segment" : "Starejša lesena gradnja", korekcija: letoBonus });
    }
  }

  // 5. OSM wall material
  if (input.wallMaterial) {
    const w = input.wallMaterial.toLowerCase();
    if (["stone", "brick", "sandstone"].some(v => w.includes(v))) {
      faktorji.push({ naziv: "Fasada", ikona: "✨", opis: `OSM: ${input.wallMaterial} — kakovostna/umetniška fasada`, korekcija: 0.04 });
    }
  }

  // 6. APRECIACIJA KO (trend zadnja 3 leta)
  if (input.letniPodatki && input.letniPodatki.length >= 3) {
    const sorted = [...input.letniPodatki].sort((a, b) => b.leto - a.leto);
    const recent = sorted.slice(0, 3).filter(d => d.steviloPoslov >= 3);
    if (recent.length >= 2) {
      const growth = (recent[0].medianaCenaM2 - recent[recent.length - 1].medianaCenaM2) / recent[recent.length - 1].medianaCenaM2;
      const annualized = growth / (recent.length - 1);
      if (annualized > 0.08) {
        faktorji.push({ naziv: "Visoka apreciacija", ikona: "📈", opis: `Cene v tej KO rastejo ${Math.round(annualized * 100)}%/leto — višje povpraševanje`, korekcija: 0.03 });
      } else if (annualized < -0.03) {
        faktorji.push({ naziv: "Padajoč trg", ikona: "📉", opis: `Cene v tej KO padajo ${Math.round(Math.abs(annualized) * 100)}%/leto`, korekcija: -0.03 });
      }
    }
  }

  // 7. LIKVIDNOST — hitrost prometa
  if (input.steviloTransakcij != null) {
    if (input.steviloTransakcij >= 100) {
      faktorji.push({ naziv: "Likviden trg", ikona: "⚡", opis: `${input.steviloTransakcij} transakcij v KO — hitro prodajno območje`, korekcija: 0.02 });
    } else if (input.steviloTransakcij < 15) {
      faktorji.push({ naziv: "Nelikviden trg", ikona: "🐌", opis: `Samo ${input.steviloTransakcij} transakcij — manjši interes, počasna prodaja`, korekcija: -0.03 });
    }
  }

  // 8. EV vs ETN: podvrednoteno?
  if (input.evVrednost && input.etnEstimate && input.etnEstimate > 0) {
    const ratio = input.evVrednost / input.etnEstimate;
    if (ratio < 0.70) {
      faktorji.push({ naziv: "GURS podvrednoten", ikona: "💡", opis: `Uradna vrednost ${Math.round(ratio * 100)}% od tržne ocene — nižja davčna osnova`, korekcija: 0 }); // informativno, ne vpliva na ceno
    } else if (ratio > 1.30) {
      faktorji.push({ naziv: "GURS nadvrednoten", ikona: "⚠️", opis: `Uradna vrednost ${Math.round(ratio * 100)}% od tržne ocene`, korekcija: 0 });
    }
  }

  // 9. LASTNIŠKA STRUKTURA
  if (input.lastniki && input.lastniki.length > 0) {
    const pravneOsebe = input.lastniki.filter(l => l.tipOsebe === "Pravna oseba").length;
    const delez = pravneOsebe / input.lastniki.length;
    if (delez > 0.5) {
      faktorji.push({ naziv: "Investicijska stavba", ikona: "🏢", opis: `${Math.round(delez * 100)}% lastnikov so pravne osebe — profesionalno upravljana stavba`, korekcija: 0.03 });
    }
  }

  // 10. JAVNI PROMET — ONEMOGOČENO
  // Statistična analiza (n=12,018 ETN): OSM transit count R²<2% = šum.
  // OSM podatki pogosto nepopolni → napačne penalizacije (npr. Celovška cesta z odličnim JP).
  // Javni promet je kolinearen z lokacijo (KO) ki že nosi 59.8% variance.
  // void (input.busStopsCount);

  // Skupni faktor (multiplikativno, capped ±30%)
  const raw = faktorji.reduce((acc, f) => acc * (1 + f.korekcija), 1);
  const skupniFaktor = Math.max(0.70, Math.min(1.30, raw));

  return { faktorji, skupniFaktor };
}
