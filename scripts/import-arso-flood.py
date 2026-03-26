#!/usr/bin/env python3
"""
Import ARSO flood zone data into arso_flood_zones table.
Source: ARSO WFS - poplavna nevarnost (flood hazard areas for Slovenia)
Stores polygon centroids + flood class per feature as (e, n) D-96/TM.

Flood classes: visoka (high), srednja (medium), nizka (low) nevarnost
"""

import os, sys, json, math, urllib.request, urllib.parse
import psycopg2

DB_URL = os.environ.get("DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway")

# ARSO WFS endpoint for flood hazard
# Source: https://gis.arso.gov.si/wfs
WFS_URLS = [
    # Poplavna nevarnost - 100 year return period areas
    "https://gis.arso.gov.si/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
    "&TYPENAMES=arso:PV_POPLAVNA_NEVARNOST&OUTPUTFORMAT=application/json"
    "&SRSNAME=EPSG:3794&COUNT=10000",
]

# Alternative: use direct GeoJSON from ARSO open data
ARSO_OPEN_DATA_URLS = [
    "https://podatki.gov.si/api/3/action/datastore_search?resource_id=poplavna-nevarnost",
]


def create_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS arso_flood_zones (
            id          SERIAL PRIMARY KEY,
            source_id   TEXT,
            flood_class VARCHAR(20),  -- 'high', 'medium', 'low'
            return_period_yr INTEGER, -- e.g. 10, 100, 500
            e           INTEGER NOT NULL,
            n           INTEGER NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS arso_flood_en_idx ON arso_flood_zones (e, n)")


def fetch_wfs():
    """Try to fetch flood zones from ARSO WFS."""
    for url in WFS_URLS:
        try:
            print(f"  trying {url[:80]}...")
            req = urllib.request.Request(url, headers={"User-Agent": "RealEstateRadar/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                features = data.get("features", [])
                if features:
                    print(f"  → {len(features)} features")
                    return features
        except Exception as ex:
            print(f"  ✗ {ex}")
    return []


def centroid_from_geometry(geom):
    """Extract centroid (e, n) from GeoJSON geometry (already in EPSG:3794)."""
    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])

    def flatten(c, depth=0):
        if depth == 0 and isinstance(c[0], (int, float)):
            return [c]
        result = []
        for item in c:
            result.extend(flatten(item, depth-1 if depth > 0 else 0))
        return result

    try:
        if gtype == "Point":
            return int(coords[0]), int(coords[1])
        elif gtype in ("Polygon", "MultiPolygon"):
            # Flatten all coordinate pairs
            all_pts = []
            def get_pts(c):
                if isinstance(c[0], (int, float)):
                    all_pts.append(c)
                else:
                    for item in c:
                        get_pts(item)
            get_pts(coords)
            if all_pts:
                e = int(sum(p[0] for p in all_pts) / len(all_pts))
                n = int(sum(p[1] for p in all_pts) / len(all_pts))
                return e, n
    except Exception:
        pass
    return None, None


def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    create_table(cur)
    conn.commit()

    print("🌊 Fetching ARSO flood zones...")
    features = fetch_wfs()

    if not features:
        print("⚠️  No features from WFS. Trying alternative approach...")
        # Try INSPIRE flood hazard directive data
        alt_url = ("https://storitve.arso.gov.si/wfs/ows?SERVICE=WFS&VERSION=1.1.0"
                   "&REQUEST=GetFeature&TYPENAME=arso:FH_FloodHazardArea"
                   "&OUTPUTFORMAT=json&MAXFEATURES=50000")
        try:
            req = urllib.request.Request(alt_url, headers={"User-Agent": "RealEstateRadar/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                features = data.get("features", [])
                print(f"  → {len(features)} features from INSPIRE endpoint")
        except Exception as ex:
            print(f"  ✗ {ex}")

    if not features:
        print("❌ Could not fetch flood zones from ARSO. Manual download needed.")
        print("   Download from: https://gis.arso.gov.si/ → Poplavna nevarnost")
        conn.close()
        sys.exit(1)

    inserted = 0
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry")
        if not geom:
            continue

        e, n = centroid_from_geometry(geom)
        if e is None:
            continue

        source_id = str(f.get("id", ""))
        # Map flood class from properties
        raw_class = (props.get("RAZRED_NEVARNOSTI") or
                     props.get("hazardCategory") or
                     props.get("flood_class") or "").lower()
        if "visok" in raw_class or "high" in raw_class or "1" in raw_class:
            flood_class = "high"
        elif "sredn" in raw_class or "medium" in raw_class or "2" in raw_class:
            flood_class = "medium"
        else:
            flood_class = "low"

        return_period = props.get("POVRATNA_DOBA") or props.get("returnPeriod")
        try:
            return_period = int(return_period) if return_period else None
        except Exception:
            return_period = None

        cur.execute("""
            INSERT INTO arso_flood_zones (source_id, flood_class, return_period_yr, e, n)
            VALUES (%s, %s, %s, %s, %s)
        """, (source_id, flood_class, return_period, e, n))
        inserted += 1
        if inserted % 1000 == 0:
            conn.commit()
            print(f"  ... {inserted} inserted")

    conn.commit()
    print(f"✅ Done: {inserted} flood zone features imported")
    conn.close()


if __name__ == "__main__":
    main()
