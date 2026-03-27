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

function priceToNorm(price: number) {
  return Math.min(Math.max((price - MIN_PRICE) / (MAX_PRICE - MIN_PRICE), 0), 1);
}

function priceToFill(price: number, alpha = 0.42): string {
  for (const b of PRICE_BANDS) {
    if (price < b.max) {
      return `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${alpha})`;
    }
  }
  const last = PRICE_BANDS[PRICE_BANDS.length - 1];
  return `rgba(${last.color[0]},${last.color[1]},${last.color[2]},${alpha})`;
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
    const initZoom = hasProp ? 13 : 9;

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
      opacity: 0.75,
    }).addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    async function loadContours() {
      setLoading(true);
      try {
        const bounds = map.getBounds();
        // High-res local fetch — use zoom 14 for small bbox
        const zoom = hasProp ? 14 : 9;
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

        // High-res grid for local view
        const cellSize = hasProp ? 0.003 : 0.02;
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

        // IDW gap fill — wider radius for local high-res view
        const fillRadius = hasProp ? 5 : 3;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (hasData[idx]) continue;
            let sum = 0, n = 0;
            for (let dr = -fillRadius; dr <= fillRadius; dr++) {
              for (let dc = -fillRadius; dc <= fillRadius; dc++) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                const ni = nr * cols + nc;
                if (hasData[ni]) {
                  const dist = Math.sqrt(dr * dr + dc * dc) + 0.5;
                  sum += normalized[ni] / dist;
                  n += 1 / dist;
                }
              }
            }
            normalized[idx] = n > 0 ? sum / n : priceToNorm(2000);
          }
        }

        // Fixed price thresholds
        const thresholds = [1000, 1500, 2000, 2500, 3000, 3500, 4500]
          .map(p => priceToNorm(p));

        // @ts-ignore
        const gen = contours().size([cols, rows]).thresholds(thresholds).smooth(true);
        const contourData = gen(normalized as unknown as number[]);

        layerGroup.current!.clearLayers();

        for (let i = 0; i < contourData.length - 1; i++) {
          const c = contourData[i];
          if (!c.coordinates.length) continue;

          const midNorm = (c.value + (contourData[i + 1]?.value ?? 1)) / 2;
          const midPrice = MIN_PRICE + midNorm * (MAX_PRICE - MIN_PRICE);

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
              fillOpacity: 1,
              color: priceToFill(midPrice, 0.65),
              weight: 1.0,
              opacity: 0.9,
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

      <div className="px-4 py-2.5 bg-white border-t border-gray-100 flex items-center gap-2.5 text-[10px] text-gray-500 flex-wrap">
        <span className="font-medium text-gray-600">€/m²:</span>
        {PRICE_BANDS.slice(0, 6).map((b) => (
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
