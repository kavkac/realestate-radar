/**
 * Mapillary API client
 * Fetches street-level imagery near a location.
 * API key: free registration at mapillary.com/developer
 * License: CC-BY-SA — commercial ML use allowed
 */

export interface MapillaryImage {
  id: string;
  lat: number;
  lng: number;
  compassAngle: number; // 0-360, camera heading
  thumbUrl: string;     // 1024px thumbnail
  capturedAt?: string;
}

/**
 * Fetch Mapillary images near a coordinate.
 * Returns images sorted by distance, filtered to unique compass sectors.
 */
export async function fetchNearbyImages(
  lat: number,
  lng: number,
  radiusM: number = 20,
  maxImages: number = 6,
): Promise<MapillaryImage[]> {
  const token = process.env.MAPILLARY_ACCESS_TOKEN;
  if (!token) {
    console.warn("[mapillary] MAPILLARY_ACCESS_TOKEN not set — skipping");
    return [];
  }

  // Approx bbox from radius in meters
  const latDelta = radiusM / 111320;
  const lngDelta = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta].join(",");

  const url = new URL("https://graph.mapillary.com/images");
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,geometry,thumb_1024_url,compass_angle,captured_at");
  url.searchParams.set("bbox", bbox);
  url.searchParams.set("limit", "50");
  url.searchParams.set("is_pano", "false"); // skip 360 panoramas

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`[mapillary] API error ${res.status}`);
      return [];
    }
    const json = await res.json();
    const data: Array<{
      id: string;
      geometry: { coordinates: [number, number] };
      thumb_1024_url: string;
      compass_angle: number;
      captured_at: string;
    }> = json.data ?? [];

    if (!data.length) return [];

    // Sort by recency (newest first), then deduplicate by compass sector (45° bins)
    const sorted = data.sort((a, b) =>
      new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    );

    const seenSectors = new Set<number>();
    const result: MapillaryImage[] = [];

    for (const img of sorted) {
      const sector = Math.floor((img.compass_angle ?? 0) / 45);
      if (seenSectors.has(sector)) continue;
      seenSectors.add(sector);

      result.push({
        id: img.id,
        lat: img.geometry.coordinates[1],
        lng: img.geometry.coordinates[0],
        compassAngle: img.compass_angle ?? 0,
        thumbUrl: img.thumb_1024_url,
        capturedAt: img.captured_at,
      });

      if (result.length >= maxImages) break;
    }

    return result;
  } catch (e) {
    console.error("[mapillary] fetch error", e);
    return [];
  }
}
