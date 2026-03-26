#!/usr/bin/env python3
"""
Import OSM waterways + water bodies for Slovenia from Geofabrik PBF.
Extracts: waterway lines (river, stream, canal, drain) + natural=water areas.
Stores centroid per feature as (e, n) in D-96/TM.

Usage: python import-osm-waterways-pbf.py [--pbf path/to/slovenia.osm.pbf]
       If --pbf not given, downloads from Geofabrik automatically.
"""

import os, sys, math, json, tempfile, urllib.request, argparse
import osmium
import psycopg2

DB_URL = os.environ.get("DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway")

GEOFABRIK_URL = "https://download.geofabrik.de/europe/slovenia-latest.osm.pbf"

# D-96/TM projection params (EPSG:3794)
D96_LON0 = math.radians(15.0)
D96_K0   = 0.9999
D96_E0   = 500000
D96_N0   = -5000000
GRS80_A  = 6378137.0
GRS80_F  = 1/298.257222101
GRS80_E2 = 2*GRS80_F - GRS80_F**2

def wgs84_to_d96(lat_deg, lon_deg):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    e2 = GRS80_E2
    a  = GRS80_A
    k0 = D96_K0
    lon0 = D96_LON0
    N = a / math.sqrt(1 - e2*math.sin(lat)**2)
    T = math.tan(lat)**2
    C = e2/(1-e2)*math.cos(lat)**2
    A_ = math.cos(lat)*(lon-lon0)
    e4=e2**2; e6=e2**3
    M = a*((1-e2/4-3*e4/64-5*e6/256)*lat
           -(3*e2/8+3*e4/32+45*e6/1024)*math.sin(2*lat)
           +(15*e4/256+45*e6/1024)*math.sin(4*lat)
           -(35*e6/3072)*math.sin(6*lat))
    easting  = k0*N*(A_+(1-T+C)*A_**3/6+(5-18*T+T**2+72*C)*A_**5/120) + D96_E0
    northing = k0*(M + N*math.tan(lat)*(A_**2/2+(5-T+9*C+4*C**2)*A_**4/24
               +(61-58*T+T**2+600*C)*A_**6/720)) - D96_N0
    return int(round(easting)), int(round(northing))


class WaterwayHandler(osmium.SimpleHandler):
    WATERWAY_TYPES = {"river", "stream", "canal", "drain"}

    def __init__(self):
        super().__init__()
        self.features = []  # (osm_id, feature_type, name, e, n)

    def way(self, w):
        tags = w.tags
        wtype = tags.get("waterway", "")
        natural = tags.get("natural", "")
        name = tags.get("name", "") or ""

        is_waterway = wtype in self.WATERWAY_TYPES
        is_water = natural == "water" or tags.get("landuse") == "reservoir"

        if not (is_waterway or is_water):
            return

        # Compute centroid from nodes
        lats, lons = [], []
        try:
            for n in w.nodes:
                if n.location.valid():
                    lats.append(n.location.lat)
                    lons.append(n.location.lon)
        except Exception:
            return

        if not lats:
            return

        lat = sum(lats) / len(lats)
        lon = sum(lons) / len(lons)
        try:
            e, n = wgs84_to_d96(lat, lon)
        except Exception:
            return

        ftype = wtype if is_waterway else "water_body"
        self.features.append((w.id, ftype, name, e, n))

        if len(self.features) % 5000 == 0:
            print(f"  ... {len(self.features)} features parsed")

    def relation(self, r):
        tags = r.tags
        if tags.get("natural") != "water" and tags.get("type") != "waterway":
            return
        # Relations: use center if available (won't have node locations here easily)
        # Skip for now — ways cover most water bodies


def create_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS osm_waterways (
            osm_id    BIGINT PRIMARY KEY,
            waterway  VARCHAR(50),
            name      VARCHAR(255),
            e         INTEGER NOT NULL,
            n         INTEGER NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS osm_waterways_en_idx ON osm_waterways (e, n)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", default=None, help="Path to .osm.pbf file")
    args = parser.parse_args()

    pbf_path = args.pbf
    if not pbf_path:
        tmp = tempfile.mktemp(suffix=".osm.pbf")
        print(f"📥 Downloading SLO PBF from Geofabrik → {tmp}")
        def progress(count, block, total):
            if total > 0:
                pct = count*block/total*100
                print(f"\r  {pct:.0f}%", end="", flush=True)
        urllib.request.urlretrieve(GEOFABRIK_URL, tmp, reporthook=progress)
        print()
        pbf_path = tmp
        downloaded = True
    else:
        downloaded = False

    print(f"🔍 Parsing waterways from {pbf_path}...")
    h = WaterwayHandler()
    h.apply_file(pbf_path, locations=True)
    print(f"  → {len(h.features)} water features found")

    if downloaded:
        os.unlink(pbf_path)
        print("  (temp file deleted)")

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    create_table(cur)
    conn.commit()

    inserted = 0
    for osm_id, wtype, name, e, n in h.features:
        cur.execute("""
            INSERT INTO osm_waterways (osm_id, waterway, name, e, n)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (osm_id) DO UPDATE SET waterway=EXCLUDED.waterway, name=EXCLUDED.name, e=EXCLUDED.e, n=EXCLUDED.n
        """, (osm_id, wtype, name, e, n))
        inserted += 1
        if inserted % 5000 == 0:
            conn.commit()
            print(f"  ... {inserted} upserted")

    conn.commit()
    print(f"✅ Done: {inserted} water features in osm_waterways")
    conn.close()


if __name__ == "__main__":
    main()
