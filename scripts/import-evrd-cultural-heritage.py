#!/usr/bin/env python3
"""
import-evrd-cultural-heritage.py

Bulk import eVRD (Varstveni režimi kulturne dediščine) iz MK ArcGIS REST API
→ tabela cultural_heritage_zones

Vir: https://data-mk-indok.opendata.arcgis.com/
Licenca: Brez omejitev (javni podatki MK)

Podatki:
  - Kulturni spomeniki (državnega + lokalnega pomena)
  - Varstvena območja kulturne dediščine
  - Vplivna območja

Pogon:
  python3 scripts/import-evrd-cultural-heritage.py
  python3 scripts/import-evrd-cultural-heritage.py --dry-run

Odvisnosti:
  pip install psycopg2-binary shapely pyproj requests
"""

import psycopg2, psycopg2.extras, json, time, sys, os, argparse
import urllib.request, urllib.parse
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import Transformer

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

# MK ArcGIS REST API — eVRD layers
# Odkrito via: https://data-mk-indok.opendata.arcgis.com/
MK_BASE = "https://gisportal.gov.si/arcgis/rest/services/KD/eVRD_varstveni_rezimi/MapServer"

LAYERS = [
    { "id": 0, "naziv": "Kulturni spomeniki državnega pomena", "tip": "spomenik_drzavni" },
    { "id": 1, "naziv": "Kulturni spomeniki lokalnega pomena",  "tip": "spomenik_lokalni" },
    { "id": 2, "naziv": "Varstvena območja kulturne dediščine", "tip": "varstveno_obmocje" },
    { "id": 3, "naziv": "Vplivna območja kulturne dediščine",   "tip": "vplivno_obmocje" },
]

# D96/TM → WGS84
transformer = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)

def to_wgs84(geom_dict):
    """Convert a GeoJSON geometry from D96/TM (EPSG:3794) to WGS84."""
    geom = shape(geom_dict)
    wgs = transform(transformer.transform, geom)
    return mapping(wgs)

def fetch_layer_page(layer_id, offset=0, batch=500):
    params = {
        "where": "1=1",
        "outFields": "ESD_ID,IME,TIP_ENOTE,STATUS,ZVRST_TEXT",
        "returnGeometry": "true",
        "outSR": "3794",
        "resultOffset": str(offset),
        "resultRecordCount": str(batch),
        "f": "json",
    }
    url = f"{MK_BASE}/{layer_id}/query?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  WARN fetch layer {layer_id} offset {offset}: {e}")
        return None

def ensure_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cultural_heritage_zones (
            id              SERIAL PRIMARY KEY,
            esd_id          TEXT,
            ime             TEXT,
            tip             TEXT NOT NULL,        -- tip iz LAYERS
            tip_enote       TEXT,                 -- TIP_ENOTE iz vira
            status          TEXT,
            zvrst           TEXT,                 -- ZVRST_TEXT
            geometry        GEOMETRY(Geometry, 4326) NOT NULL,
            imported_at     TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chz_geometry
            ON cultural_heritage_zones USING GIST(geometry);
        CREATE INDEX IF NOT EXISTS idx_chz_tip
            ON cultural_heritage_zones(tip);
        CREATE INDEX IF NOT EXISTS idx_chz_esd_id
            ON cultural_heritage_zones(esd_id);
    """)
    print("Table cultural_heritage_zones ready")

def import_layer(conn, layer, dry_run=False):
    layer_id = layer["id"]
    tip = layer["tip"]
    naziv = layer["naziv"]
    print(f"\n--- Layer {layer_id}: {naziv} ---")

    offset = 0
    batch = 500
    total = 0
    skipped = 0

    with conn.cursor() as cur:
        while True:
            data = fetch_layer_page(layer_id, offset, batch)
            if data is None:
                print(f"  ERROR: failed to fetch, stopping layer")
                break

            features = data.get("features", [])
            if not features:
                print(f"  No more features at offset {offset}")
                break

            rows = []
            for feat in features:
                attrs = feat.get("attributes", {})
                geom_raw = feat.get("geometry")
                if not geom_raw:
                    skipped += 1
                    continue

                # Build GeoJSON geometry from ArcGIS format
                try:
                    if "rings" in geom_raw:
                        geom_dict = {"type": "Polygon", "coordinates": geom_raw["rings"]}
                    elif "paths" in geom_raw:
                        geom_dict = {"type": "MultiLineString", "coordinates": geom_raw["paths"]}
                    elif "points" in geom_raw:
                        geom_dict = {"type": "MultiPoint", "coordinates": geom_raw["points"]}
                    else:
                        skipped += 1
                        continue

                    geom_wgs84 = to_wgs84(geom_dict)
                    geom_json = json.dumps(geom_wgs84)
                except Exception as e:
                    skipped += 1
                    continue

                rows.append((
                    str(attrs.get("ESD_ID") or ""),
                    str(attrs.get("IME") or ""),
                    tip,
                    str(attrs.get("TIP_ENOTE") or ""),
                    str(attrs.get("STATUS") or ""),
                    str(attrs.get("ZVRST_TEXT") or ""),
                    geom_json,
                ))

            if rows and not dry_run:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO cultural_heritage_zones
                        (esd_id, ime, tip, tip_enote, status, zvrst, geometry)
                    VALUES %s
                    ON CONFLICT DO NOTHING
                """, [
                    (r[0], r[1], r[2], r[3], r[4], r[5],
                     psycopg2.extras.Json(json.loads(r[6])) if False else
                     f"ST_SetSRID(ST_GeomFromGeoJSON('{r[6]}'), 4326)")
                    for r in rows
                ], template="(%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))")
                conn.commit()

            total += len(rows)
            print(f"  offset={offset}, fetched={len(features)}, imported={len(rows)}, skipped_geom={skipped}")

            if len(features) < batch:
                break

            offset += batch
            time.sleep(0.2)  # be polite to the API

    print(f"  Layer {layer_id} done: {total} records")
    return total

def main():
    parser = argparse.ArgumentParser(description="Import eVRD cultural heritage zones")
    parser.add_argument("--dry-run", action="store_true", help="Fetch but don't write to DB")
    parser.add_argument("--layer", type=int, help="Import only this layer ID (0-3)")
    args = parser.parse_args()

    print(f"eVRD import — {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"DB: {DB_URL[:50]}...")

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False

    with conn.cursor() as cur:
        ensure_table(cur)
        conn.commit()

    grand_total = 0
    for layer in LAYERS:
        if args.layer is not None and layer["id"] != args.layer:
            continue
        n = import_layer(conn, layer, dry_run=args.dry_run)
        grand_total += n

    print(f"\n✅ eVRD import complete: {grand_total} total records")
    conn.close()

if __name__ == "__main__":
    main()
