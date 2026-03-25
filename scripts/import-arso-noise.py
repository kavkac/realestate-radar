#!/usr/bin/env python3
"""
import-arso-noise.py

Bulk download ARSO hrupnih con iz ArcGIS REST API → Railway PostGIS.

Layerji (Atlasokolja_intranet_D96 MapServer):
  551 - MOL ceste LDVN 2020
  553 - MOL železnice LDVN 2020
  555 - MOM ceste LDVN 2020
  557 - MOM železnice LDVN 2020
  559 - SI ceste LDVN DARS 2020
  561 - SI ceste LDVN DRSI 2020
  563 - SI železnice LDVN 2020
  565 - MOL industrija LDVN 2012
  567 - MOM industrija LDVN 2012

Rezultat: tabela arso_noise_ldvn s PostGIS geometrijo (EPSG:4326)
fetchNoiseLden() nato dela ST_Contains lokalni query namesto ARSO API klica.

Pogon:
  python3 scripts/import-arso-noise.py
  python3 scripts/import-arso-noise.py --layers 551,553 --dry-run
"""

import argparse
import json
import os
import sys
import time

import psycopg2
import psycopg2.extras
import requests

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

BASE_URL = "https://gis.arso.gov.si/arcgis/rest/services/Atlasokolja_javni_D96_test/MapServer"

# LDVN layerji — javni endpoint (Layer 344 = original iz Python skripte)
DEFAULT_LAYERS = {
    344: "MOL_ceste_LDVN_2020",
    346: "MOL_zelez_LDVN_2020",
    348: "MOM_ceste_LDVN_2020",
    350: "MOM_zelez_LDVN_2020",
    352: "SI_ceste_LDVN_DRSI_2020",
    354: "SI_zelez_LDVN_2020",
    358: "SI_ceste_LDVN_DARS_2020",
    54:  "MOL_ippc_LDVN_2012",
    60:  "MOM_ippc_LDVN_2012",
}

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS arso_noise_ldvn (
    id              SERIAL PRIMARY KEY,
    layer_id        INTEGER NOT NULL,
    layer_name      TEXT NOT NULL,
    lden            NUMERIC(5,1),
    noise_class     TEXT,
    source_type     TEXT,
    bbox_xmin       DOUBLE PRECISION,
    bbox_ymin       DOUBLE PRECISION,
    bbox_xmax       DOUBLE PRECISION,
    bbox_ymax       DOUBLE PRECISION,
    geom_geojson    JSONB NOT NULL,
    raw_properties  JSONB,
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arso_noise_ldvn_layer
    ON arso_noise_ldvn (layer_id);

CREATE INDEX IF NOT EXISTS idx_arso_noise_ldvn_bbox
    ON arso_noise_ldvn (bbox_xmin, bbox_xmax, bbox_ymin, bbox_ymax);

CREATE INDEX IF NOT EXISTS idx_arso_noise_ldvn_lden
    ON arso_noise_ldvn (lden);
"""


def fetch_layer(layer_id: int, layer_name: str, page_size: int = 1000) -> list[dict]:
    """Fetch all features from an ArcGIS REST layer with pagination."""
    features = []
    offset = 0

    while True:
        params = {
            "where": "1=1",
            "outFields": "*",
            "f": "geojson",
            "resultRecordCount": page_size,
            "resultOffset": offset,
            "outSR": "4326",  # WGS84 direktno
        }

        try:
            r = requests.get(
                f"{BASE_URL}/{layer_id}/query",
                params=params,
                timeout=30,
                headers={"User-Agent": "RealEstateRadar/1.0"},
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  ERROR fetching layer {layer_id} offset={offset}: {e}")
            break

        batch = data.get("features", [])
        features.extend(batch)
        print(f"  [{layer_name}] offset={offset}: {len(batch)} features (total {len(features)})")

        if len(batch) < page_size:
            break

        offset += page_size
        time.sleep(0.2)

    return features


def parse_ldvn_range(props: dict) -> tuple[float | None, float | None, str | None]:
    """Iz properties izvleci LDVN min/max in noise_class."""
    # ARSO layerji imajo različna polja — probaj vse variante
    # ARSO javni endpoint ima LDEN + HRUP_RAZRED polja
    for key in ["LDEN", "LDVN", "HRUP_RAZRED"] + list(props.keys()):
        k = key.upper()
        if k not in [pk.upper() for pk in props]:
            continue
        if "LDVN" in k or "LDEN" in k or "RAZRED" in k or "CLASS" in k or "VALUE" in k:
            val = props[key]
            if val is None:
                continue
            val_str = str(val).strip()

            # Format "55-60" ali "55 - 60"
            if "-" in val_str:
                parts = val_str.replace(" ", "").split("-")
                try:
                    return float(parts[0]), float(parts[1]), val_str
                except (ValueError, IndexError):
                    pass

            # Format ">75" ali ">=75"
            if val_str.startswith(">"):
                try:
                    v = float(val_str.replace(">", "").replace("=", ""))
                    return v, None, val_str
                except ValueError:
                    pass

            # Numeric value
            try:
                v = float(val_str)
                return v, v, val_str
            except ValueError:
                pass

    return None, None, None


def infer_source_type(layer_name: str) -> str:
    n = layer_name.lower()
    if "zelez" in n:
        return "zelez"
    if "ippc" in n:
        return "ippc"
    return "ceste"


def compute_bbox(geom: dict) -> tuple[float, float, float, float]:
    """Compute bounding box from GeoJSON geometry."""
    coords = []

    def extract_coords(obj):
        if isinstance(obj, list):
            if obj and isinstance(obj[0], (int, float)):
                coords.append(obj)
            else:
                for item in obj:
                    extract_coords(item)

    extract_coords(geom.get("coordinates", []))
    if not coords:
        return 0, 0, 0, 0
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return min(xs), min(ys), max(xs), max(ys)


def upsert_features(conn, layer_id: int, layer_name: str, features: list[dict], dry_run: bool = False) -> int:
    if not features:
        return 0

    source_type = infer_source_type(layer_name)
    rows = []

    for f in features:
        props = f.get("properties") or {}
        geom = f.get("geometry")
        if not geom:
            continue

        _, _, noise_class = parse_ldvn_range(props)
        lden = props.get("LDEN") or props.get("LDVN")
        try:
            lden = float(lden) if lden is not None else None
        except (ValueError, TypeError):
            lden = None

        bbox = compute_bbox(geom)

        rows.append((
            layer_id,
            layer_name,
            lden,
            noise_class or props.get("HRUP_RAZRED"),
            source_type,
            bbox[0], bbox[1], bbox[2], bbox[3],
            json.dumps(geom),
            json.dumps(props),
        ))

    if dry_run:
        print(f"  [DRY RUN] Would insert {len(rows)} rows for layer {layer_id}")
        return len(rows)

    cur = conn.cursor()
    cur.execute("DELETE FROM arso_noise_ldvn WHERE layer_id = %s", (layer_id,))

    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO arso_noise_ldvn
            (layer_id, layer_name, lden, noise_class, source_type,
             bbox_xmin, bbox_ymin, bbox_xmax, bbox_ymax,
             geom_geojson, raw_properties)
        VALUES %s
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description="Import ARSO noise polygons into Railway PostGIS")
    parser.add_argument("--layers", type=str, help="Comma-separated layer IDs (default: all LDVN layers)")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    parser.add_argument("--page-size", type=int, default=1000)
    args = parser.parse_args()

    # Resolve layers
    if args.layers:
        layer_ids = {int(x): DEFAULT_LAYERS.get(int(x), f"layer_{x}") for x in args.layers.split(",")}
    else:
        layer_ids = DEFAULT_LAYERS

    conn = None
    if not args.dry_run:
        conn = psycopg2.connect(DB_URL)
        print("DB connected. Creating table if needed...")
        cur = conn.cursor()
        cur.execute(CREATE_TABLE_SQL)
        conn.commit()

    total_inserted = 0

    for layer_id, layer_name in layer_ids.items():
        print(f"\n📥 Fetching layer {layer_id}: {layer_name}")
        features = fetch_layer(layer_id, layer_name, page_size=args.page_size)
        print(f"  Total features: {len(features)}")

        if conn or args.dry_run:
            inserted = upsert_features(conn, layer_id, layer_name, features, dry_run=args.dry_run)
            print(f"  ✅ {inserted} rows inserted")
            total_inserted += inserted

    if conn:
        # Final stats
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT layer_id) FROM arso_noise_ldvn")
        total, layers = cur.fetchone()
        print(f"\n✅ Import done: {total_inserted} features imported")
        print(f"   DB total: {total} rows across {layers} layers")
        conn.close()
    else:
        print(f"\n✅ Dry run done: {total_inserted} features would be imported")


if __name__ == "__main__":
    main()
