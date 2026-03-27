"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fixed absolute price bands — stable colors regardless of viewport
const PRICE_BANDS = [
  { max: 1000,  color: [67,  56,  202] as [number,number,number], label: "< 1.000 €/m²" },
  { max: 1500,  color: [37, 130, 220] as [number,number,number],  label: "1.000–1.500" },
  { max: 2000,  color: [34, 197, 194] as [number,number,number],  label: "1.500–2.000" },
  { max: 2500,  color: [74, 200, 100] as [number,number,number],  label: "2.000–2.500" },
  { max: 3000,  color: [202, 220, 50] as [number,number,number],  label: "2.500–3.000" },
  { max: 3500,  color: [245, 158, 11] as [number,number,number],  label: "3.000–3.500" },
  { max: 4500,  color: [239, 100, 20] as [number,number,number],  label: "3.500–4.500" },
  { max: Infinity, color: [220, 30, 20] as [number,number,number], label: "> 4.500 €/m²" },
];

const MIN_PRICE = 500, MAX_PRICE = 5500;

// Color ramp — full spectrum blue→cyan→green→yellow→orange→red
const COLOR_STOPS: [number, [number,number,number]][] = [
  [0.00, [67,  56,  202]],
  [0.12, [37, 130, 220]],
  [0.25, [34, 197, 194]],
  [0.40, [74, 200, 100]],
  [0.55, [180, 215, 60]],
  [0.68, [245, 190, 20]],
  [0.80, [245, 130, 15]],
  [0.90, [235, 70,  20]],
  [1.00, [200, 20,  20]],
];

// Viewport-adaptive coloring: normalizes to local p05–p95 range
// So whether you're in rural SLO (800–1200) or LJ center (3000–4500),
// you always see the full color spectrum → maximum contrast
let viewportP05 = MIN_PRICE;
let viewportP95 = MAX_PRICE;

function priceToNorm(price: number) {
  return Math.min(Math.max((price - MIN_PRICE) / (MAX_PRICE - MIN_PRICE), 0), 1);
}

function priceToNormAdaptive(price: number) {
  const range = Math.max(viewportP95 - viewportP05, 200);
  return Math.min(Math.max((price - viewportP05) / range, 0), 1);
}

function normToColor(t: number, alpha = 0.28): string {
  let lower = COLOR_STOPS[0], upper = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (t >= COLOR_STOPS[i][0] && t <= COLOR_STOPS[i + 1][0]) {
      lower = COLOR_STOPS[i]; upper = COLOR_STOPS[i + 1]; break;
    }
  }
  const f = (t - lower[0]) / (upper[0] - lower[0] + 0.001);
  const r = Math.round(lower[1][0] + f * (upper[1][0] - lower[1][0]));
  const g = Math.round(lower[1][1] + f * (upper[1][1] - lower[1][1]));
  const b = Math.round(lower[1][2] + f * (upper[1][2] - lower[1][2]));
  return `rgba(${r},${g},${b},${alpha})`;
}

function priceToFill(price: number, alpha = 0.28): string {
  return normToColor(priceToNormAdaptive(price), alpha);
}

function gaussianBlur(data: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 2.5);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-0.5 * (i * i) / (sigma * sigma));
    kernel.push(v);
    ksum += v;
  }
  const kn = kernel.map(v => v / ksum);

  const tmp = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nc = Math.max(0, Math.min(w - 1, c + k));
        sum += data[r * w + nc] * kn[k + radius];
      }
      tmp[r * w + c] = sum;
    }
  }

  const out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nr = Math.max(0, Math.min(h - 1, r + k));
        sum += tmp[nr * w + c] * kn[k + radius];
      }
      out[r * w + c] = sum;
    }
  }
  return out;
}

interface Point { lat: number; lng: number; price: number }
interface TooltipState { x: number; y: number; price: number }
interface Props {
  height?: string;
  centerLat?: number;
  centerLng?: number;
}

export default function PriceHeatmapMap({ height = "420px", centerLat, centerLng }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const hasProp = centerLat != null && centerLng != null;
    const initCenter: [number, number] = hasProp ? [centerLat!, centerLng!] : [46.12, 14.99];
    const initZoom = hasProp ? 15 : 9;

    const map = L.map(mapRef.current, {
      center: initCenter,
      zoom: initZoom,
      zoomControl: false,       // static snapshot — no controls
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
      attributionControl: true,
    });

    (map.getContainer() as HTMLElement).style.cursor = "crosshair";

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OSM contributors",
      opacity: 0.90,
    }).addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    async function loadContours() {
      setLoading(true);
      try {
        const bounds = map.getBounds();
        // High-res local fetch — use zoom 14 for small bbox
        const zoom = hasProp ? 15 : 9;
        const margin = hasProp ? 0.005 : 0;
        const url = `/api/heatmap?lat1=${bounds.getSouth() - margin}&lng1=${bounds.getWest() - margin}&lat2=${bounds.getNorth() + margin}&lng2=${bounds.getEast() + margin}&zoom=${zoom}`;

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.points || data.points.length < 5) return;

        // @ts-ignore
        const { contours } = await import("d3-contour");

        const points: Point[] = data.points;
        pointsRef.current = points;

        // Viewport-adaptive normalization — update global P05/P95 from local data
        const pricesSorted = [...points].map(p => p.price).sort((a, b) => a - b);
        viewportP05 = pricesSorted[Math.floor(pricesSorted.length * 0.05)] ?? MIN_PRICE;
        viewportP95 = pricesSorted[Math.floor(pricesSorted.length * 0.95)] ?? MAX_PRICE;

        // High-res grid for local view
        const cellSize = hasProp ? 0.006 : 0.025;
        const latMin = bounds.getSouth() - cellSize * 4;
        const latMax = bounds.getNorth() + cellSize * 4;
        const lngMin = bounds.getWest() - cellSize * 4;
        const lngMax = bounds.getEast() + cellSize * 4;

        const cols = Math.max(2, Math.ceil((lngMax - lngMin) / cellSize));
        const rows = Math.max(2, Math.ceil((latMax - latMin) / cellSize));

        const grid = new Float32Array(cols * rows).fill(0);
        const counts = new Uint16Array(cols * rows).fill(0);

        for (const p of points) {
          const ci = Math.floor((p.lng - lngMin) / cellSize);
          const ri = Math.floor((p.lat - latMin) / cellSize);
          if (ci < 0 || ci >= cols || ri < 0 || ri >= rows) continue;
          const idx = ri * cols + ci;
          grid[idx] += p.price;
          counts[idx]++;
        }

        const normalized = new Float32Array(cols * rows);
        const hasData = new Uint8Array(cols * rows);
        for (let i = 0; i < grid.length; i++) {
          if (counts[i] > 0) {
            normalized[i] = priceToNorm(grid[i] / counts[i]);
            hasData[i] = 1;
          }
        }

        // Step 1: Fill empty cells with IDW from nearby data cells
        const fillRadius = hasProp ? 8 : 5;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (hasData[idx]) continue;
            let wsum = 0, n = 0;
            for (let dr = -fillRadius; dr <= fillRadius; dr++) {
              for (let dc = -fillRadius; dc <= fillRadius; dc++) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                const ni = nr * cols + nc;
                if (!hasData[ni]) continue;
                const dist2 = dr * dr + dc * dc;
                const w = 1.0 / (dist2 + 0.5);
                wsum += normalized[ni] * w;
                n += w;
              }
            }
            normalized[idx] = n > 0 ? wsum / n : priceToNorm(hasProp ? 2500 : 1800);
          }
        }

        // Step 2: Gaussian blur for smooth gradients (eliminates diamond artifacts)
        const sigma = hasProp ? 2.0 : 1.5;
        const blurred = gaussianBlur(normalized, cols, rows, sigma);
        for (let i = 0; i < normalized.length; i++) normalized[i] = blurred[i];

        // Granular price thresholds for smoother gradient
        const priceThresholds = [800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200, 3600, 4000, 4500];
        const thresholds = priceThresholds.map(p => priceToNorm(p));

        // @ts-ignore
        const gen = contours().size([cols, rows]).thresholds(thresholds).smooth(true);
        const contourData = gen(normalized as unknown as number[]);

        layerGroup.current!.clearLayers();

        for (let i = 0; i < contourData.length - 1; i++) {
          const c = contourData[i];
          if (!c.coordinates.length) continue;

          const midPrice = i < priceThresholds.length - 1
            ? (priceThresholds[i] + priceThresholds[i + 1]) / 2
            : priceThresholds[priceThresholds.length - 1] + 200;

          const geoJSON: GeoJSON.MultiPolygon = {
            type: "MultiPolygon",
            coordinates: c.coordinates.map((poly: number[][][]) =>
              poly.map((ring: number[][]) =>
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
              fillColor: priceToFill(midPrice, 0.42),
              fillOpacity: 0.28,
              color: priceToFill(midPrice, 0.65),
              weight: 1.0,
              opacity: 0.5,
            },
          }).addTo(layerGroup.current!);
        }

        // Property location marker (crosshair pin)
        if (hasProp) {
          const propIcon = L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;background:#fff;border:3px solid #1d4ed8;border-radius:50%;box-shadow:0 0 0 2px rgba(29,78,216,0.3)"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          L.marker([centerLat!, centerLng!], { icon: propIcon, interactive: false })
            .addTo(layerGroup.current!);
        }

      } catch (e) {
        console.error("Contour error", e);
      } finally {
        setLoading(false);
      }
    }

    loadContours();

    // Hover tooltip
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const pts = pointsRef.current;
      if (!pts.length) return;
      const { lat, lng } = e.latlng;
      let minDist = Infinity, nearest: Point | null = null;
      for (const p of pts) {
        const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
        if (d < minDist) { minDist = d; nearest = p; }
      }
      const threshold = hasProp ? 0.025 ** 2 : 0.05 ** 2;
      if (nearest && minDist < threshold) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-100 shadow-sm">
      <div className="relative" style={{ height }}>
        <div ref={mapRef} className="w-full h-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-[500]">
            <div className="text-xs text-gray-400 animate-pulse">Nalagam cenovni heatmap…</div>
          </div>
        )}

        {tooltip && (
          <div
            className="absolute pointer-events-none z-[1000]"
            style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, calc(-100% - 10px))" }}
          >
            <div className="flex justify-center mb-0.5">
              <div className="relative w-4 h-4">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-900 opacity-80" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-900 opacity-80" />
              </div>
            </div>
            <div className="bg-gray-900/90 text-white text-[11px] font-semibold px-2 py-1 rounded shadow-lg whitespace-nowrap">
              {Math.round(tooltip.price).toLocaleString("sl-SI")} €/m²
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 bg-white border-t border-gray-100 flex items-center gap-2 text-[10px] text-gray-500">
        <span className="font-medium text-gray-600 mr-1">€/m²:</span>
        {/* Continuous gradient bar */}
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-gray-400">{viewportP05.toLocaleString("sl-SI")}</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{
            background: `linear-gradient(to right, ${
              COLOR_STOPS.map(([t, [r,g,b]]) => `rgba(${r},${g},${b},0.8) ${Math.round(t*100)}%`).join(", ")
            })`
          }} />
          <span className="text-gray-400">{viewportP95.toLocaleString("sl-SI")}</span>
        </div>
        <span className="ml-2 text-gray-400 flex-shrink-0">ETN · GURS</span>
      </div>
    </div>
  );
}
