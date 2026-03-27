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

    const nr = a.nearest;

    // Helper: format razdalja z imenom
    const fmtDist = (distM: number): string => {
      if (distM < 100) return `${distM}m`;
      if (distM < 1000) return `~${Math.round(distM / 50) * 50}m`;
      return `~${(distM / 1000).toFixed(1)}km`;
    };
    const fmtNearest = (n: { name?: string; distM: number } | undefined): string | null => {
      if (!n) return null;
      const d = fmtDist(n.distM);
      return n.name ? `${n.name} · ${d}` : d;
    };

    // ── VSAKODNEVNE STORITVE — razdalja + ime + število ────────────────────

    // Supermarket: ime najbližjega + razdalja + skupno število v 1km
    if (nr.supermarket || a1.supermarkets > 0) {
      const nearStr = fmtNearest(nr.supermarket);
      const totalStr = a1.supermarkets > 1 ? ` · ${a1.supermarkets} v 1km` : "";
      amenityRows.push({ icon: "🛒", label: "Supermarket", value: nearStr ? `${nearStr}${totalStr}` : `${a1.supermarkets} v 1km` });
    }

    // Lekarna: ime najbližje + razdalja
    if (nr.pharmacy || a1.pharmacies > 0) {
      const nearStr = fmtNearest(nr.pharmacy);
      const totalStr = a1.pharmacies > 1 ? ` · ${a1.pharmacies} v 1km` : "";
      amenityRows.push({ icon: "💊", label: "Lekarna", value: nearStr ? `${nearStr}${totalStr}` : `${a1.pharmacies} v 1km` });
    }

    // Javni prevoz: postaja + razdalja + skupno število v okolici
    const t3 = (a3.bus_stops ?? 0) + (a3.tram_stops ?? 0);
    const t5 = a5.bus_stops + a5.tram_stops;
    const t1 = a1.bus_stops + a1.tram_stops + a1.train_stations;
    if (t1 > 0) {
      const nearStr = fmtNearest(nr.bus_stop);
      const closestRange = t3 > 0 ? "v 300m" : t5 > 0 ? "v 500m" : "v 1km";
      const countStr = t3 > 0 ? `${t3} postaj ${closestRange}` : t5 > 0 ? `${t5} postaj ${closestRange}` : `${t1} postaj ${closestRange}`;
      const value = nearStr ? `najbližja ${nearStr.split("·")[1]?.trim() ?? nearStr} · ${countStr}` : countStr;
      amenityRows.push({ icon: "🚌", label: "Javni prevoz", value });
    }

    // Park: ime + razdalja
    if (nr.park || a1.parks > 0) {
      const nearStr = fmtNearest(nr.park);
      amenityRows.push({ icon: "🌳", label: "Park", value: nearStr ?? `v 1km` });
    }

    // ── STORITVE V SOSEŠKI ─────────────────────────────────────────────────

    if (a5.schools > 0)
      amenityRows.push({ icon: "🏫", label: "Šole", value: `${Math.min(a5.schools, 5)} v 500m` });
    else if (a1.schools > 0)
      amenityRows.push({ icon: "🏫", label: "Šola", value: `najbližja v 1km` });
    if (a5.kindergartens > 0)
      amenityRows.push({ icon: "🧸", label: "Vrtci", value: `${Math.min(a5.kindergartens, 5)} v 500m` });

    const uniCount = Math.min((a5.universities ?? 0) || a1.universities, 3);
    if (uniCount === 1) amenityRows.push({ icon: "🎓", label: "Fakulteta", value: `v bližini` });
    else if (uniCount > 1) amenityRows.push({ icon: "🎓", label: "Univerzetno okolje", value: `${uniCount}+ fakultet v bližini` });

    // ── ZDRAVSTVO ──────────────────────────────────────────────────────────

    if (nr.health_centre || a1.health_centres > 0) {
      const nearStr = fmtNearest(nr.health_centre);
      amenityRows.push({ icon: "🩺", label: "Zdravstveni dom", value: nearStr ?? `v 1km` });
    }
    if (a1.hospitals > 0)
      amenityRows.push({ icon: "🏥", label: "Bolnišnica", value: `v 1km` });

    // ── GOSTINSTVO — opisno za večje, število za manjše ───────────────────

    const restoTotal = a5.restaurants + a5.bars;
    if (restoTotal >= 30)
      amenityRows.push({ icon: "🍽️", label: "Gostinstvo", value: `izjemno živahna soseska (${restoTotal}+ v 500m)` });
    else if (restoTotal >= 10)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `${restoTotal} v 500m — živahna ponudba` });
    else if (restoTotal >= 3)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `${restoTotal} v 500m` });
    else if (a1.restaurants + a1.bars >= 3)
      amenityRows.push({ icon: "🍽️", label: "Restavracije / bari", value: `${a1.restaurants + a1.bars} v 1km` });

    // ── OSTALE STORITVE ────────────────────────────────────────────────────

    if (nr.sports_centre || a1.sports_centres > 0) {
      const nearStr = fmtNearest(nr.sports_centre);
      amenityRows.push({ icon: "⚽", label: "Šport / fitnes", value: nearStr ?? `v 1km` });
    }

    if (nr.bank || a5.banks > 0) {
      const nearStr = fmtNearest(nr.bank);
      const totalStr = a5.banks > 1 ? ` · ${a5.banks} v 500m` : "";
      amenityRows.push({ icon: "🏦", label: "Banka", value: nearStr ? `${nearStr}${totalStr}` : `${a5.banks} v 500m` });
    }

    if (nr.post_office || a1.postOffices > 0) {
      const nearStr = fmtNearest(nr.post_office);
      amenityRows.push({ icon: "📮", label: "Pošta", value: nearStr ?? `v 1km` });
    }

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
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Hrupnost (Lden)</span>
                <SourceBadge label="ARSO 2020" />
              </div>
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
