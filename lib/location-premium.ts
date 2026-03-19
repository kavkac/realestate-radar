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

// Key Ljubljana landmarks (can expand to other cities later)
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

export function izracunajLokacijskiPremium(
  lat: number,
  lng: number,
  osmAmenitiesCount?: number | null,
): LokacijskiPremium {
  const faktorji: LokacijskiFaktor[] = [];

  // 1. Bližina Ljubljanice
  const distLjubljanica = distToPolylineKm(lat, lng, LANDMARKS.ljubljanica);
  if (distLjubljanica < 0.1) {
    faktorji.push({ naziv: "Ob Ljubljanici", opis: `${Math.round(distLjubljanica * 1000)}m od reke`, korekcija: 0.10, ikona: "🌊" });
  } else if (distLjubljanica < 0.25) {
    faktorji.push({ naziv: "Blizu Ljubljanice", opis: `${Math.round(distLjubljanica * 1000)}m od reke`, korekcija: 0.05, ikona: "🌊" });
  }

  // 2. Pogled na Grad / bližina
  const distGrad = haversineKm(lat, lng, LANDMARKS.grad[0], LANDMARKS.grad[1]);
  if (distGrad < 0.3) {
    faktorji.push({ naziv: "Pogled na Grad", opis: `${Math.round(distGrad * 1000)}m od Ljubljanskega gradu`, korekcija: 0.08, ikona: "🏰" });
  } else if (distGrad < 0.6) {
    faktorji.push({ naziv: "Blizu Gradu", opis: `${Math.round(distGrad * 1000)}m od Ljubljanskega gradu`, korekcija: 0.04, ikona: "🏰" });
  }

  // 3. Mestno jedro (Kongresni trg / staro mesto)
  const distCenter = haversineKm(lat, lng, LANDMARKS.kongresniTrg[0], LANDMARKS.kongresniTrg[1]);
  if (distCenter < 0.3) {
    faktorji.push({ naziv: "Strogo mestno jedro", opis: "Center Ljubljane — visoka vrednost lokacije", korekcija: 0.07, ikona: "🏛️" });
  } else if (distCenter < 0.8) {
    faktorji.push({ naziv: "Mestno jedro", opis: `${Math.round(distCenter * 1000)}m od centra`, korekcija: 0.03, ikona: "🏛️" });
  }

  // 4. Bližina parka (Tivoli)
  const distTivoli = haversineKm(lat, lng, LANDMARKS.tivoli[0], LANDMARKS.tivoli[1]);
  if (distTivoli < 0.2) {
    faktorji.push({ naziv: "Ob Tivoliju", opis: `${Math.round(distTivoli * 1000)}m od parka Tivoli`, korekcija: 0.06, ikona: "🌳" });
  } else if (distTivoli < 0.5) {
    faktorji.push({ naziv: "Blizu Tivolija", opis: `${Math.round(distTivoli * 1000)}m od parka`, korekcija: 0.03, ikona: "🌳" });
  }

  // 5. OSM amenity density score (dostopnost)
  if (osmAmenitiesCount != null) {
    if (osmAmenitiesCount >= 20) {
      faktorji.push({ naziv: "Odlična dostopnost", opis: `${osmAmenitiesCount}+ točk storitev v bližini`, korekcija: 0.05, ikona: "🏪" });
    } else if (osmAmenitiesCount >= 10) {
      faktorji.push({ naziv: "Dobra dostopnost", opis: `${osmAmenitiesCount} točk storitev v bližini`, korekcija: 0.02, ikona: "🏪" });
    } else if (osmAmenitiesCount <= 2) {
      faktorji.push({ naziv: "Slabša dostopnost", opis: "Malo storitev v neposredni bližini", korekcija: -0.03, ikona: "🏚️" });
    }
  }

  // 6. Periferija / oddaljenost od centra (malus)
  if (distCenter > 3.0) {
    faktorji.push({ naziv: "Oddaljena lokacija", opis: `${Math.round(distCenter * 1000)}m od centra`, korekcija: -0.05, ikona: "📍" });
  } else if (distCenter > 5.0) {
    faktorji.push({ naziv: "Periferna lokacija", opis: `${(distCenter).toFixed(1)}km od centra`, korekcija: -0.10, ikona: "📍" });
  }

  // Composite factor — additive corrections, capped at ±25%
  const skupna = faktorji.reduce((sum, f) => sum + f.korekcija, 0);
  const skupniFaktor = 1 + Math.max(-0.25, Math.min(0.25, skupna));

  return { skupniFaktor, faktorji };
}

export interface VisinaSstropov {
  visinaCm: number;
  metoda: "izmerjena" | "ocenjena_leto" | "ocenjena_default";
  opis: string;
  korekcija: number; // vrednostna korekcija
}

export function izracunajVisinoStropov(
  visinaStvabe: number | null,
  steviloEtaz: number | null,
  letoIzgradnje: number | null,
): VisinaSstropov {
  // Metoda 1: Iz izmerjene višine stavbe / število etaž
  if (visinaStvabe && visinaStvabe > 0 && steviloEtaz && steviloEtaz > 0) {
    // Odštejemo ~0.3m na etažo za medetažne plošče
    const brutoNaEtazo = visinaStvabe / steviloEtaz;
    const netoCm = Math.round((brutoNaEtazo - 0.3) * 100);
    if (netoCm >= 200 && netoCm <= 500) {
      const korekcija = netoCm >= 320 ? 0.05 : netoCm >= 290 ? 0.02 : netoCm < 250 ? -0.03 : 0;
      return {
        visinaCm: netoCm,
        metoda: "izmerjena",
        opis: `${(visinaStvabe / steviloEtaz).toFixed(1)}m bruto / etažo`,
        korekcija,
      };
    }
  }

  // Metoda 2: Ocena iz leta izgradnje
  if (letoIzgradnje) {
    if (letoIzgradnje < 1918) return { visinaCm: 350, metoda: "ocenjena_leto", opis: "Predvojna gradnja", korekcija: 0.06 };
    if (letoIzgradnje < 1945) return { visinaCm: 320, metoda: "ocenjena_leto", opis: "Medvojna gradnja", korekcija: 0.04 };
    if (letoIzgradnje < 1965) return { visinaCm: 295, metoda: "ocenjena_leto", opis: "Povojska gradnja", korekcija: 0.02 };
    if (letoIzgradnje < 1990) return { visinaCm: 265, metoda: "ocenjena_leto", opis: "Socialistična gradnja", korekcija: 0 };
    if (letoIzgradnje < 2005) return { visinaCm: 270, metoda: "ocenjena_leto", opis: "Gradnja 90ih", korekcija: 0 };
    return { visinaCm: 275, metoda: "ocenjena_leto", opis: "Sodobna gradnja", korekcija: 0.01 };
  }

  return { visinaCm: 265, metoda: "ocenjena_default", opis: "Povprečna vrednost", korekcija: 0 };
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

  // 10. JAVNI PROMET (OSM)
  const transitScore = (input.busStopsCount ?? 0) + (input.tramStopsCount ?? 0) * 2 + (input.trainStationsCount ?? 0) * 4;
  if (transitScore >= 6) {
    faktorji.push({ naziv: "Odlična dostopnost", ikona: "🚌", opis: `${input.busStopsCount ?? 0} avtobusnih + ${input.tramStopsCount ?? 0} tramvajskih + ${input.trainStationsCount ?? 0} železniških postaj v 300m`, korekcija: 0.04 });
  } else if (transitScore >= 2) {
    faktorji.push({ naziv: "Dobra dostopnost", ikona: "🚌", opis: `Javni promet v 300m: ${input.busStopsCount ?? 0} bus postaj`, korekcija: 0.02 });
  } else if (transitScore === 0) {
    faktorji.push({ naziv: "Slab javni promet", ikona: "🚗", opis: "Ni javnega prevoza v 300m — odvisnost od avtomobila", korekcija: -0.03 });
  }

  // Skupni faktor (multiplikativno, capped ±30%)
  const raw = faktorji.reduce((acc, f) => acc * (1 + f.korekcija), 1);
  const skupniFaktor = Math.max(0.70, Math.min(1.30, raw));

  return { faktorji, skupniFaktor };
}
