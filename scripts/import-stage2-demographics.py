#!/usr/bin/env python3
"""
import-stage2-demographics.py

Import SURS STAGE II demografskih podatkov v DB:
  - grid_demographics: 500m mreža (starost, izobrazba)
  - municipality_demographics: občine (plače, trg dela)

Koordinatni sistem SIHM500: ID celice = "SIHM500_{N}_{E}"
  kjer N = northing (D96/TM Y), E = easting (D96/TM X)
  Pretvorba v WGS84: pyproj (EPSG:3794 → EPSG:4326)

Pogon:
  python3 scripts/import-stage2-demographics.py --dir /tmp/stage2

ZIP vsebina (Stefan STAGE II export):
  STAGE_data_3.zip → age_p (povprečna starost) 500m
  STAGE_data_4.zip → plače po občinah (ern_net, ind_ernet itd.)
  STAGE_data_6.zip → edct_3 (višja/visoka izobrazba) 500m
  STAGE_data_7.zip → edct_2 (srednja izobrazba) 500m
  STAGE_data_8.zip → edct_1 (osnovna izobrazba ali manj) 500m
"""

import os, sys, zipfile, csv, io, argparse, math
import psycopg2, psycopg2.extras

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

# EPSG:3794 (D96/TM) → WGS84 approximate conversion for SLO
# Using standard transformation constants for Slovenia
def d96tm_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """
    Convert D96/TM (EPSG:3794) coordinates to WGS84 lat/lng.
    Uses pyproj if available, otherwise falls back to approximate formula.
    """
    try:
        from pyproj import Transformer
        t = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)
        lng, lat = t.transform(easting, northing)
        return lat, lng
    except ImportError:
        # Approximate fallback (SLO-specific linear transform)
        # D96/TM origin: central meridian 15°E, scale 0.9999
        # Rough constants for SLO bounding box
        lat = (northing - 5420000) / 111195 + 46.0
        lng = (easting - 500000) / (111195 * math.cos(math.radians(46.0))) + 15.0
        return lat, lng

def parse_cell_id(cell_id: str) -> tuple[float, float] | None:
    """
    Parse SIHM500_{N}_{E} → (lat, lng) center of 500m cell.
    N = northing origin, E = easting origin (SW corner of cell).
    Center = N+250, E+250.
    """
    try:
        parts = cell_id.replace("SIHM500_", "").split("_")
        if len(parts) < 2:
            return None
        # Format: SIHM500_YYYY_XXXX where YYYY*1000=northing, XXXX*1000=easting
        # Actually from Stefan's files: SIHM500_5535_1540 → northing=5535000, easting=1540000 (approx)
        # The actual cell centers: divide by scale factor
        # Stefan confirmed: "SIHM500_5535_1540" → D96/TM
        n = float(parts[-2]) * 1000 + 250  # center of cell (250m from SW corner)
        e = float(parts[-1]) * 1000 + 250
        return d96tm_to_wgs84(e, n)
    except Exception:
        return None

def ensure_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS grid_demographics (
          cell_id         text PRIMARY KEY,   -- SIHM500_{N}_{E}
          lat             float,              -- WGS84 center lat
          lng             float,              -- WGS84 center lng
          age_avg         float,              -- povprečna starost
          edct_1          float,              -- osnovna izobrazba ali manj
          edct_2          float,              -- srednja izobrazba
          edct_3          float,              -- višja/visokošolska izobrazba
          pop_total       float,              -- skupno število (če na voljo)
          year            int DEFAULT 2024,
          imported_at     timestamptz DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS grid_demo_lat_lng ON grid_demographics(lat, lng);

        CREATE TABLE IF NOT EXISTS municipality_demographics (
          obcina_id       text PRIMARY KEY,   -- SURS ID občine
          obcina_naziv    text,
          ern_net         float,              -- povprečna neto plača
          ern_gros        float,              -- povprečna bruto plača
          ind_ernet       float,              -- indeks neto plače (SLO=100)
          ind_erngr       float,              -- indeks bruto plače
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
    print("Tables grid_demographics + municipality_demographics ready")

def read_tsv_from_zip(zip_path: str) -> tuple[list[str], list[list[str]]] | None:
    """Read first TSV file from ZIP. Returns (headers, rows)."""
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            names = [n for n in z.namelist() if n.endswith('.tsv') or n.endswith('.csv') or n.endswith('.txt')]
            if not names:
                names = z.namelist()
            print(f"  Files in ZIP: {z.namelist()}")
            fname = names[0]
            content = z.read(fname).decode('utf-8-sig')
            reader = csv.reader(io.StringIO(content), delimiter='\t')
            rows = list(reader)
            if not rows:
                return None
            return rows[0], rows[1:]
    except Exception as e:
        print(f"  ZIP read error: {e}")
        return None

def import_grid_variable(conn, zip_path: str, column: str, null_value: float = -1000001.0):
    """Import a single variable from 500m grid ZIP into grid_demographics."""
    result = read_tsv_from_zip(zip_path)
    if not result:
        print(f"  Could not read {zip_path}")
        return 0

    headers, rows = result
    print(f"  Headers: {headers[:5]}")
    print(f"  Sample row: {rows[0][:5] if rows else 'empty'}")

    # Find cell_id column and value column
    id_col = next((i for i, h in enumerate(headers) if 'sihm' in h.lower() or 'id' in h.lower() or 'grid' in h.lower()), 0)
    val_col = next((i for i, h in enumerate(headers) if h.lower() not in ['id', 'grid_id', 'cell_id', 'sihm500'] and i != id_col), len(headers)-1)

    print(f"  Using col[{id_col}]={headers[id_col]} as ID, col[{val_col}]={headers[val_col] if val_col < len(headers) else '?'} as value")

    updated = 0
    batch = []
    for row in rows:
        if not row or len(row) <= max(id_col, val_col):
            continue
        cell_id = row[id_col].strip()
        if not cell_id:
            continue
        try:
            val = float(row[val_col].replace(',', '.'))
            if val == null_value or val < -999999:
                val = None
        except (ValueError, IndexError):
            val = None

        coords = parse_cell_id(cell_id)
        if not coords:
            continue
        lat, lng = coords
        batch.append((cell_id, lat, lng, val))

        if len(batch) >= 2000:
            _upsert_grid_batch(conn, batch, column)
            updated += len(batch)
            batch = []

    if batch:
        _upsert_grid_batch(conn, batch, column)
        updated += len(batch)

    print(f"  ✅ {updated} celice upserted za {column}")
    return updated

def _upsert_grid_batch(conn, batch, column):
    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, f"""
        INSERT INTO grid_demographics (cell_id, lat, lng, {column})
        VALUES %s
        ON CONFLICT (cell_id) DO UPDATE SET
            lat = COALESCE(grid_demographics.lat, EXCLUDED.lat),
            lng = COALESCE(grid_demographics.lng, EXCLUDED.lng),
            {column} = EXCLUDED.{column},
            imported_at = NOW()
    """, [(r[0], r[1], r[2], r[3]) for r in batch])
    conn.commit()

def import_municipality_zip(conn, zip_path: str):
    """Import občina-level data (plače, trg dela) from ZIP."""
    result = read_tsv_from_zip(zip_path)
    if not result:
        return 0

    headers, rows = result
    print(f"  Municipality headers: {headers[:10]}")
    print(f"  Sample: {rows[0][:10] if rows else []}")

    # Map columns
    def find_col(keywords):
        for kw in keywords:
            for i, h in enumerate(headers):
                if kw.lower() in h.lower():
                    return i
        return None

    id_col = find_col(['id', 'sifra', 'code', 'obcina_id', 'NUTS'])
    name_col = find_col(['naziv', 'name', 'obcina'])
    ern_net_col = find_col(['ern_net', 'neto', 'net'])
    ern_gros_col = find_col(['ern_gros', 'bruto', 'gross'])
    ind_ernet_col = find_col(['ind_ernet', 'indeks_net', 'ind_net'])
    ind_erngr_col = find_col(['ind_erngr', 'indeks_gro', 'ind_gro'])

    print(f"  id={id_col}, name={name_col}, ern_net={ern_net_col}, ind_ernet={ind_ernet_col}")

    batch = []
    for row in rows:
        if not row:
            continue
        def get_float(col):
            if col is None or col >= len(row): return None
            try: return float(row[col].replace(',', '.'))
            except: return None
        def get_str(col):
            if col is None or col >= len(row): return None
            return row[col].strip() or None

        obcina_id = get_str(id_col)
        if not obcina_id:
            continue
        batch.append((
            obcina_id,
            get_str(name_col),
            get_float(ern_net_col),
            get_float(ern_gros_col),
            get_float(ind_ernet_col),
            get_float(ind_erngr_col),
        ))

    if not batch:
        print("  No rows parsed")
        return 0

    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, """
        INSERT INTO municipality_demographics (
            obcina_id, obcina_naziv, ern_net, ern_gros, ind_ernet, ind_erngr
        ) VALUES %s
        ON CONFLICT (obcina_id) DO UPDATE SET
            obcina_naziv = COALESCE(EXCLUDED.obcina_naziv, municipality_demographics.obcina_naziv),
            ern_net      = COALESCE(EXCLUDED.ern_net, municipality_demographics.ern_net),
            ern_gros     = COALESCE(EXCLUDED.ern_gros, municipality_demographics.ern_gros),
            ind_ernet    = COALESCE(EXCLUDED.ind_ernet, municipality_demographics.ind_ernet),
            ind_erngr    = COALESCE(EXCLUDED.ind_erngr, municipality_demographics.ind_erngr),
            imported_at  = NOW()
    """, batch)
    conn.commit()
    print(f"  ✅ {len(batch)} občin upserted")
    return len(batch)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="/tmp/stage2", help="Dir with ZIP files")
    parser.add_argument("--age-zip", help="Override: path to age ZIP (STAGE_data_3.zip)")
    parser.add_argument("--place-zip", help="Override: path to plače ZIP (STAGE_data_4.zip)")
    parser.add_argument("--edct3-zip", help="Override: path to edct3 ZIP")
    parser.add_argument("--edct2-zip", help="Override: path to edct2 ZIP")
    parser.add_argument("--edct1-zip", help="Override: path to edct1 ZIP")
    args = parser.parse_args()

    d = args.dir
    age_zip    = args.age_zip    or os.path.join(d, "age.zip")
    place_zip  = args.place_zip  or os.path.join(d, "place_obcine.zip")
    edct3_zip  = args.edct3_zip  or os.path.join(d, "edct3_visoka.zip")
    edct2_zip  = args.edct2_zip  or os.path.join(d, "edct2_srednja.zip")
    edct1_zip  = args.edct1_zip  or os.path.join(d, "edct1_osnovna.zip")

    conn = psycopg2.connect(DB_URL)
    ensure_tables(conn)

    total = 0

    if os.path.exists(age_zip) and os.path.getsize(age_zip) > 1000:
        print(f"\n📊 Importing age_avg from {age_zip}...")
        total += import_grid_variable(conn, age_zip, "age_avg")
    else:
        print(f"  ⚠️ {age_zip} not found or empty")

    if os.path.exists(edct3_zip) and os.path.getsize(edct3_zip) > 1000:
        print(f"\n📊 Importing edct_3 (višja/visoka) from {edct3_zip}...")
        total += import_grid_variable(conn, edct3_zip, "edct_3")

    if os.path.exists(edct2_zip) and os.path.getsize(edct2_zip) > 1000:
        print(f"\n📊 Importing edct_2 (srednja) from {edct2_zip}...")
        total += import_grid_variable(conn, edct2_zip, "edct_2")

    if os.path.exists(edct1_zip) and os.path.getsize(edct1_zip) > 1000:
        print(f"\n📊 Importing edct_1 (osnovna) from {edct1_zip}...")
        total += import_grid_variable(conn, edct1_zip, "edct_1")

    if os.path.exists(place_zip) and os.path.getsize(place_zip) > 1000:
        print(f"\n📊 Importing municipality (plače) from {place_zip}...")
        total += import_municipality_zip(conn, place_zip)

    print(f"\n✅ STAGE II import complete: {total} records")
    conn.close()

if __name__ == "__main__":
    main()
