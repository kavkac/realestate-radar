export interface OsmBuildingData {
  osmId?: number;
  levels?: number;
  heightM?: number;
  roofShape?: string;       // flat, gabled, hipped, pyramidal, skillion, dome, ...
  roofHeightM?: number;     // višina slemena nad zadnjo etažo
  roofAngle?: number;       // naklon strehe v stopinjah
  roofMaterial?: string;
  wallMaterial?: string;    // brick, concrete, wood, stone, plaster, ...
  buildingType?: string;    // apartments, house, commercial, industrial, ...
  yearBuilt?: number;
  name?: string;
  // Javni promet v bližini (300m)
  busStopsCount?: number;
  trainStationsCount?: number;
  tramStopsCount?: number;
}

export async function fetchOsmBuildingData(
  lat: number,
  lng: number,
): Promise<OsmBuildingData | null> {
  try {
    // Query 1: building data (30m radius)
    // Query 2: javni promet (300m radius) — combined in one request
    const query = `[out:json][timeout:15];
(
  way["building"](around:30,${lat},${lng});
  node["highway"="bus_stop"](around:300,${lat},${lng});
  node["railway"="station"](around:300,${lat},${lng});
  node["railway"="tram_stop"](around:300,${lat},${lng});
  node["public_transport"="stop_position"](around:300,${lat},${lng});
);
out tags;`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

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

    // Building data (first way element)
    const wayEl = elements.find((e: { type: string }) => e.type === "way");
    const result: OsmBuildingData = { osmId: wayEl?.id };

    if (wayEl) {
      const tags = wayEl.tags ?? {};
      if (tags["building:levels"]) {
        const v = parseInt(tags["building:levels"], 10);
        if (!isNaN(v)) result.levels = v;
      }
      if (tags["building:height"]) {
        const v = parseFloat(tags["building:height"]);
        if (!isNaN(v)) result.heightM = v;
      }
      if (tags["roof:shape"]) result.roofShape = tags["roof:shape"];
      if (tags["roof:height"]) {
        const v = parseFloat(tags["roof:height"]);
        if (!isNaN(v)) result.roofHeightM = v;
      }
      if (tags["roof:angle"]) {
        const v = parseFloat(tags["roof:angle"]);
        if (!isNaN(v)) result.roofAngle = v;
      }
      if (tags["roof:material"]) result.roofMaterial = tags["roof:material"];
      // wall material: multiple possible tags
      result.wallMaterial = tags["building:material"] || tags["wall"] || tags["building:facade:material"] || undefined;
      // building type
      if (tags["building"] && tags["building"] !== "yes") result.buildingType = tags["building"];
      if (tags["building:year"]) {
        const v = parseInt(tags["building:year"], 10);
        if (!isNaN(v)) result.yearBuilt = v;
      } else if (tags["start_date"]) {
        const v = parseInt(tags["start_date"], 10);
        if (!isNaN(v)) result.yearBuilt = v;
      }
      if (tags["name"]) result.name = tags["name"];
    }

    // Javni promet
    const nodes = elements.filter((e: { type: string }) => e.type === "node");
    result.busStopsCount = nodes.filter((n: { tags?: Record<string, string> }) =>
      n.tags?.["highway"] === "bus_stop" || n.tags?.["public_transport"] === "stop_position"
    ).length;
    result.trainStationsCount = nodes.filter((n: { tags?: Record<string, string> }) =>
      n.tags?.["railway"] === "station"
    ).length;
    result.tramStopsCount = nodes.filter((n: { tags?: Record<string, string> }) =>
      n.tags?.["railway"] === "tram_stop"
    ).length;

    return result;
  } catch {
    return null;
  }
}
