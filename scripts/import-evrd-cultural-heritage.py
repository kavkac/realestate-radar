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

import psycopg2, psycopg2.extras, json, time, sys, os, argparse, tempfile, zipfile
import urllib.request, urllib.parse
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import Transformer
import fiona

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

# eVRD Shapefile ZIP — OPSI odprti podatki (CC BY 4.0)
# https://podatki.gov.si/dataset/varstveni-rezimi-kulturne-dediscine-evrd
EVRD_ZIP_URL = "https://podatki.gov.si/dataset/2772d7b1-d1de-452c-bfcf-99e0df04f859/resource/b45281c4-f55e-4e11-a974-050553cd381c/download/evrd.zip"

# D96/TM → WGS84
transformer = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)

def to_wgs84(geom_dict):
    """Convert a GeoJSON geometry from D96/TM (EPSG:3794) to WGS84."""
    geom = shape(geom_dict)
    wgs = transform(transformer.transform, geom)
    return mapping(wgs)

def download_and_extract_zip(url, dest_dir):
    print(f"Downloading eVRD ZIP from OPSI...")
    zip_path = os.path.join(dest_dir, "evrd.zip")
    urllib.request.urlretrieve(url, zip_path)
    print(f"  Downloaded {os.path.getsize(zip_path)//1024} KB")
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(dest_dir)
    shp_files = []
    for root, dirs, files in os.walk(dest_dir):
        for f in files:
            if f.endswith(".shp"):
                shp_files.append(os.path.join(root, f))
    print(f"  Found shapefiles: {[os.path.basename(s) for s in shp_files]}")
    return shp_files

def ensure_table(cur):
    # No PostGIS — store geometry as JSONB (same pattern as kn_namenske_rabe, arso_noise_ldvn)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cultural_heritage_zones (
            id              SERIAL PRIMARY KEY,
            esd_id          TEXT,
            ime             TEXT,
            tip             TEXT NOT NULL,
            tip_enote       TEXT,
            status          TEXT,
            zvrst           TEXT,
            geom            JSONB NOT NULL,
            imported_at     TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chz_tip ON cultural_heritage_zones(tip);
        CREATE INDEX IF NOT EXISTS idx_chz_esd_id ON cultural_heritage_zones(esd_id);
    """)
    print("Table cultural_heritage_zones ready")

def import_shapefile(conn, shp_path, dry_run=False):
    filename = os.path.basename(shp_path)
    print(f"\n--- Importing: {filename} ---")

    # Guess tip from filename
    fname_lower = filename.lower()
    if "drz" in fname_lower or "drzavni" in fname_lower:
        tip = "spomenik_drzavni"
    elif "lok" in fname_lower or "lokalni" in fname_lower:
        tip = "spomenik_lokalni"
    elif "vplivn" in fname_lower:
        tip = "vplivno_obmocje"
    elif "varstveni" in fname_lower or "obmocj" in fname_lower:
        tip = "varstveno_obmocje"
    else:
        tip = "neznano"

    total = 0
    skipped = 0

    with fiona.open(shp_path) as src:
        crs = src.crs
        print(f"  CRS: {crs}, features: {len(src)}")

        # Set up transformer if needed
        needs_transform = crs and ("3794" in str(crs) or "MGI" in str(crs) or "D96" in str(crs))

        rows = []
        for feat in src:
            try:
                geom = shape(feat["geometry"])
                if needs_transform:
                    geom = transform(transformer.transform, geom)
                geom_json = json.dumps(mapping(geom))

                attrs = feat.get("properties", {}) or {}
                rows.append((
                    str(attrs.get("ESD_ID") or attrs.get("esd_id") or ""),
                    str(attrs.get("IME") or attrs.get("ime") or attrs.get("NAZIV") or ""),
                    tip,
                    str(attrs.get("TIP_ENOTE") or ""),
                    str(attrs.get("STATUS") or ""),
                    str(attrs.get("ZVRST_TEXT") or attrs.get("ZVRST") or ""),
                    geom_json,
                ))
            except Exception as e:
                skipped += 1
                continue

        if rows and not dry_run:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO cultural_heritage_zones
                        (esd_id, ime, tip, tip_enote, status, zvrst, geom)
                    VALUES %s
                    ON CONFLICT DO NOTHING
                """, [
                    (r[0], r[1], r[2], r[3], r[4], r[5], psycopg2.extras.Json(json.loads(r[6])))
                    for r in rows
                ])
                conn.commit()
        total = len(rows)
        print(f"  imported={total}, skipped_geom={skipped}")
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

    with tempfile.TemporaryDirectory() as tmp:
        shp_files = download_and_extract_zip(EVRD_ZIP_URL, tmp)
        if not shp_files:
            print("ERROR: no shapefiles found in ZIP")
            sys.exit(1)

        grand_total = 0
        for shp in shp_files:
            n = import_shapefile(conn, shp, dry_run=args.dry_run)
            grand_total += n

    print(f"\n✅ eVRD import complete: {grand_total} total records")
    conn.close()

if __name__ == "__main__":
    main()
