#!/usr/bin/env python3
"""
Bulk import ARSO hrup poligonov → grid_demographics.noise_lden za vse SIHM500 celice.

Layer 344: MOL Ljubljana (12 poligonov, detajlni)
Layer 352: DRSI državne ceste (170k poligonov, batch po bbox)

Tehnika: Python urllib (ne Node.js/fetch) + maxAllowableOffset=50 za simplifikacijo.
"""

import psycopg2, psycopg2.extras, json, time, sys, socket
import urllib.request, urllib.parse
from shapely.geometry import Point, Polygon, MultiPolygon
from shapely.strtree import STRtree
from pyproj import Transformer

DB_URL = "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
BASE = "https://gis.arso.gov.si/arcgis/rest/services/Atlasokolja_javni_D96/MapServer"
socket.setdefaulttimeout(120)

def fetch_layer(layer_id, offset=0, batch=100, xmin=None, ymin=None, xmax=None, ymax=None):
    params = {
        "outFields": "LDEN",
        "returnGeometry": "true",
        "outSR": "3794",
        "maxAllowableOffset": "50",  # 50m simplifikacija — dovolj za 500m grid
        "resultOffset": offset,
        "resultRecordCount": batch,
        "f": "json",
    }
    if xmin is not None:
        params["geometry"] = f"{xmin},{ymin},{xmax},{ymax}"
        params["geometryType"] = "esriGeometryEnvelope"
        params["spatialRel"] = "esriSpatialRelIntersects"
        params["inSR"] = "3794"
        params["where"] = "1=1"
    else:
        params["where"] = "1=1"
    
    url = f"{BASE}/{layer_id}/query?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
                "Referer": "https://gis.arso.gov.si/atlasokolja/",
            })
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.load(r)
            return data
        except Exception as e:
            print(f"  Attempt {attempt+1}/3 failed: {type(e).__name__}: {str(e)[:80]}")
            time.sleep(10 * (attempt + 1))
    return None

def rings_to_shapely(rings):
    if not rings:
        return None
    try:
        exterior = rings[0]
        holes = rings[1:] if len(rings) > 1 else []
        poly = Polygon(exterior, holes)
        return poly if poly.is_valid else poly.buffer(0)
    except Exception:
        return None

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Ustvari tabelo
    cur.execute("""
        CREATE TABLE IF NOT EXISTS arso_noise_ldvn (
            id SERIAL PRIMARY KEY,
            layer_id INTEGER NOT NULL,
            lden FLOAT NOT NULL,
            geom_rings JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_arso_noise_layer ON arso_noise_ldvn(layer_id);
        CREATE INDEX IF NOT EXISTS idx_arso_noise_lden ON arso_noise_ldvn(lden);
    """)
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM arso_noise_ldvn")
    existing = cur.fetchone()[0]
    
    if existing < 10:
        # === Layer 344: MOL Ljubljana (12 featurov, 1 klic) ===
        print("=== Layer 344: MOL Ljubljana ===")
        data = fetch_layer(344, offset=0, batch=20)
        if data and data.get("features"):
            rows = []
            for f in data["features"]:
                rings = f.get("geometry", {}).get("rings", [])
                lden = f.get("attributes", {}).get("LDEN")
                if lden and rings:
                    rows.append((344, float(str(lden).replace(",",".")), json.dumps(rings)))
            if rows:
                psycopg2.extras.execute_values(cur,
                    "INSERT INTO arso_noise_ldvn (layer_id, lden, geom_rings) VALUES %s",
                    rows)
                conn.commit()
                print(f"  Layer 344: {len(rows)} poligonov uvoženih")
        
        # === Layer 352: DRSI državne ceste (170k featurov, batch po bbox) ===
        # SLO bbox v EPSG:3794: E~[389000,595000], N~[35000,173000]
        # Razdelimo na grid 30×30 = 900 celic (~6500×4600m vsaka)
        print("\n=== Layer 352: DRSI ceste (170k featurov, bbox batching) ===")
        
        E_MIN, E_MAX = 389000, 595000
        N_MIN, N_MAX = 35000, 173000
        COLS, ROWS_G = 30, 22  # ~6.9k × 6.5k m per cell
        
        e_step = (E_MAX - E_MIN) / COLS
        n_step = (N_MAX - N_MIN) / ROWS_G
        
        total_imported = 0
        cell = 0
        total_cells = COLS * ROWS_G
        
        for ci in range(COLS):
            for ri in range(ROWS_G):
                cell += 1
                xmin = E_MIN + ci * e_step
                xmax = xmin + e_step + 100
                ymin = N_MIN + ri * n_step
                ymax = ymin + n_step + 100
                
                offset = 0
                cell_rows = []
                while True:
                    data = fetch_layer(352, offset=offset, batch=50,
                                      xmin=xmin, ymin=ymin, xmax=xmax, ymax=ymax)
                    if not data or not data.get("features"):
                        break
                    
                    for f in data["features"]:
                        rings = f.get("geometry", {}).get("rings", [])
                        lden = f.get("attributes", {}).get("LDEN")
                        if lden and rings:
                            cell_rows.append((352, float(str(lden).replace(",",".")), json.dumps(rings)))
                    
                    if len(data["features"]) < 50:
                        break
                    offset += 50
                
                if cell_rows:
                    psycopg2.extras.execute_values(cur,
                        "INSERT INTO arso_noise_ldvn (layer_id, lden, geom_rings) VALUES %s",
                        cell_rows)
                    conn.commit()
                    total_imported += len(cell_rows)
                
                if cell % 50 == 0:
                    print(f"  {cell}/{total_cells} celic, {total_imported} poligonov")
                
                time.sleep(0.3)
        
        print(f"\nLayer 352: skupaj {total_imported} poligonov")
    else:
        print(f"arso_noise_ldvn že ima {existing} vrstic, preskočim download.")

    # === Point-in-polygon za vse SIHM500 celice ===
    print("\n=== Point-in-polygon: SIHM500 → noise_lden ===")
    
    cur.execute("SELECT lden, geom_rings FROM arso_noise_ldvn ORDER BY lden DESC")
    all_rows = cur.fetchall()
    print(f"Noise poligoni v DB: {len(all_rows)}")
    
    if not all_rows:
        print("Ni podatkov — končam.")
        conn.close()
        return
    
    # Ustvari shapely geom + STRtree
    geoms = []
    ldens_arr = []
    for lden, rings_json in all_rows:
        rings = rings_json if isinstance(rings_json, list) else json.loads(rings_json)
        poly = rings_to_shapely(rings)
        if poly and poly.is_valid:
            geoms.append(poly)
            ldens_arr.append(lden)
    
    print(f"Veljavnih geometrij: {len(geoms)}")
    tree = STRtree(geoms)
    
    # Pridobi SIHM500 celice brez noise
    cur.execute("""
        SELECT cell_id, lat, lng FROM grid_demographics 
        WHERE noise_lden IS NULL AND lat IS NOT NULL
        ORDER BY cell_id
    """)
    cells = cur.fetchall()
    print(f"Celic za obdelavo: {len(cells)}")
    
    t_wgs_to_d96 = Transformer.from_crs("EPSG:4326", "EPSG:3794", always_xy=True)
    
    updated = 0
    batch_upd = []
    
    for i, (cell_id, lat, lng) in enumerate(cells):
        e, n = t_wgs_to_d96.transform(lng, lat)
        pt = Point(e, n)
        
        candidates = tree.query(pt)
        max_lden = None
        for idx in candidates:
            if geoms[idx].contains(pt):
                if max_lden is None or ldens_arr[idx] > max_lden:
                    max_lden = ldens_arr[idx]
        
        if max_lden is not None:
            batch_upd.append((max_lden, cell_id))
            updated += 1
        
        if len(batch_upd) >= 2000:
            psycopg2.extras.execute_values(cur,
                "UPDATE grid_demographics SET noise_lden=%s WHERE cell_id=%s",
                batch_upd, template="(%s, %s)")
            conn.commit()
            batch_upd = []
        
        if (i+1) % 5000 == 0:
            print(f"  {i+1}/{len(cells)} celic, {updated} dobilo noise_lden")
    
    if batch_upd:
        psycopg2.extras.execute_values(cur,
            "UPDATE grid_demographics SET noise_lden=%s WHERE cell_id=%s",
            batch_upd, template="(%s, %s)")
        conn.commit()
    
    print(f"\n✅ Done: {updated}/{len(cells)} celic ima noise_lden v grid_demographics.")
    conn.close()

if __name__ == "__main__":
    main()
