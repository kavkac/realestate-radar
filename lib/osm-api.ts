export interface OsmBuildingData {
  osmId?: number;
  levels?: number;
  heightM?: number;
  roofShape?: string;
  roofMaterial?: string;
  wallMaterial?: string;
  yearBuilt?: number;
  name?: string;
}

export async function fetchOsmBuildingData(
  lat: number,
  lng: number,
): Promise<OsmBuildingData | null> {
  try {
    const query = `[out:json][timeout:10];way["building"](around:30,${lat},${lng});out tags;`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const json = await res.json();
    const elements = json?.elements;
    if (!Array.isArray(elements) || elements.length === 0) return null;

    const way = elements[0];
    const tags = way.tags ?? {};

    const result: OsmBuildingData = { osmId: way.id };

    if (tags["building:levels"]) {
      const v = parseInt(tags["building:levels"], 10);
      if (!isNaN(v)) result.levels = v;
    }
    if (tags["building:height"]) {
      const v = parseFloat(tags["building:height"]);
      if (!isNaN(v)) result.heightM = v;
    }
    if (tags["roof:shape"]) result.roofShape = tags["roof:shape"];
    if (tags["roof:material"]) result.roofMaterial = tags["roof:material"];
    if (tags["wall"]) result.wallMaterial = tags["wall"];
    if (tags["building:year"]) {
      const v = parseInt(tags["building:year"], 10);
      if (!isNaN(v)) result.yearBuilt = v;
    } else if (tags["start_date"]) {
      const v = parseInt(tags["start_date"], 10);
      if (!isNaN(v)) result.yearBuilt = v;
    }
    if (tags["name"]) result.name = tags["name"];

    return result;
  } catch {
    return null;
  }
}
