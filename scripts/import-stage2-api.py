#!/usr/bin/env python3
"""
import-stage2-api.py

Direkten import SURS STAGE II podatkov iz gis.stat.si API v DB.
Ne rabiš ZIP datotek — API vrne vse podatke direktno.

Spremenljivke (500m mreža 2024/2025):
  var_values_id=33787  → povprečna starost (Mreža 500m)
  var_values_id=?      → edct izobrazba (poi iskati)
  + občine: plače

Pogon:
  python3 scripts/import-stage2-api.py
"""

import os, sys, time, math
import urllib.request, json
import psycopg2, psycopg2.extras

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

BASE = "https://gis.stat.si/admin/s2c"
COOKIES = "cookieconsent_status=dismiss"
NULL_VAL = -1000001

# D96/TM (EPSG:3794) → WGS84 for SLO
def d96tm_to_wgs84(easting: float, northing: float):
    try:
        from pyproj import Transformer
        t = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)
        lng, lat = t.transform(easting, northing)
        return lat, lng
    except ImportError:
        lat = (northing - 5420000) / 111195 + 46.0
        lng = (easting - 500000) / (111195 * math.cos(math.radians(46.0))) + 15.0
        return lat, lng

def parse_sihm500(cell_id: str):
    """SIHM500_{X}_{Y} → center (lat, lng) in WGS84.

    Format confirmed: X = D96/TM_easting / 100 (floor of lower bound)
                      Y = D96/TM_northing / 100 (floor of lower bound)
    Cell center = (X*100 + 250, Y*100 + 250) in D96/TM (EPSG:3794).
    Verified with WMS GetFeatureInfo: SIHM500_4550_1305 → lat=46.315, lng=14.419.
    """
    try:
        parts = cell_id.replace("SIHM500_", "").split("_")
        if len(parts) < 2:
            return None
        x = int(parts[0])  # easting index
        y = int(parts[1])  # northing index
        easting  = x * 100 + 250   # cell center in D96/TM
        northing = y * 100 + 250
        lat, lng = d96tm_to_wgs84(easting, northing)
        if 45.3 < lat < 47.0 and 13.0 < lng < 16.8:
            return lat, lng
        return None
    except Exception:
        return None

def fetch_varval(var_values_id: int) -> dict | None:
    url = f"{BASE}/varval?prop=1&var_values_id={var_values_id}&lang=sl"
    req = urllib.request.Request(url, headers={"Cookie": COOKIES, "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:
        print(f"  Fetch error: {e}")
        return None

def fetch_varspat(var_tree_id: int) -> list:
    url = f"{BASE}/varspat?lang=sl&var_tree_id={var_tree_id}&unpublished=false"
    req = urllib.request.Request(url, headers={"Cookie": COOKIES, "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.load(r)
            return d.get("result", [])
    except:
        return []

def ensure_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS grid_demographics (
          cell_id         text PRIMARY KEY,
          lat             float,
          lng             float,
          age_avg         float,
          edct_1          float,
          edct_2          float,
          edct_3          float,
          pop_total       float,
          year            int DEFAULT 2024,
          imported_at     timestamptz DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS grid_demo_lat_lng ON grid_demographics(lat, lng);

        CREATE TABLE IF NOT EXISTS municipality_demographics (
          obcina_id       text PRIMARY KEY,
          obcina_naziv    text,
          ern_net         float,
          ern_gros        float,
          ind_ernet       float,
          ind_erngr       float,
          pop_total       float,
          age_avg         float,
          edct_1          float,
          edct_2          float,
          edct_3          float,
          year            int DEFAULT 2024,
          imported_at     timestamptz DEFAULT NOW()
        );
    """)
    conn.commit()
    print("Tables ready")

def import_grid_var(conn, var_values_id: int, column: str, label: str):
    print(f"\n📊 Importing {label} (var_values_id={var_values_id}, column={column})...")
    d = fetch_varval(var_values_id)
    if not d:
        print("  Failed to fetch")
        return 0

    codes = d.get("codes", [])
    data = d.get("data", [])
    cnt = d.get("cnt", 0)
    print(f"  {cnt} cells, {len(codes)} codes, {len(data)} values")

    rows = []
    skipped = 0
    no_coords = 0
    for i, (cell_id, val) in enumerate(zip(codes, data)):
        # Parse value
        try:
            if val == NULL_VAL or val == -1000001:
                v = None
            else:
                v = float(str(val).replace(",", "."))
                if v == NULL_VAL:
                    v = None
        except:
            v = None

        coords = parse_sihm500(cell_id)
        if not coords:
            no_coords += 1
            continue

        lat, lng = coords
        rows.append((cell_id, lat, lng, v))

        if len(rows) >= 5000:
            _upsert_grid(conn, rows, column)
            rows = []

    if rows:
        _upsert_grid(conn, rows, column)

    print(f"  ✅ {cnt - no_coords} upserted (skipped {no_coords} no-coords)")
    return cnt - no_coords

def _upsert_grid(conn, rows, column):
    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, f"""
        INSERT INTO grid_demographics (cell_id, lat, lng, {column})
        VALUES %s
        ON CONFLICT (cell_id) DO UPDATE SET
            lat = COALESCE(grid_demographics.lat, EXCLUDED.lat),
            lng = COALESCE(grid_demographics.lng, EXCLUDED.lng),
            {column} = EXCLUDED.{column},
            imported_at = NOW()
    """, [(r[0], r[1], r[2], r[3]) for r in rows])
    conn.commit()

def import_obcina_var(conn, var_values_id: int, column: str, label: str):
    print(f"\n📊 Importing {label} občine (var_values_id={var_values_id}, column={column})...")
    d = fetch_varval(var_values_id)
    if not d:
        print("  Failed")
        return 0
    codes = d.get("codes", [])
    names = d.get("names", [])
    data = d.get("data", [])
    print(f"  {len(codes)} občin")

    rows = []
    for cell_id, name, val in zip(codes, names, data):
        try:
            v = float(str(val).replace(",", ".")) if val != NULL_VAL else None
        except:
            v = None
        rows.append((str(cell_id), str(name), v))

    if not rows:
        return 0

    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, f"""
        INSERT INTO municipality_demographics (obcina_id, obcina_naziv, {column})
        VALUES %s
        ON CONFLICT (obcina_id) DO UPDATE SET
            obcina_naziv = COALESCE(EXCLUDED.obcina_naziv, municipality_demographics.obcina_naziv),
            {column} = EXCLUDED.{column},
            imported_at = NOW()
    """, rows)
    conn.commit()
    print(f"  ✅ {len(rows)} občin upserted")
    return len(rows)

def find_var_values_id(tree_id: int, target_su: int = 15, target_year: str = "2024") -> int | None:
    """Find var_values_id for a given tree_id, spatial unit (15=500m), year (2024)."""
    spat = fetch_varspat(tree_id)
    for su in spat:
        if int(su.get("su_id", 0)) == target_su:
            for date in su.get("dates", []):
                if target_year in str(date.get("date", "")):
                    return int(date["id"])
            # Fallback: first date
            if su.get("dates"):
                return int(su["dates"][0]["id"])
    return None

def find_obcina_var_values_id(tree_id: int, target_year: str = "2024") -> int | None:
    """Find var_values_id for občine (su_id=3)."""
    spat = fetch_varspat(tree_id)
    for su in spat:
        if int(su.get("su_id", 0)) == 3:  # su_id=3 = Občine
            for date in su.get("dates", []):
                if target_year in str(date.get("date", "")):
                    return int(date["id"])
            if su.get("dates"):
                return int(su["dates"][0]["id"])
    return None

def main():
    conn = psycopg2.connect(DB_URL)
    ensure_tables(conn)

    # Known tree_ids from gis.stat.si menu:
    # 20 = povprečna starost skupaj
    # 338 = osnovna izobrazba ali manj
    # 339 = srednja izobrazba
    # 340 = višja in visokošolska izobrazba
    # 195 = povprečna mesečna neto plača (občine)
    # 197 = indeks povprečne mesečne neto plače (občine)

    vars_500m = [
        (20,  "age_avg", "povprečna starost"),
        (338, "edct_1",  "osnovna izobrazba ali manj"),
        (339, "edct_2",  "srednja izobrazba"),
        (340, "edct_3",  "višja/visokošolska izobrazba"),
    ]
    vars_obcina = [
        (195, "ern_net",  "neto plača"),
        (197, "ind_ernet","indeks neto plače"),
    ]

    total = 0

    # 500m grid variables
    for tree_id, column, label in vars_500m:
        vvid = find_var_values_id(tree_id, target_su=15, target_year="2024")
        if not vvid:
            vvid = find_var_values_id(tree_id, target_su=15)  # any year
        if not vvid:
            print(f"  ⚠️ Could not find var_values_id for tree_id={tree_id} ({label})")
            continue
        total += import_grid_var(conn, vvid, column, label)
        time.sleep(1)

    # Občina variables
    for tree_id, column, label in vars_obcina:
        vvid = find_obcina_var_values_id(tree_id, target_year="2024")
        if not vvid:
            vvid = find_obcina_var_values_id(tree_id)
        if not vvid:
            print(f"  ⚠️ Could not find var_values_id for tree_id={tree_id} ({label})")
            continue
        total += import_obcina_var(conn, vvid, column, label)
        time.sleep(1)

    print(f"\n✅ STAGE II import complete: {total} total records")
    conn.close()

if __name__ == "__main__":
    main()
