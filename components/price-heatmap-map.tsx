"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface HeatmapPoint {
  lat: number;
  lng: number;
  price: number;
  n_comps: number;
}

interface HeatmapData {
  points: HeatmapPoint[];
  min_price: number;
  max_price: number;
}

interface PriceHeatmapMapProps {
  center?: [number, number];
  zoom?: number;
  height?: string;
}

function priceColor(price: number): string {
  if (price < 1000) return "#3b82f6";
  if (price < 2000) return "#22c55e";
  if (price < 3000) return "#eab308";
  if (price < 4000) return "#f97316";
  return "#ef4444";
}

function circleRadius(zoom: number): number {
  if (zoom >= 14) return 20;
  if (zoom >= 12) return 12;
  return 8;
}

const LEGEND_ITEMS = [
  { label: "< 1.000", color: "#3b82f6" },
  { label: "1.000–2.000", color: "#22c55e" },
  { label: "2.000–3.000", color: "#eab308" },
  { label: "3.000–4.000", color: "#f97316" },
  { label: "> 4.000", color: "#ef4444" },
] as const;

function HeatmapLayer({
  points,
  zoom,
}: {
  points: HeatmapPoint[];
  zoom: number;
}) {
  const radius = circleRadius(zoom);
  return (
    <>
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={radius}
          pathOptions={{
            color: priceColor(p.price),
            fillColor: priceColor(p.price),
            fillOpacity: 0.7,
            weight: 1,
            opacity: 0.7,
          }}
        >
          <Tooltip direction="top" offset={[0, -radius]}>
            {p.price.toLocaleString("sl-SI")} €/m² ({p.n_comps} prodaj)
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

function MapEventHandler({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: { lat1: number; lng1: number; lat2: number; lng2: number; zoom: number }) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBoundsChange({
        lat1: b.getSouth(),
        lng1: b.getWest(),
        lat2: b.getNorth(),
        lng2: b.getEast(),
        zoom: map.getZoom(),
      });
    },
  });

  // Trigger initial load
  useEffect(() => {
    const b = map.getBounds();
    onBoundsChange({
      lat1: b.getSouth(),
      lng1: b.getWest(),
      lat2: b.getNorth(),
      lng2: b.getEast(),
      zoom: map.getZoom(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function PriceHeatmapMap({
  center = [46.0569, 14.5058],
  zoom = 10,
  height = "500px",
}: PriceHeatmapMapProps) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (bounds: { lat1: number; lng1: number; lat2: number; lng2: number; zoom: number }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setCurrentZoom(bounds.zoom);
      setLoading(true);

      try {
        const params = new URLSearchParams({
          lat1: bounds.lat1.toString(),
          lng1: bounds.lng1.toString(),
          lat2: bounds.lat2.toString(),
          lng2: bounds.lng2.toString(),
          zoom: bounds.zoom.toString(),
        });
        const res = await fetch(`/api/heatmap?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("fetch failed");
        const json: HeatmapData = await res.json();
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Heatmap fetch error:", err);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return (
    <div className="relative" style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={true}
        className="h-full w-full rounded-lg z-0"
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OSM contributors"
        />

        <MapEventHandler onBoundsChange={fetchData} />

        {data && <HeatmapLayer points={data.points} zoom={currentZoom} />}
      </MapContainer>

      {/* Loading indicator */}
      {loading && (
        <div className="absolute top-2 left-2 z-[1000] bg-white/90 text-xs px-2 py-1 rounded shadow">
          Nalagam...
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 rounded-lg shadow-md p-3 text-xs">
        <div className="font-semibold mb-1.5 text-gray-700">€/m²</div>
        {LEGEND_ITEMS.map((item) => (
          <div key={item.color} className="flex items-center gap-2 py-0.5">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color, opacity: 0.7 }}
            />
            <span className="text-gray-600">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
