#!/usr/bin/env python3
"""
Import OSM waterways for Slovenia into osm_waterways table.
Uses Overpass API to fetch rivers, streams, canals.
Stores as (e, n) centroid per way segment in D-96/TM (approx via pyproj).

Run before enrich-property-signals.py
"""

import os
import json
import math
import psycopg2
import urllib.request
import urllib.parse

DB_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway")

OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# Fetch waterways in Slovenia bounding box
# lat: 45.4 - 46.9, lon: 13.3 - 16.6
OVERPASS_QUERY = """
[out:json][timeout:180];
(
  way["waterway"~"^(river|stream|canal|drain)$"](45.4,13.3,46.9,16.6);
);
out center;
"""

def wgs84_to_d96tm(lat, lon):
    """
    Approximate WGS84 -> D-96/TM (EPSG:3794) conversion.
    Uses pyproj if available, otherwise rough approximation.
    """
    try:
        from pyproj import Transformer
        transformer = Transformer.from_crs("EPSG:4326", "EPSG:3794", always_xy=True)
        e, n = transformer.transform(lon, lat)
        return int(round(e)), int(round(n))
    except ImportError:
        # Rough approximation for Slovenia
        # D-96/TM central meridian 15°E, scale 0.9999
        # Good enough for 100m proximity checks
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        lon0_rad = math.radians(15.0)
        a = 6378137.0
        f = 1/298.257223563
        e2 = 2*f - f**2
        k0 = 0.9999
        N = a / math.sqrt(1 - e2 * math.sin(lat_rad)**2)
        T = math.tan(lat_rad)**2
        C = e2/(1-e2) * math.cos(lat_rad)**2
        A = math.cos(lat_rad) * (lon_rad - lon0_rad)
        # Meridian arc
        e4 = e2**2; e6 = e2**3
        M = a * ((1 - e2/4 - 3*e4/64 - 5*e6/256)*lat_rad
                 - (3*e2/8 + 3*e4/32 + 45*e6/1024)*math.sin(2*lat_rad)
                 + (15*e4/256 + 45*e6/1024)*math.sin(4*lat_rad)
                 - (35*e6/3072)*math.sin(6*lat_rad))
        easting = k0*N*(A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*e2/(1-e2))*A**5/120) + 500000
        northing = k0*(M + N*math.tan(lat_rad)*(A**2/2 + (5-T+9*C+4*C**2)*A**4/24
                   + (61-58*T+T**2+600*C-330*e2/(1-e2))*A**6/720))
        return int(round(easting)), int(round(northing))


def create_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS osm_waterways (
            osm_id BIGINT PRIMARY KEY,
            waterway VARCHAR(50),
            name VARCHAR(255),
            e INTEGER NOT NULL,
            n INTEGER NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS osm_waterways_en_idx ON osm_waterways (e, n)")


def fetch_overpass():
    print("🌊 Fetching waterways from Overpass API...")
    data = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode()
    last_err = None
    for url in OVERPASS_URLS:
        try:
            print(f"  trying {url}...")
            req = urllib.request.Request(url, data=data,
                                          headers={"User-Agent": "RealEstateRadar/1.0"})
            with urllib.request.urlopen(req, timeout=210) as resp:
                return json.loads(resp.read())
        except Exception as ex:
            print(f"  ✗ {ex}")
            last_err = ex
    raise last_err


def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    create_table(cur)
    conn.commit()

    result = fetch_overpass()
    elements = result.get("elements", [])
    print(f"  → {len(elements)} waterway segments fetched")

    inserted = 0
    skipped = 0
    for el in elements:
        if el.get("type") != "way":
            continue
        center = el.get("center")
        if not center:
            continue
        lat, lon = center["lat"], center["lon"]
        e, n = wgs84_to_d96tm(lat, lon)
        osm_id = el["id"]
        waterway = el.get("tags", {}).get("waterway", "")
        name = el.get("tags", {}).get("name", "")

        try:
            cur.execute("""
                INSERT INTO osm_waterways (osm_id, waterway, name, e, n)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (osm_id) DO UPDATE SET e=EXCLUDED.e, n=EXCLUDED.n
            """, (osm_id, waterway, name, e, n))
            inserted += 1
        except Exception as ex:
            skipped += 1
            print(f"  skip {osm_id}: {ex}")

        if inserted % 1000 == 0 and inserted > 0:
            conn.commit()
            print(f"  ... {inserted} inserted")

    conn.commit()
    print(f"✅ Done: {inserted} waterways imported, {skipped} skipped")
    conn.close()


if __name__ == "__main__":
    main()
