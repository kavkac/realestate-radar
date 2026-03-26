import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { wgs84ToD96 } from "@/lib/wgs84-to-d96";
import proj4 from "proj4";

const D96_TM =
  "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const d96ToWgs84 = proj4(D96_TM, "WGS84");

function convertD96ToWgs84(e: number, n: number): { lat: number; lng: number } {
  const [lng, lat] = d96ToWgs84.forward([e, n]);
  return { lat, lng };
}

interface PriceSurfaceRow {
  e: number;
  n: number;
  price_eur_m2: number;
  n_comps: number;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat1 = parseFloat(sp.get("lat1") ?? "");
  const lng1 = parseFloat(sp.get("lng1") ?? "");
  const lat2 = parseFloat(sp.get("lat2") ?? "");
  const lng2 = parseFloat(sp.get("lng2") ?? "");
  const zoom = parseInt(sp.get("zoom") ?? "10", 10);

  if ([lat1, lng1, lat2, lng2].some(Number.isNaN)) {
    return NextResponse.json(
      { error: "Missing or invalid bbox params: lat1, lng1, lat2, lng2" },
      { status: 400 },
    );
  }

  // Convert WGS84 bbox corners to D-96/TM
  const sw = wgs84ToD96(Math.min(lat1, lat2), Math.min(lng1, lng2));
  const ne = wgs84ToD96(Math.max(lat1, lat2), Math.max(lng1, lng2));

  // Clamp to Slovenia D-96 extent to avoid 0-row queries when bbox covers neighboring countries
  const SLO_E_MIN = 370000, SLO_E_MAX = 620000;
  const SLO_N_MIN = 20000,  SLO_N_MAX = 200000;

  const eMin = Math.max(Math.floor(sw.e), SLO_E_MIN);
  const eMax = Math.min(Math.ceil(ne.e),  SLO_E_MAX);
  const nMin = Math.max(Math.floor(sw.n), SLO_N_MIN);
  const nMax = Math.min(Math.ceil(ne.n),  SLO_N_MAX);

  // If bbox doesn't intersect Slovenia at all, return full Slovenia sample
  const useFullSlovenia = eMin >= eMax || nMin >= nMax;

  // Determine max points based on zoom
  const maxPoints = zoom >= 13 ? 5000 : zoom >= 10 ? 3000 : 2500;

  // Query with random sampling to stay within limits
  const rows = await prisma.$queryRawUnsafe<PriceSurfaceRow[]>(
    useFullSlovenia
      ? `SELECT e, n, price_eur_m2, n_comps FROM continuous_price_surface ORDER BY random() LIMIT $1`
      : `SELECT e, n, price_eur_m2, n_comps FROM continuous_price_surface WHERE e BETWEEN $1 AND $2 AND n BETWEEN $3 AND $4 ORDER BY random() LIMIT $5`,
    ...(useFullSlovenia ? [maxPoints] : [eMin, eMax, nMin, nMax, maxPoints]),
  );

  if (rows.length === 0) {
    return NextResponse.json({ points: [], min_price: 0, max_price: 0 });
  }

  let minPrice = Infinity;
  let maxPrice = -Infinity;

  const points = rows.map((r) => {
    const price = Number(r.price_eur_m2);
    if (price < minPrice) minPrice = price;
    if (price > maxPrice) maxPrice = price;
    const { lat, lng } = convertD96ToWgs84(Number(r.e), Number(r.n));
    return {
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      price: Math.round(price),
      n_comps: Number(r.n_comps),
    };
  });

  return NextResponse.json({
    points,
    min_price: Math.round(minPrice),
    max_price: Math.round(maxPrice),
  });
}
