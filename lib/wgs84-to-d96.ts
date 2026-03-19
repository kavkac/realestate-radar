/**
 * WGS84 (lat/lng) → D96/TM (EPSG:3794) koordinate
 * Slovenija: Transverse Mercator, central meridian 15°E
 */
import proj4 from "proj4";

const D96_TM = "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const WGS84 = "EPSG:4326";

export function wgs84ToD96(lat: number, lng: number): { e: number; n: number } {
  const [e, n] = proj4(WGS84, D96_TM, [lng, lat]);
  return { e, n };
}
