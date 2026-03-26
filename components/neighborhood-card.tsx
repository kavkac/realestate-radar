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
    <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium border border-blue-100 whitespace-nowrap inline-block">
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

    // Šole/vrtci: 500m = tvoja soseska; 1km je preširoko za mestno jedro
    if (a5.schools > 0)
      amenityRows.push({ icon: "🏫", label: "Šole", value: `${a5.schools} v 500m` });
    if (a5.kindergartens > 0)
      amenityRows.push({ icon: "🧸", label: "Vrtci", value: `${a5.kindergartens} v 500m` });
    // Univerze: samo prikaz, ne število (prevelika institucija za "soseskco")
    if (a1.universities > 0)
      amenityRows.push({ icon: "🎓", label: "Univerza / fakulteta v bližini", value: "da" });

    // Javni prevoz — prikaži najbližji radij z podatki
    const t3 = a3.bus_stops + a3.tram_stops + a3.train_stations;
    const t5 = a5.bus_stops + a5.tram_stops + a5.train_stations;
    const t1 = a1.bus_stops + a1.tram_stops + a1.train_stations;
    if (t3 > 0)
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `${t3} postaj v 300m` });
    else if (t5 > 0)
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `${t5} postaj v 500m` });
    else if (t1 > 0)
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value: `${t1} postaj v 1km` });

    // Zdravstvo — zdravniki so del ZD/bolnišnic, ne posebej
    if (a1.hospitals > 0)
      amenityRows.push({ icon: "🏥", label: "Bolnišnica v bližini", value: `${a1.hospitals}` });
    if (a1.health_centres > 0)
      amenityRows.push({ icon: "🩺", label: "Zdravstveni domovi", value: `${a1.health_centres}` });
    if (a1.pharmacies > 0) {
      const dist = a5.pharmacies > 0 ? "· najbližja v 500m" : "· v 1km";
      amenityRows.push({ icon: "💊", label: "Lekarne", value: `${a1.pharmacies} ${dist}` });
    }

    // Šport & parki
    if (a1.sports_centres > 0)
      amenityRows.push({ icon: "⚽", label: "Športni objekti", value: `${a1.sports_centres}` });
    if (a5.parks > 0)
      amenityRows.push({ icon: "🌳", label: "Parki", value: `${a5.parks} v 500m` });
    else if (a1.parks > 0)
      amenityRows.push({ icon: "🌳", label: "Parki", value: `${a1.parks} v 1km` });

    // Storitve
    if (a5.supermarkets > 0)
      amenityRows.push({ icon: "🛒", label: "Trgovine / supermarketi", value: `${a5.supermarkets} v 500m` });
    else if (a1.supermarkets > 0)
      amenityRows.push({ icon: "🛒", label: "Trgovine / supermarketi", value: `${a1.supermarkets} v 1km` });
    // Restavracije: 500m = soseskce; 1km inflated v mestnem jedru
    if (a5.restaurants + a5.bars > 0)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `${a5.restaurants + a5.bars} v 500m` });
    // Banke — samo 500m radij (v 1km je preveč poslovalnic); cap 10+
    if (a5.banks > 0) {
      const bankCount = a5.banks > 10 ? "10+" : `${a5.banks}`;
      amenityRows.push({ icon: "🏦", label: "Banke", value: `${bankCount} v 500m` });
    }
    if (a1.postOffices > 0)
      amenityRows.push({ icon: "📮", label: "Pošte", value: `${a1.postOffices}` });

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
