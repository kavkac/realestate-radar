"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  height?: string;
}

export default function PriceHeatmapMap({ height = "480px" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const heatLayer = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [46.12, 14.99],
      zoom: 9,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OSM contributors",
      maxZoom: 18,
    }).addTo(map);

    mapInstance.current = map;

    // Load heatmap data
    async function loadHeat() {
      const bounds = map.getBounds();
      const url = `/api/heatmap?lat1=${bounds.getSouth()}&lng1=${bounds.getWest()}&lat2=${bounds.getNorth()}&lng2=${bounds.getEast()}&zoom=${map.getZoom()}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();

      // Import leaflet.heat dynamically
      // @ts-ignore
      if (!L.heatLayer) {
        await import("leaflet.heat");
      }

      // Convert price to intensity [0..1] based on range 500–5000 €/m²
      const points = data.points.map((p: { lat: number; lng: number; price: number }) => {
        const intensity = Math.min(Math.max((p.price - 500) / 4500, 0), 1);
        return [p.lat, p.lng, intensity];
      });

      if (heatLayer.current) {
        map.removeLayer(heatLayer.current);
      }

      // @ts-ignore
      heatLayer.current = L.heatLayer(points, {
        radius: 30,
        blur: 25,
        maxZoom: 13,
        gradient: {
          0.0: "#3b82f6",   // blue — cheap
          0.3: "#22c55e",   // green
          0.55: "#eab308",  // yellow
          0.75: "#f97316",  // orange
          1.0: "#ef4444",   // red — expensive
        },
      }).addTo(map);
    }

    loadHeat();
    map.on("moveend", loadHeat);

    return () => {
      map.off("moveend", loadHeat);
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <div ref={mapRef} style={{ height }} />
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-6 text-xs text-gray-500 flex-wrap">
        <span className="font-medium text-gray-700">Cena €/m²:</span>
        {[["#3b82f6","< 1.000"], ["#22c55e","1.000–2.000"], ["#eab308","2.000–3.000"], ["#f97316","3.000–4.000"], ["#ef4444","> 4.000"]].map(([c,l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="ml-auto">Vir: ETN transakcije · GURS</span>
      </div>
    </div>
  );
}
