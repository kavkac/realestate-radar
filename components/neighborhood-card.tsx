"use client";

import { useEffect, useState } from "react";
import type { NeighborhoodProfile } from "@/lib/neighborhood-service";

interface Props {
  lat: number;
  lng: number;
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
  const p = profile as any; // za ageAvg, popTotal

  // ── Amenity rows (OSM, vir: 1km radij, točni podatki) ──────────────────────
  const amenityRows: { icon: string; label: string; value: string }[] = [];
  if (a) {
    const a5 = a.r500;
    const a1 = a.r1000;

    // Šole & vzgoja (1km)
    if (a1.schools > 0) amenityRows.push({ icon: "🏫", label: "Šole", value: `${a1.schools} · v 1km` });
    if (a1.kindergartens > 0) amenityRows.push({ icon: "🧸", label: "Vrtci", value: `${a1.kindergartens} · v 1km` });
    if (a1.universities > 0) amenityRows.push({ icon: "🎓", label: "Univerze/fakultete", value: `${a1.universities}` });

    // Javni prevoz — prikaži najnatančnejši dostopni radij
    const t3 = a.r300.bus_stops + a.r300.tram_stops + a.r300.train_stations;
    const t5 = a5.bus_stops + a5.tram_stops + a5.train_stations;
    const t1 = a1.bus_stops + a1.tram_stops + a1.train_stations;
    if (t3 > 0) amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `${t3} postaj · v 300m` });
    else if (t5 > 0) amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `${t5} postaj · v 500m` });
    else if (t1 > 0) amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `${t1} postaj · v 1km` });

    // Zdravstvo — samo relevantno (bolnišnica = posebnost, ne primarni karakter)
    if (a1.hospitals > 0) amenityRows.push({ icon: "🏥", label: "Bolnišnica v bližini", value: `${a1.hospitals}` });
    if (a1.health_centres > 0) amenityRows.push({ icon: "🩺", label: "Zdravstveni domovi", value: `${a1.health_centres}` });
    if (a1.doctors > 0) amenityRows.push({ icon: "👨‍⚕️", label: "Zdravniki", value: `${a1.doctors}` });
    if (a1.pharmacies > 0) {
      const dist = a5.pharmacies > 0 ? " · najbližja v 500m" : " · v 1km";
      amenityRows.push({ icon: "💊", label: "Lekarne", value: `${a1.pharmacies}${dist}` });
    }

    // Šport & parki
    if (a1.sports_centres > 0) amenityRows.push({ icon: "⚽", label: "Športni objekti", value: `${a1.sports_centres}` });
    if (a5.parks > 0) amenityRows.push({ icon: "🌳", label: "Parki", value: `${a5.parks} · v 500m` });
    else if (a1.parks > 0) amenityRows.push({ icon: "🌳", label: "Parki", value: `${a1.parks} · v 1km` });

    // Storitve (500m)
    if (a5.supermarkets > 0) amenityRows.push({ icon: "🛒", label: "Trgovine", value: `${a5.supermarkets} · v 500m` });
    else if (a1.supermarkets > 0) amenityRows.push({ icon: "🛒", label: "Trgovine", value: `${a1.supermarkets} · v 1km` });
    if (a1.banks > 0) amenityRows.push({ icon: "🏦", label: "Banke", value: `${a1.banks}` });
    if (a1.postOffices > 0) amenityRows.push({ icon: "📮", label: "Pošte", value: `${a1.postOffices}` });
    if (a1.restaurants > 0) amenityRows.push({ icon: "🍽️", label: "Restavracije", value: `${a1.restaurants}` });

    // Opozorilo — industrija
    if (a1.industrial > 0) amenityRows.push({ icon: "🏭", label: "Industrijska cona", value: "v bližini ⚠️" });
  }

  const hasContent = profile.characterTags.length > 0 || profile.noiseLdenDb != null ||
    profile.pricePerM2_500m != null || amenityRows.length > 0 || p.ageAvg != null;
  if (!hasContent) return null;

  return (
    <div className="space-y-3">
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

      {/* Ključni stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
        {profile.noiseLdenDb != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Hrup (Lden)</p>
            <p className="font-semibold text-gray-800">
              {profile.noiseLdenDb.toFixed(0)} dB
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
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
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Povp. cena/m² (500m)</p>
            <p className="font-semibold text-gray-800">{profile.pricePerM2_500m.toLocaleString("sl-SI")} €/m²</p>
          </div>
        )}

        {p.ageAvg != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Povp. starost</p>
            <p className="font-semibold text-gray-800">{(p.ageAvg as number).toFixed(1)} let</p>
          </div>
        )}

        {profile.eduTertiaryPct != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Visoka izobrazba</p>
            <p className="font-semibold text-gray-800">{profile.eduTertiaryPct.toFixed(1)}%</p>
          </div>
        )}

        {p.popTotal != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Preb. (500m celica)</p>
            <p className="font-semibold text-gray-800">{Math.round(p.popTotal as number).toLocaleString("sl-SI")}</p>
          </div>
        )}
      </div>

      {/* Amenity tabela */}
      {amenityRows.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-1">Bližnja infrastruktura</p>
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

      <p className="text-[9px] text-gray-300">Vir: OSM Overpass · ARSO hrupne karte · ETN transakcije · SURS grid 500m</p>
    </div>
  );
}
