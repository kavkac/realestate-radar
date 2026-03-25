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

  if (!profile || (!profile.characterTags.length && !profile.noiseLdenDb)) return null;

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

      {/* Stats row */}
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
              }`}>
                {profile.noiseLabel}
              </span>
            </p>
          </div>
        )}

        {profile.pricePerM2_500m != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Povp. cena/m² (500m)</p>
            <p className="font-semibold text-gray-800">{profile.pricePerM2_500m.toLocaleString("sl-SI")} €/m²</p>
          </div>
        )}

        {profile.amenity?.r500 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Javni prevoz (300m)</p>
            <p className="font-semibold text-gray-800">
              {(profile.amenity.r300.bus_stops + profile.amenity.r300.tram_stops + profile.amenity.r300.train_stations)} postaj/postankov
            </p>
          </div>
        )}

        {(profile as any).ageAvg != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Povp. starost</p>
            <p className="font-semibold text-gray-800">{((profile as any).ageAvg as number).toFixed(1)} let</p>
          </div>
        )}

        {profile.eduTertiaryPct != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Visoka izobrazba</p>
            <p className="font-semibold text-gray-800">{profile.eduTertiaryPct.toFixed(1)}%</p>
          </div>
        )}

        {(profile as any).popTotal != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Preb. v 500m celici</p>
            <p className="font-semibold text-gray-800">{Math.round((profile as any).popTotal as number).toLocaleString("sl-SI")}</p>
          </div>
        )}
      </div>

      {/* Amenity tabela — strukturirana po kategorijah */}
      {profile.amenity && (() => {
        const a = profile.amenity.r1000;
        const a5 = profile.amenity.r500;
        const rows: { label: string; icon: string; value: string }[] = [];

        // Vzgoja & izobraževanje
        if (a.schools > 0) rows.push({ icon: "🏫", label: "Šole", value: `${a.schools} · v 1km` });
        if (a.kindergartens > 0) rows.push({ icon: "🧸", label: "Vrtci", value: `${a.kindergartens} · v 1km` });
        if (a.universities > 0) rows.push({ icon: "🎓", label: "Univerze/fakultete", value: `${a.universities}` });

        // Zdravstvo
        if (a.hospitals > 0) rows.push({ icon: "🏥", label: "Bolnišnice", value: `${a.hospitals}` });
        if (a.health_centres > 0) rows.push({ icon: "🩺", label: "Zdravstveni domovi", value: `${a.health_centres}` });
        if (a.doctors > 0) rows.push({ icon: "👨‍⚕️", label: "Zdravniki", value: `${a.doctors}` });
        if (a.pharmacies > 0) rows.push({ icon: "💊", label: "Lekarne", value: `${a5.pharmacies > 0 ? `${a5.pharmacies} · najbližja v 500m` : a.pharmacies}` });

        // Javni prevoz
        const transport500 = a5.bus_stops + a5.tram_stops + a5.train_stations;
        const transport1k = a.bus_stops + a.tram_stops + a.train_stations;
        if (transport1k > 0) {
          const detail = a5.train_stations > 0 ? "🚂 postaja v bližini" : transport500 > 0 ? `${transport500} v 500m` : `${transport1k} v 1km`;
          rows.push({ icon: "🚌", label: "Javni prevoz", value: detail });
        }

        // Šport & rekreacija
        if (a.sports_centres > 0) rows.push({ icon: "⚽", label: "Športni objekti", value: `${a.sports_centres}` });
        if (a5.parks > 0) rows.push({ icon: "🌳", label: "Parki", value: `${a5.parks} · v 500m` });
        else if (a.parks > 0) rows.push({ icon: "🌳", label: "Parki", value: `${a.parks} · v 1km` });

        // Opozorila
        if (a.industrial > 0) rows.push({ icon: "🏭", label: "Industrijska cona", value: "v bližini" });

        if (rows.length === 0) return null;
        return (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-1">Okolica</p>
            <div className="space-y-0.5">
              {rows.map(r => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-gray-500">{r.icon} {r.label}</span>
                  <span className="font-medium text-gray-700">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <p className="text-[9px] text-gray-300">Vir: OSM · ARSO hrupne karte · ETN transakcije</p>
    </div>
  );
}
