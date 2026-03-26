"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fixed absolute price thresholds — stable across all pan/zoom
const PRICE_BANDS = [
  { max: 1000,  color: [67,  56,  202], label: "< 1.000 €/m²" },
  { max: 1500,  color: [37, 130, 220], label: "1.000–1.500" },
  { max: 2000,  color: [34, 197, 194], label: "1.500–2.000" },
  { max: 2500,  color: [74, 200, 100], label: "2.000–2.500" },
  { max: 3000,  color: [202, 220, 50], label: "2.500–3.000" },
  { max: 3500,  color: [245, 158, 11], label: "3.000–3.500" },
  { max: 4500,  color: [239, 100, 20], label: "3.500–4.500" },
  { max: Infinity, color: [220, 30, 20], label: "> 4.500 €/m²" },
];

function priceToNorm(price: number): number {
  const max = 5000, min = 500;
  return Math.min(Math.max((price - min) / (max - min), 0), 1);
}

function priceToColorRgb(price: number, alpha: number): string {
  for (const band of PRICE_BANDS) {
    if (price < band.max) {
      const [r, g, b] = band.color;
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  const [r, g, b] = PRICE_BANDS[PRICE_BANDS.length - 1].color;
  return `rgba(${r},${g},${b},${alpha})`;
}

interface Point { lat: number; lng: number; price: number }

interface TooltipState { x: number; y: number; price: number }

interface Props { height?: string }

export default function PriceHeatmapMap({ height = "480px" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  // All Slovenia points cached — loaded once
  const allPointsRef = useRef<Point[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [loading, setLoading] = useState(true);

  const buildContours = useCallback(async (map: L.Map, points: Point[]) => {
    if (!points.length || !layerGroup.current) return;
    try {
      // @ts-ignore
      const { contours } = await import("d3-contour");

      const zoom = map.getZoom();
      const bounds = map.getBounds();

      // Filter to visible points + small margin
      const margin = 0.1;
      const visible = points.filter(p =>
        p.lat >= bounds.getSouth() - margin &&
        p.lat <= bounds.getNorth() + margin &&
        p.lng >= bounds.getWest() - margin &&
        p.lng <= bounds.getEast() + margin
      );
      if (visible.length < 5) return;

      // Grid cell size — zoom adaptive
      const cellSize = zoom <= 8 ? 0.03 : zoom <= 10 ? 0.015 : zoom <= 12 ? 0.008 : 0.004;

      // Expand bounds slightly for smooth edges
      const latMin = bounds.getSouth() - cellSize * 3;
      const latMax = bounds.getNorth() + cellSize * 3;
      const lngMin = bounds.getWest() - cellSize * 3;
      const lngMax = bounds.getEast() + cellSize * 3;

      const cols = Math.max(2, Math.ceil((lngMax - lngMin) / cellSize));
      const rows = Math.max(2, Math.ceil((latMax - latMin) / cellSize));

      // Aggregate into grid using ALL points (not just visible)
      const broader = points.filter(p =>
        p.lat >= latMin - 0.3 && p.lat <= latMax + 0.3 &&
        p.lng >= lngMin - 0.3 && p.lng <= lngMax + 0.3
      );

      const grid = new Float32Array(cols * rows).fill(0);
      const counts = new Uint16Array(cols * rows).fill(0);

      for (const p of broader) {
        const ci = Math.floor((p.lng - lngMin) / cellSize);
        const ri = Math.floor((p.lat - latMin) / cellSize);
        if (ci < 0 || ci >= cols || ri < 0 || ri >= rows) continue;
        const idx = ri * cols + ci;
        grid[idx] += p.price;
        counts[idx]++;
      }

      // Normalize using FIXED price scale (stable across pans)
      const normalized = new Float32Array(cols * rows);
      const hasData = new Uint8Array(cols * rows);
      for (let i = 0; i < grid.length; i++) {
        if (counts[i] > 0) {
          normalized[i] = priceToNorm(grid[i] / counts[i]);
          hasData[i] = 1;
        }
      }

      // IDW gap fill
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (hasData[idx]) continue;
          let sum = 0, n = 0;
          const radius = Math.min(4, Math.ceil(2 / cellSize * 0.01));
          for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
              const ni = nr * cols + nc;
              if (hasData[ni]) { sum += normalized[ni]; n++; }
            }
          }
          if (n > 0) normalized[idx] = sum / n;
          else normalized[idx] = priceToNorm(1500); // low-value default for no-data areas
        }
      }

      // Fixed contour thresholds based on price bands
      const priceThresholds = [1000, 1500, 2000, 2500, 3000, 3500, 4500, 5000];
      const thresholds = priceThresholds.map(p => priceToNorm(p));

      // @ts-ignore
      const gen = contours().size([cols, rows]).thresholds(thresholds).smooth(true);
      const contourData = gen(normalized as unknown as number[]);

      layerGroup.current!.clearLayers();

      for (let i = 0; i < contourData.length - 1; i++) {
        const c = contourData[i];
        if (!c.coordinates.length) continue;

        // Midpoint price for this band
        const midNorm = (c.value + (contourData[i + 1]?.value ?? 1)) / 2;
        const midPrice = 500 + midNorm * 4500;

        const geoJSON: GeoJSON.MultiPolygon = {
          type: "MultiPolygon",
          coordinates: c.coordinates.map((polygon: number[][][]) =>
            polygon.map((ring: number[][]) =>
              ring.map(([col, row]: number[]) => [
                lngMin + col * cellSize,
                latMin + row * cellSize,
              ])
            )
          ),
        };

        // @ts-ignore
        L.geoJSON(geoJSON, {
          style: {
            fillColor: priceToColorRgb(midPrice, 1),
            fillOpacity: 0.32,
            color: priceToColorRgb(midPrice, 0.7),
            weight: 1.2,
            opacity: 0.8,
          },
        }).addTo(layerGroup.current!);
      }
    } catch (e) {
      console.error("Contour error", e);
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [46.12, 14.99],
      zoom: 9,
      zoomControl: true,
      minZoom: 7,
      maxZoom: 16,
    });

    (map.getContainer() as HTMLElement).style.cursor = "crosshair";

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OSM contributors",
      opacity: 0.75,
    }).addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    // Load ALL Slovenia points ONCE
    async function init() {
      setLoading(true);
      try {
        const res = await fetch("/api/heatmap?lat1=45.4&lng1=13.3&lat2=46.9&lng2=16.6&zoom=8");
        if (!res.ok) return;
        const data = await res.json();
        allPointsRef.current = data.points ?? [];
        await buildContours(map, allPointsRef.current);
      } finally {
        setLoading(false);
      }
    }

    init();

    // On zoom: recompute contours (same data, different grid resolution)
    map.on("zoomend", () => buildContours(map, allPointsRef.current));
    // On pan: recompute contours (filter to visible + margins)
    map.on("moveend", () => buildContours(map, allPointsRef.current));

    // Hover tooltip
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const pts = allPointsRef.current;
      if (!pts.length) return;
      const { lat, lng } = e.latlng;
      let minDist = Infinity, nearest: Point | null = null;
      for (const p of pts) {
        const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
        if (d < minDist) { minDist = d; nearest = p; }
      }
      if (nearest && minDist < 0.04 ** 2) {
        const cp = map.latLngToContainerPoint(e.latlng);
        setTooltip({ x: cp.x, y: cp.y, price: nearest.price });
      } else {
        setTooltip(null);
      }
    });

    map.on("mouseout", () => setTooltip(null));

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [buildContours]);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-100 shadow-sm">
      <div className="relative" style={{ height }}>
        <div ref={mapRef} className="w-full h-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-[500]">
            <div className="text-xs text-gray-400 animate-pulse">Nalagam cenovni heatmap…</div>
          </div>
        )}

        {tooltip && (
          <div
            className="absolute pointer-events-none z-[1000]"
            style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, calc(-100% - 8px))" }}
          >
            <div className="flex items-center justify-center mb-0.5">
              <div className="relative w-4 h-4">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-900" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-900" />
              </div>
            </div>
            <div className="bg-gray-900/90 text-white text-[11px] font-semibold px-2 py-1 rounded shadow-lg whitespace-nowrap">
              {tooltip.price.toLocaleString("sl-SI")} €/m²
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 bg-white border-t border-gray-100 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
        <span className="font-medium text-gray-600 mr-1">€/m²:</span>
        {PRICE_BANDS.slice(0, -1).map((b) => (
          <span key={b.label} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-black/10"
              style={{ background: `rgba(${b.color.join(",")},0.7)` }} />
            {b.label}
          </span>
        ))}
        <span className="ml-auto text-gray-400">ETN · GURS</span>
      </div>
    </div>
  );
}
