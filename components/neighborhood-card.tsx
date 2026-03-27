"use client";

import { useEffect, useState } from "react";
import type { NeighborhoodProfile } from "@/lib/neighborhood-service";

interface Props {
  lat: number;
  lng: number;
}

// Vir badge — konsistenten z EIZ auditor report
function SourceBadge({ label }: { label: string }) {
  return (
    <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium border border-blue-100 whitespace-nowrap inline-block normal-case tracking-normal" style={{ fontVariant: "normal", textTransform: "none", letterSpacing: "normal" }}>
      {label}
    </span>
  );
}

export function NeighborhoodCard({ lat, lng }: Props) {
  const [profile, setProfile] = useState<NeighborhoodProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/neighborhood?lat=${lat}&lng=${lng}`)
      .then(r => r.json())
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lat, lng]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-3 bg-gray-50 rounded w-2/3" />
      </div>
    );
  }

  if (!profile) return null;

  const a = profile.amenity;
  const p = profile as any;

  // ── Amenity rows (enotni vir: OSM Overpass, 300m/500m/1km) ────────────────
  type ARow = { icon: string; label: string; value: string };
  const amenityRows: ARow[] = [];

  if (a) {
    const a3 = a.r300;
    const a5 = a.r500;
    const a1 = a.r1000;

    // Helper: najbližji radij kjer je count > 0
    const nearest = (r300: number, r500: number, r1000: number): string | null => {
      if (r300 > 0) return "~300m";
      if (r500 > 0) return "~500m";
      if (r1000 > 0) return "~1km";
      return null;
    };

    // ── VSAKODNEVNE STORITVE — prikaži razdaljo do najbližjega ──────────────

    // Supermarket: razdalja do najbližjega je ključna informacija
    const superDist = nearest(a3.supermarkets ?? 0, a5.supermarkets, a1.supermarkets);
    if (superDist) amenityRows.push({ icon: "🛒", label: "Supermarket", value: `najbližji ${superDist}` });

    // Lekarna: najbližja razdalja
    const pharmDist = nearest(a3.pharmacies ?? 0, a5.pharmacies, a1.pharmacies);
    if (pharmDist) amenityRows.push({ icon: "💊", label: "Lekarna", value: `najbližja ${pharmDist}` });

    // Javni prevoz: razdalja do postaje
    const t3 = (a3.bus_stops ?? 0) + (a3.tram_stops ?? 0) + (a3.train_stations ?? 0);
    const t5 = a5.bus_stops + a5.tram_stops + a5.train_stations;
    const t1 = a1.bus_stops + a1.tram_stops + a1.train_stations;
    if (t3 > 0)
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `postaja ~300m hoje` });
    else if (t5 > 0)
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `postaja ~500m hoje` });
    else if (t1 > 0)
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `postaja ~1km hoje` });

    // Park: razdalja do najbližjega
    const parkDist = nearest(a3.parks ?? 0, a5.parks, a1.parks);
    if (parkDist) amenityRows.push({ icon: "🌳", label: "Park / zelena površina", value: `najbližji ${parkDist}` });

    // ── STORITVE V SOSEŠKI ─────────────────────────────────────────────────

    // Šole: število v 500m (za starše je to ključni radij)
    if (a5.schools > 0)
      amenityRows.push({ icon: "🏫", label: "Šole", value: `${Math.min(a5.schools, 5)} v 500m` });
    else if (a1.schools > 0)
      amenityRows.push({ icon: "🏫", label: "Šola", value: `najbližja ~1km` });
    if (a5.kindergartens > 0)
      amenityRows.push({ icon: "🧸", label: "Vrtci", value: `${Math.min(a5.kindergartens, 5)} v 500m` });

    // Univerze: cap na 3, nad 3 je samo "v bližini"
    const uniCount = Math.min(a5.universities ?? 0, 3) || Math.min(a1.universities, 3);
    if (uniCount === 1) amenityRows.push({ icon: "🎓", label: "Fakulteta", value: `v bližini` });
    else if (uniCount > 1) amenityRows.push({ icon: "🎓", label: "Univerzetno okolje", value: `${uniCount}+ fakultet v bližini` });

    // ── ZDRAVSTVO ──────────────────────────────────────────────────────────

    // Zdravstveni dom: razdalja
    const zdDist = nearest(a3.health_centres ?? 0, a5.health_centres ?? 0, a1.health_centres);
    if (zdDist) amenityRows.push({ icon: "🩺", label: "Zdravstveni dom", value: `${zdDist}` });

    // Bolnišnica: samo če v 1km (redka, a pomembna)
    if (a1.hospitals > 0)
      amenityRows.push({ icon: "🏥", label: "Bolnišnica", value: `v 1km` });

    // ── GOSTINSTVO — opisno, ne surovo število ────────────────────────────

    const restoTotal = a5.restaurants + a5.bars;
    if (restoTotal >= 30)
      amenityRows.push({ icon: "🍽️", label: "Gostinstvo", value: `izjemno živahna soseska` });
    else if (restoTotal >= 10)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `živahna ponudba v 500m` });
    else if (restoTotal >= 3)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `${restoTotal} v 500m` });
    else if (a1.restaurants + a1.bars >= 3)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `v bližini ~1km` });

    // ── OSTALE STORITVE ────────────────────────────────────────────────────

    // Šport: razdalja do najbližjega
    const sportDist = nearest(a3.sports_centres ?? 0, a5.sports_centres ?? 0, a1.sports_centres);
    if (sportDist) amenityRows.push({ icon: "⚽", label: "Šport / fitnes", value: `${sportDist}` });

    // Banka: samo razdalja (ne število)
    const bankDist = nearest(a3.banks ?? 0, a5.banks, a1.banks);
    if (bankDist) amenityRows.push({ icon: "🏦", label: "Banka", value: `${bankDist}` });

    // Pošta: razdalja
    const postDist = nearest(0, a5.postOffices ?? 0, a1.postOffices);
    if (postDist) amenityRows.push({ icon: "📮", label: "Pošta", value: `${postDist}` });

    if (a1.industrial > 0)
      amenityRows.push({ icon: "🏭", label: "Industrijska cona", value: "v bližini ⚠️" });
  }

  // ── Demografski stats ──────────────────────────────────────────────────────
  type DRow = { label: string; value: string; source: string };
  const demoRows: DRow[] = [];
  if (p.ageAvg != null)
    demoRows.push({ label: "Povprečna starost", value: `${(p.ageAvg as number).toFixed(1)} let`, source: "SURS 500m" });
  if (profile.eduTertiaryPct != null)
    demoRows.push({ label: "Visoka izobrazba", value: `${profile.eduTertiaryPct.toFixed(1)}%`, source: "SURS 500m" });
  if (p.popTotal != null)
    demoRows.push({ label: "Preb. v 500m celici", value: `${Math.round(p.popTotal as number).toLocaleString("sl-SI")}`, source: "SURS 500m" });

  // Vedno prikažemo sekcijo — tudi če je delno naložena (timeout enega vira ne blokira vsega)
  const hasContent = profile.characterTags.length > 0 || profile.noiseLdenDb != null ||
    profile.pricePerM2_500m != null || amenityRows.length > 0 || demoRows.length > 0;
  if (!hasContent && (profile as any)._error) {
    return <p className="text-xs text-gray-400">Podatki začasno nedostopni (timeout)</p>;
  }

  return (
    <div className="space-y-3">
      {/* Ime soseskce iz OSM is_in */}
      {(profile as any).neighborhoodName && (
        <p className="text-xs font-semibold text-gray-600 -mb-1">
          📍 {(profile as any).neighborhoodName}
        </p>
      )}

      {/* Character tags */}
      {profile.characterTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {profile.characterTags.map((tag, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 font-medium">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Hrup + cena/m² */}
      {(profile.noiseLdenDb != null || profile.pricePerM2_500m != null) && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {profile.noiseLdenDb != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
                Hrupnost (Lden) <SourceBadge label="ARSO 2020" />
              </p>
              <p className="font-semibold text-gray-800">
                {profile.noiseLdenDb} dB
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                  profile.noiseLabel === "tiho" ? "bg-green-50 text-green-700" :
                  profile.noiseLabel === "zmerno" ? "bg-yellow-50 text-yellow-700" :
                  profile.noiseLabel === "prometno" ? "bg-orange-50 text-orange-700" :
                  "bg-red-50 text-red-700"
                }`}>{profile.noiseLabel}</span>
              </p>
            </div>
          )}
          {profile.pricePerM2_500m != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
                Povp. cena/m² (500m) <SourceBadge label="ETN" />
              </p>
              <p className="font-semibold text-gray-800">{profile.pricePerM2_500m.toLocaleString("sl-SI")} €/m²</p>
            </div>
          )}
        </div>
      )}

      {/* Demografija */}
      {demoRows.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-1">Demografija <SourceBadge label="SURS 500m" /></p>
          <div className="space-y-0.5">
            {demoRows.map(r => (
              <div key={r.label} className="flex justify-between text-xs">
                <span className="text-gray-500">{r.label}</span>
                <span className="font-medium text-gray-700">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bližnja infrastruktura */}
      {amenityRows.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-1">
            Bližnja infrastruktura <SourceBadge label="OSM" />
          </p>
          <div className="space-y-0.5">
            {amenityRows.map(r => (
              <div key={r.label} className="flex justify-between text-xs">
                <span className="text-gray-500">{r.icon} {r.label}</span>
                <span className="font-medium text-gray-700">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
