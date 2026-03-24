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
              {(profile.amenity.r300.bus_stops + profile.amenity.r300.tram_stops)} postaj
            </p>
          </div>
        )}

        {profile.ageO65Pct != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Nad 65 let</p>
            <p className="font-semibold text-gray-800">{profile.ageO65Pct.toFixed(0)}% prebivalcev</p>
          </div>
        )}

        {profile.statOkolisName && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Statistični okoliš</p>
            <p className="font-semibold text-gray-800 truncate">{profile.statOkolisName}</p>
          </div>
        )}
      </div>

      {/* Amenity mini grid */}
      {profile.amenity && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {profile.amenity.r500.universities > 0 && (
            <span>🎓 {profile.amenity.r500.universities} univerza/fakulteta</span>
          )}
          {profile.amenity.r500.schools > 0 && (
            <span>🏫 {profile.amenity.r500.schools} šole</span>
          )}
          {profile.amenity.r500.parks > 0 && (
            <span>🌳 {profile.amenity.r500.parks} parki</span>
          )}
          {profile.amenity.r500.industrial > 0 && (
            <span>🏭 Industrijska cona v bližini</span>
          )}
          {profile.amenity.r500.hospitals > 0 && (
            <span>🏥 Bolnišnica</span>
          )}
        </div>
      )}

      <p className="text-[9px] text-gray-300">Vir: OSM · ARSO hrupne karte · ETN transakcije</p>
    </div>
  );
}
