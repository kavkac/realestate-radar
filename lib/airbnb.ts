import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface AirbnbStats {
  avgPriceNight: number;
  medianPriceNight: number;
  avgOccupancyPct: number; // rough: reviews_per_month * 3 / 30 * 100
  nListings: number;
  radiusM: number;
}

/**
 * Get Airbnb short-term rental statistics for a location.
 * Uses a Haversine bbox approximation for spatial filtering.
 *
 * @param lat Latitude
 * @param lng Longitude
 * @param radiusM Search radius in meters (default 500m)
 * @returns AirbnbStats or null if fewer than 3 listings nearby
 */
export async function getAirbnbStats(
  lat: number,
  lng: number,
  radiusM = 500
): Promise<AirbnbStats | null> {
  // Haversine bbox approximation (same pattern as lpp-lines.ts)
  const latDelta = radiusM / 111320;
  const lngDelta = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));

  const result = await pool.query<{
    price_night: number;
    reviews_per_month: number;
    availability_365: number;
  }>(
    `SELECT price_night, reviews_per_month, availability_365
     FROM airbnb_listings
     WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
       AND price_night > 0 AND price_night < 1000`,
    [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]
  );

  if (result.rows.length < 3) return null;

  const prices = result.rows.map((r) => r.price_night).sort((a, b) => a - b);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const medianPrice = prices[Math.floor(prices.length / 2)];

  // Occupancy estimate: reviews_per_month * 3 guests per review / 30 days * 100%
  // Capped at 95% as a reasonable maximum
  const occupancies = result.rows.map((r) =>
    Math.min((r.reviews_per_month || 0) * 3 / 30 * 100, 95)
  );
  const avgOccupancy = occupancies.reduce((a, b) => a + b, 0) / occupancies.length;

  return {
    avgPriceNight: Math.round(avgPrice),
    medianPriceNight: Math.round(medianPrice),
    avgOccupancyPct: Math.round(avgOccupancy),
    nListings: result.rows.length,
    radiusM,
  };
}
