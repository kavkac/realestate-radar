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
