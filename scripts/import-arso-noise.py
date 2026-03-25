#!/usr/bin/env python3
"""
Import ARSO strateških kart hrupa v DB + preračunaj noise_lden za vse SIHM500 celice.

Layer 344: MOL Ljubljana ceste Ldvn 2020 (12 featurov)
Layer 352: DRSI državne ceste Ldvn 2020 (170k featurov)

Postopek:
1. Download geometrij po batchih (1000/klic) → arso_noise tabela
2. Point-in-polygon (shapely) za vse SIHM500 celice → grid_demographics.noise_lden
3. Live /api/neighborhood klic bo šel na grid_demographics (instant, ne ARSO API)
"""

import psycopg2, psycopg2.extras, json, time, sys
import urllib.request, urllib.parse
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

DB_URL = "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
BASE_URL = "https://gis.arso.gov.si/arcgis/rest/services/Atlasokolja_javni_D96/MapServer"

def fetch_features(layer_id, offset=0, batch=500):
    """Fetch batch of features with geometry (EPSG:3794 koordinate)."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": "LDEN,OBMOCJE",
        "returnGeometry": "true",
        "outSR": "3794",  # D96/TM — iste kot SIHM500
        "resultOffset": offset,
        "resultRecordCount": batch,
        "f": "json",
    })
    url = f"{BASE_URL}/{layer_id}/query?{params}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print(f"  Attempt {attempt+1} failed: {e}")
            time.sleep(5 * (attempt + 1))
    return None

def rings_to_shapely(rings):
    """Convert ArcGIS rings to shapely Polygon."""
    if not rings:
        return None
    exterior = rings[0]
    holes = rings[1:] if len(rings) > 1 else []
    try:
        from shapely.geometry import Polygon
        return Polygon(exterior, holes)
    except Exception:
        return None

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Ustvari tabelo za ARSO noise poligone
    cur.execute("""
        CREATE TABLE IF NOT EXISTS arso_noise_ldvn (
            id SERIAL PRIMARY KEY,
            layer_id INTEGER NOT NULL,
            lden FLOAT NOT NULL,
            obmocje TEXT,
            geom_rings JSONB NOT NULL  -- ArcGIS rings v EPSG:3794
        );
        CREATE INDEX IF NOT EXISTS arso_noise_ldvn_layer ON arso_noise_ldvn(layer_id);
    """)
    conn.commit()

    # Preveri ali je že uvoženo
    cur.execute("SELECT COUNT(*) FROM arso_noise_ldvn")
    existing = cur.fetchone()[0]
    if existing > 100:
        print(f"arso_noise_ldvn že ima {existing} vrstic, preskočim download.")
    else:
        # Uvozi Layer 344 (MOL, 12 featurov) + Layer 352 (DRSI, 170k)
        for layer_id, total_est in [(344, 12), (352, 170100)]:
            print(f"\n=== Layer {layer_id} (~{total_est} featurov) ===")
            offset = 0
            imported = 0
            while True:
                print(f"  Batch offset={offset}...", end=" ", flush=True)
                data = fetch_features(layer_id, offset, batch=500)
                if not data or "features" not in data:
                    print("NAPAKA — preskočim")
                    break
                features = data["features"]
                if not features:
                    print("konec.")
                    break

                rows = []
                for f in features:
                    rings = f.get("geometry", {}).get("rings", [])
                    lden_raw = f.get("attributes", {}).get("LDEN")
                    obmocje = f.get("attributes", {}).get("OBMOCJE", "")
                    if lden_raw is None or not rings:
                        continue
                    try:
                        lden = float(str(lden_raw).replace(",", "."))
                    except:
                        continue
                    rows.append((layer_id, lden, obmocje, json.dumps(rings)))

                if rows:
                    psycopg2.extras.execute_values(cur, """
                        INSERT INTO arso_noise_ldvn (layer_id, lden, obmocje, geom_rings)
                        VALUES %s ON CONFLICT DO NOTHING
                    """, rows)
                    conn.commit()
                    imported += len(rows)

                print(f"{len(features)} featurov, skupaj {imported}")
                if len(features) < 500:
                    break
                offset += 500
                time.sleep(0.5)  # rate limit

            print(f"Layer {layer_id}: {imported} uvoženo")

    # Preračunaj noise_lden za vse SIHM500 celice
    print("\n=== Point-in-polygon za SIHM500 celice ===")

    # Naloži vse noise poligone
    cur.execute("SELECT lden, geom_rings FROM arso_noise_ldvn ORDER BY lden DESC")
    rows = cur.fetchall()
    print(f"Uvoženih {len(rows)} noise poligonov.")

    # Ustvari shapely geometrije
    geoms = []
    ldens = []
    for lden, rings_json in rows:
        rings = rings_json if isinstance(rings_json, list) else json.loads(rings_json)
        poly = rings_to_shapely(rings)
        if poly and poly.is_valid:
            geoms.append(poly)
            ldens.append(lden)

    print(f"Veljavnih geometrij: {len(geoms)}")
    if not geoms:
        print("Ni geometrij — preskočim.")
        conn.close()
        return

    # STRtree za hitro iskanje
    tree = STRtree(geoms)

    # Pridobi vse SIHM500 celice
    cur.execute("SELECT cell_id, lat, lng FROM grid_demographics WHERE noise_lden IS NULL")
    cells = cur.fetchall()
    print(f"Celic za obdelavo: {len(cells)}")

    # Preračunaj
    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4326", "EPSG:3794", always_xy=True)

    updated = 0
    batch_rows = []
    for i, (cell_id, lat, lng) in enumerate(cells):
        # WGS84 → D96/TM
        e, n = t.transform(lng, lat)
        pt = Point(e, n)

        # Najdi vse poligone ki vsebujejo točko
        candidates = tree.query(pt)
        max_lden = None
        for idx in candidates:
            if geoms[idx].contains(pt):
                if max_lden is None or ldens[idx] > max_lden:
                    max_lden = ldens[idx]

        if max_lden is not None:
            batch_rows.append((max_lden, cell_id))
            updated += 1

        if len(batch_rows) >= 1000:
            psycopg2.extras.execute_values(cur,
                "UPDATE grid_demographics SET noise_lden=%s WHERE cell_id=%s",
                batch_rows, template="(%s, %s)")
            conn.commit()
            batch_rows = []
            print(f"  {i+1}/{len(cells)} celic obdelano, {updated} posodobljeno")

    if batch_rows:
        psycopg2.extras.execute_values(cur,
            "UPDATE grid_demographics SET noise_lden=%s WHERE cell_id=%s",
            batch_rows, template="(%s, %s)")
        conn.commit()

    print(f"\nDone: {updated}/{len(cells)} celic dobilo noise_lden vrednost.")
    conn.close()

if __name__ == "__main__":
    main()
