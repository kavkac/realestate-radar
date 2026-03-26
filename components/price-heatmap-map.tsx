"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function priceToColor(normalizedValue: number, alpha = 0.55): string {
  const stops = [
    [0.0,  [80,  50,  200]],
    [0.15, [50,  120, 220]],
    [0.3,  [60,  200, 200]],
    [0.45, [80,  200, 80]],
    [0.6,  [200, 220, 60]],
    [0.72, [240, 180, 40]],
    [0.85, [240, 100, 20]],
    [1.0,  [220, 30,  20]],
  ] as [number, [number, number, number]][];

  let lower = stops[0], upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (normalizedValue >= stops[i][0] && normalizedValue <= stops[i + 1][0]) {
      lower = stops[i]; upper = stops[i + 1]; break;
    }
  }
  const t = (normalizedValue - lower[0]) / (upper[0] - lower[0] + 0.0001);
  const r = Math.round(lower[1][0] + t * (upper[1][0] - lower[1][0]));
  const g = Math.round(lower[1][1] + t * (upper[1][1] - lower[1][1]));
  const b = Math.round(lower[1][2] + t * (upper[1][2] - lower[1][2]));
  return `rgba(${r},${g},${b},${alpha})`;
}

interface Point { lat: number; lng: number; price: number }

interface TooltipState {
  x: number;
  y: number;
  price: number;
}

interface Props { height?: string }

export default function PriceHeatmapMap({ height = "480px" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  // Store raw points + normalization params for hover lookup
  const pointsRef = useRef<Point[]>([]);
  const normRef = useRef<{ p05: number; range: number }>({ p05: 0, range: 1 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [46.12, 14.99],
      zoom: 9,
      zoomControl: true,
      minZoom: 7,
      maxZoom: 16,
    });

    // Crosshair cursor
    (map.getContainer() as HTMLElement).style.cursor = "crosshair";

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OSM contributors",
      opacity: 0.7,
    }).addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    // Hover: find nearest point and show price tooltip
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const pts = pointsRef.current;
      if (!pts.length) return;
      const { lat, lng } = e.latlng;
      // Find nearest point (simple O(n) search, adequate for 2-5k points)
      let minDist = Infinity, nearest: Point | null = null;
      for (const p of pts) {
        const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
        if (d < minDist) { minDist = d; nearest = p; }
      }
      // Only show tooltip if nearest point is within ~0.03° (~3km)
      if (nearest && minDist < 0.03 ** 2) {
        const containerPoint = map.latLngToContainerPoint(e.latlng);
        setTooltip({ x: containerPoint.x, y: containerPoint.y, price: nearest.price });
      } else {
        setTooltip(null);
      }
    });

    map.on("mouseout", () => setTooltip(null));

    async function loadContours() {
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      const url = `/api/heatmap?lat1=${bounds.getSouth()}&lng1=${bounds.getWest()}&lat2=${bounds.getNorth()}&lng2=${bounds.getEast()}&zoom=${zoom}`;

      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.points || data.points.length < 10) return;

        // @ts-ignore
        const { contours } = await import("d3-contour");

        const points: Point[] = data.points;
        pointsRef.current = points;

        const sorted = [...points].map(p => p.price).sort((a, b) => a - b);
        const p05 = sorted[Math.floor(sorted.length * 0.05)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const range = Math.max(p95 - p05, 300);
        normRef.current = { p05, range };

        const cellSize = zoom <= 9 ? 0.02 : zoom <= 11 ? 0.01 : 0.005;
        const latMin = bounds.getSouth() - cellSize;
        const latMax = bounds.getNorth() + cellSize;
        const lngMin = bounds.getWest() - cellSize;
        const lngMax = bounds.getEast() + cellSize;

        const cols = Math.ceil((lngMax - lngMin) / cellSize);
        const rows = Math.ceil((latMax - latMin) / cellSize);

        const grid = new Float32Array(cols * rows).fill(-1);
        const counts = new Uint16Array(cols * rows).fill(0);

        for (const p of points) {
          const ci = Math.floor((p.lng - lngMin) / cellSize);
          const ri = Math.floor((p.lat - latMin) / cellSize);
          if (ci < 0 || ci >= cols || ri < 0 || ri >= rows) continue;
          const idx = ri * cols + ci;
          if (grid[idx] === -1) grid[idx] = 0;
          grid[idx] += p.price;
          counts[idx]++;
        }

        const normalized = new Float32Array(cols * rows);
        for (let i = 0; i < grid.length; i++) {
          if (counts[i] > 0) {
            normalized[i] = Math.min(Math.max((grid[i] / counts[i] - p05) / range, 0), 1);
          } else {
            normalized[i] = -1;
          }
        }

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (normalized[idx] >= 0) continue;
            let sum = 0, n = 0;
            for (let dr = -2; dr <= 2; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                const ni = nr * cols + nc;
                if (normalized[ni] >= 0) { sum += normalized[ni]; n++; }
              }
            }
            normalized[idx] = n > 0 ? sum / n : 0.3;
          }
        }

        const levels = 10;
        const thresholds = Array.from({ length: levels + 1 }, (_, i) => i / levels);

        // @ts-ignore
        const contourGenerator = contours()
          .size([cols, rows])
          .thresholds(thresholds)
          .smooth(true);

        const contourData = contourGenerator(normalized as unknown as number[]);

        layerGroup.current!.clearLayers();

        for (let i = 0; i < contourData.length - 1; i++) {
          const c = contourData[i];
          if (!c.coordinates.length) continue;

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
              fillColor: priceToColor(c.value, 0.5),
              fillOpacity: 1,
              color: "rgba(0,0,0,0.25)",
              weight: 0.8,
              opacity: 0.6,
            },
          }).addTo(layerGroup.current!);
        }

      } catch (e) {
        console.error("Contour error", e);
      }
    }

    loadContours();
    map.on("moveend", loadContours);
    map.on("zoomend", loadContours);

    return () => {
      map.off("moveend", loadContours);
      map.off("zoomend", loadContours);
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm relative">
      <div ref={mapRef} style={{ height }} />

      {/* Hover tooltip with crosshair indicator */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-[1000]"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
        >
          {/* Crosshair */}
          <div className="relative flex items-center justify-center mb-1">
            <div className="absolute w-px h-4 bg-gray-800" />
            <div className="absolute h-px w-4 bg-gray-800" />
          </div>
          {/* Price badge */}
          <div className="bg-gray-900/90 text-white text-xs font-semibold px-2 py-1 rounded shadow-lg whitespace-nowrap -translate-y-2">
            {tooltip.price.toLocaleString("sl-SI")} €/m²
          </div>
        </div>
      )}

      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="font-medium text-gray-700">Cena €/m²:</span>
        {[
          ["rgba(80,50,200,0.8)",  "nizka"],
          ["rgba(60,200,200,0.8)", "srednja"],
          ["rgba(200,220,60,0.8)", "nadpovprečna"],
          ["rgba(240,100,20,0.8)", "visoka"],
          ["rgba(220,30,20,0.8)",  "najvišja"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-black/10" style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="ml-auto text-gray-400">Vir: ETN · GURS</span>
      </div>
    </div>
  );
}
