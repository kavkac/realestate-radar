#!/usr/bin/env python3
"""
Bulk precompute ARSO noise_lden za vse SIHM500 celice.
Paralelni ARSO identify klici (asyncio + 15 workers).
~35,709 celic × 20s / 15 workers = ~12h (overnight job).

Progress se shranjuje sproti → varno prekiniti/nadaljevati.
"""

import asyncio, json, time, sys
import psycopg2, psycopg2.extras
import urllib.request, urllib.parse

DB_URL = "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
BASE = "https://gis.arso.gov.si/arcgis/rest/services/Atlasokolja_javni_D96/MapServer/identify"
LAYERS = "all:344,348,350,352,354,358"  # MOL + MOM + DRSI + DARS + železnica
CONCURRENCY = 12

# ── Sync ARSO fetch (v thread pool) ──────────────────────────────────────────
def fetch_lden_sync(lat: float, lng: float) -> float | None:
    params = urllib.parse.urlencode({
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "sr": "4326",
        "layers": LAYERS,
        "tolerance": "3",
        "mapExtent": f"{lng-0.005},{lat-0.005},{lng+0.005},{lat+0.005}",
        "imageDisplay": "100,100,96",
        "returnGeometry": "false",
        "f": "json",
    })
    url = f"{BASE}?{params}"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://gis.arso.gov.si/atlasokolja/",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
        max_lden = None
        for res in d.get("results", []):
            if "LDVN" not in res.get("layerName", ""):
                continue
            v = res.get("attributes", {}).get("LDEN")
            if v is not None:
                try:
                    fv = float(str(v).replace(",", "."))
                    if max_lden is None or fv > max_lden:
                        max_lden = fv
                except:
                    pass
        return max_lden
    except Exception:
        return None

# ── Async worker ─────────────────────────────────────────────────────────────
async def process_cell(sem, loop, cell_id, lat, lng):
    async with sem:
        lden = await loop.run_in_executor(None, fetch_lden_sync, lat, lng)
        return (cell_id, lden)

# ── Main ─────────────────────────────────────────────────────────────────────
async def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Pridobi celice brez noise
    cur.execute("""
        SELECT cell_id, lat, lng FROM grid_demographics
        WHERE noise_lden IS NULL AND lat IS NOT NULL
        ORDER BY cell_id
    """)
    cells = cur.fetchall()
    total = len(cells)
    print(f"Celic za obdelavo: {total}", flush=True)
    if total == 0:
        print("Vse celice že imajo noise_lden. Done.")
        conn.close()
        return

    sem = asyncio.Semaphore(CONCURRENCY)
    loop = asyncio.get_event_loop()
    
    done = 0
    found = 0
    batch = []
    t0 = time.time()
    
    # Batch po 50 za DB write
    BATCH_SIZE = 50
    
    tasks = [process_cell(sem, loop, c[0], c[1], c[2]) for c in cells]
    
    for coro in asyncio.as_completed(tasks):
        cell_id, lden = await coro
        done += 1
        if lden is not None:
            batch.append((lden, cell_id))
            found += 1
        
        if len(batch) >= BATCH_SIZE:
            psycopg2.extras.executemany(
                "UPDATE grid_demographics SET noise_lden=%s WHERE cell_id=%s",
                batch)
            conn.commit()
            batch = []
        
        if done % 500 == 0:
            elapsed = time.time() - t0
            rate = done / elapsed
            eta = (total - done) / rate / 3600 if rate > 0 else 0
            print(f"  {done}/{total} ({100*done/total:.1f}%) | {found} z noise | ETA {eta:.1f}h", flush=True)
    
    if batch:
        psycopg2.extras.executemany(
            "UPDATE grid_demographics SET noise_lden=%s WHERE cell_id=%s", batch)
        conn.commit()
    
    elapsed = time.time() - t0
    print(f"\n✅ Done: {found}/{total} celic dobilo noise_lden v {elapsed/3600:.1f}h")
    conn.close()

if __name__ == "__main__":
    asyncio.run(main())
