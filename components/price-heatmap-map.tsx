"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Viewport-adaptive color scale
const COLOR_STOPS: [number, [number,number,number]][] = [
  [0.00, [59,  130, 246]],  // blue
  [0.20, [34,  197, 194]],  // teal
  [0.40, [74,  200, 100]],  // green
  [0.60, [234, 179,  8]],   // yellow
  [0.80, [249, 115, 22]],   // orange
  [1.00, [239,  68, 68]],   // red
];

function normToRgb(t: number): [number,number,number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [t0, c0] = COLOR_STOPS[i];
    const [t1, c1] = COLOR_STOPS[i + 1];
    if (clamped <= t1) {
      const f = (clamped - t0) / (t1 - t0 + 0.0001);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

interface Point { lat: number; lng: number; price: number }
interface TooltipState { x: number; y: number; price: number }
interface Props { height?: string; centerLat?: number; centerLng?: number }

export default function PriceHeatmapMap({ height = "400px", centerLat, centerLng }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [loading, setLoading] = useState(true);
  const [legendRange, setLegendRange] = useState<[number, number]>([1000, 4000]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const hasProp = centerLat != null && centerLng != null;
    const initCenter: [number, number] = hasProp ? [centerLat!, centerLng!] : [46.12, 14.99];
    const initZoom = hasProp ? 16 : 9;

    const map = L.map(mapRef.current, {
      center: initCenter,
      zoom: initZoom,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      opacity: 0.85,
    }).addTo(map);

    mapInstance.current = map;

    // Create canvas overlay that covers the map
    const canvas = canvasRef.current!;
    const resizeCanvas = () => {
      if (!mapRef.current) return;
      canvas.width = mapRef.current.offsetWidth;
      canvas.height = mapRef.current.offsetHeight;
    };
    resizeCanvas();

    // Fetch data using lat1/lng1/lat2/lng2 params
    const bounds = map.getBounds();
    const margin = hasProp ? 0.005 : 0;
    const url = `/api/heatmap?lat1=${bounds.getSouth() - margin}&lng1=${bounds.getWest() - margin}&lat2=${bounds.getNorth() + margin}&lng2=${bounds.getEast() + margin}&zoom=16`;
    fetch(url)
      .then(r => r.json())
      .then((data: { points?: Point[] }) => {
        const points: Point[] = data.points ?? [];
        pointsRef.current = points;
        setLoading(false);
        renderHeatmap(map, canvas, points);
      })
      .catch(() => setLoading(false));

    // Mousemove for tooltip
    const container = mapRef.current!;
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const ll = map.containerPointToLatLng([mx, my]);
      let best: Point | null = null, bestD = Infinity;
      for (const p of pts) {
        const d = (p.lat - ll.lat) ** 2 + (p.lng - ll.lng) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best && bestD < 0.01) {
        setTooltip({ x: mx, y: my, price: best.price });
      } else {
        setTooltip(null);
      }
    };
    const onMouseLeave = () => setTooltip(null);
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);

    return () => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
      map.remove();
      mapInstance.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderHeatmap(map: L.Map, canvas: HTMLCanvasElement, points: Point[]) {
    if (points.length === 0) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    // Compute viewport P05/P95 for adaptive color range
    const sorted = [...points].map(p => p.price).sort((a, b) => a - b);
    const p05 = sorted[Math.floor(sorted.length * 0.05)] ?? 1000;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 4000;
    setLegendRange([Math.round(p05 / 100) * 100, Math.round(p95 / 100) * 100]);

    // Build pixel grid — use STEP pixels for performance
    const STEP = 4; // render every 4px
    const imageData = ctx.createImageData(W, H);
    const data = imageData.data;

    // Pre-project all data points to canvas pixels
    type Px = { px: number; py: number; price: number };
    const projected: Px[] = points.map(p => {
      const pt = map.latLngToContainerPoint([p.lat, p.lng]);
      return { px: pt.x, py: pt.y, price: p.price };
    });

    // IDW radius in pixels — ~80px covers ~300m at zoom 16
    const R = 80;
    const R2 = R * R;

    for (let y = 0; y < H; y += STEP) {
      for (let x = 0; x < W; x += STEP) {
        let wsum = 0, psum = 0, n = 0;
        for (const p of projected) {
          const dx = x - p.px, dy = y - p.py;
          const d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          const w = 1 / (d2 + 1);
          wsum += w;
          psum += w * p.price;
          n++;
        }
        if (n === 0) continue;
        const price = psum / wsum;
        const t = Math.max(0, Math.min(1, (price - p05) / (p95 - p05 + 1)));
        const [r, g, b] = normToRgb(t);
        const alpha = Math.min(200, n * 30); // more opaque where denser

        // Fill STEP×STEP block
        for (let dy = 0; dy < STEP && y + dy < H; dy++) {
          for (let dx = 0; dx < STEP && x + dx < W; dx++) {
            const idx = ((y + dy) * W + (x + dx)) * 4;
            data[idx]     = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = alpha;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Apply CSS blur for smooth gradient appearance
    canvas.style.filter = "blur(8px)";
    canvas.style.opacity = "0.65";
  }

  return (
    <div className="relative overflow-hidden rounded-xl" style={{ height }}>
      <div ref={mapRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ mixBlendMode: "multiply" }}
      />

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
          <div className="bg-gray-900/90 text-white text-[11px] font-semibold px-2 py-1 rounded shadow-lg whitespace-nowrap">
            {Math.round(tooltip.price).toLocaleString("sl-SI")} €/m²
          </div>
        </div>
      )}

      {/* Property pin */}
      {centerLat != null && centerLng != null && mapInstance.current && (
        <div className="absolute z-[600] pointer-events-none" style={{
          left: "50%", top: "50%", transform: "translate(-50%, -50%)"
        }}>
          <div className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-lg" />
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 right-2 z-[600] pointer-events-none">
        <div className="bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-2 text-[10px] text-gray-500 shadow-sm">
          <span className="font-medium text-gray-600">{legendRange[0].toLocaleString("sl-SI")}</span>
          <div className="flex-1 h-2 rounded-full" style={{
            background: `linear-gradient(to right, ${COLOR_STOPS.map(([t, [r,g,b]]) => `rgb(${r},${g},${b}) ${Math.round(t*100)}%`).join(", ")})`
          }} />
          <span className="font-medium text-gray-600">{legendRange[1].toLocaleString("sl-SI")} €/m²</span>
          <span className="text-gray-400 ml-1">ETN</span>
        </div>
      </div>
    </div>
  );
}
