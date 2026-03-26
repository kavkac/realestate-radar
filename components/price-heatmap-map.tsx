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
      zoom: 8,
      zoomControl: true,
      minZoom: 7,
      maxZoom: 16,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OSM contributors",
      maxZoom: 18,
      opacity: 0.6,
    }).addTo(map);

    mapInstance.current = map;

    async function loadHeat() {
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      const url = `/api/heatmap?lat1=${bounds.getSouth()}&lng1=${bounds.getWest()}&lat2=${bounds.getNorth()}&lng2=${bounds.getEast()}&zoom=${zoom}`;

      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        if (!data.points || data.points.length === 0) return;

        // @ts-ignore
        if (!L.heatLayer) {
          await import("leaflet.heat");
        }

        // Dynamic normalization based on ACTUAL data range in current view
        const prices: number[] = data.points.map((p: any) => p.price);
        const p10 = prices.sort((a: number, b: number) => a - b)[Math.floor(prices.length * 0.1)];
        const p90 = prices[Math.floor(prices.length * 0.9)];
        const range = Math.max(p90 - p10, 500);

        const points = data.points.map((p: { lat: number; lng: number; price: number }) => {
          // Normalize to [0..1] using 10th–90th percentile of current view
          const intensity = Math.min(Math.max((p.price - p10) / range, 0), 1);
          return [p.lat, p.lng, intensity];
        });

        if (heatLayer.current) {
          map.removeLayer(heatLayer.current);
        }

        // Zoom-adaptive radius: large blobs at country level, sharp at street level
        const radius = zoom <= 8 ? 45 : zoom <= 9 ? 38 : zoom <= 10 ? 30 : zoom <= 11 ? 24 : zoom <= 12 ? 20 : zoom <= 13 ? 16 : zoom <= 14 ? 14 : 10;
        const blur = Math.round(radius * 0.85);

        // @ts-ignore
        heatLayer.current = L.heatLayer(points, {
          radius,
          blur,
          maxZoom: 17,
          max: 1.0,
          gradient: {
            0.0:  "#2563eb", // deep blue — cheapest
            0.25: "#22c55e", // green
            0.5:  "#facc15", // yellow
            0.75: "#f97316", // orange
            1.0:  "#dc2626", // red — most expensive
          },
        }).addTo(map);
      } catch (e) {
        console.error("Heatmap load error", e);
      }
    }

    loadHeat();
    map.on("moveend", loadHeat);
    map.on("zoomend", loadHeat);

    return () => {
      map.off("moveend", loadHeat);
      map.off("zoomend", loadHeat);
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <div ref={mapRef} style={{ height }} />
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="font-medium text-gray-700">Relativna cena €/m²:</span>
        {[
          ["#2563eb", "nizka"],
          ["#22c55e", "srednja"],
          ["#facc15", "nadpovprečna"],
          ["#f97316", "visoka"],
          ["#dc2626", "najvišja"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="ml-auto text-gray-400">Vir: ETN · GURS</span>
      </div>
    </div>
  );
}
