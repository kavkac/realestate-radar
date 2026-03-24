#!/usr/bin/env python3
"""
import-gurs-kn-etaze.py

Bulk import ETAZE_H iz GURS KN WFS v kn_etaze tabelo.
Atributi: EID_ETAZA, STEVILKA_ETAZE, EID_STAVBA, NADMORSKA_VISINA,
          VISINA_ETAZE, POVRSINA, PRITLICNA_ETAZA, DATUM_SYS

Pogon:
  python3 scripts/import-gurs-kn-etaze.py [--batch 20000] [--start 0]
"""

import urllib.request, json, sys, os, time, argparse
import psycopg2, psycopg2.extras

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

WFS_BASE = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs"
TYPENAME = "SI.GURS.KN:ETAZE_H"

def ensure_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS kn_etaze (
          eid_etaza        bigint PRIMARY KEY,
          stevilka_etaze   int,
          eid_stavba       bigint,
          nadmorska_visina float,   -- absolutna višina etaže (m) — ključno za viewshed!
          visina_etaze     float,   -- višina etaže (m)
          povrsina         float,
          pritlicna_etaza  boolean,
          datum_sys        timestamptz,
          imported_at      timestamptz DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS kn_etaze_eid_stavba_idx ON kn_etaze(eid_stavba);
        CREATE INDEX IF NOT EXISTS kn_etaze_stevilka_idx ON kn_etaze(eid_stavba, stevilka_etaze);
    """)
    conn.commit()
    print("Table kn_etaze ready")

def wfs_url(start: int, count: int) -> str:
    return (
        f"{WFS_BASE}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
        f"&TYPENAMES={TYPENAME}"
        f"&OUTPUTFORMAT=application/json"
        f"&COUNT={count}&STARTINDEX={start}"
        f"&CQL_FILTER=STATUS_VELJAVNOSTI%3D%27V%27"
    )

def fetch_page(start: int, count: int) -> list[dict]:
    url = wfs_url(start, count)
    req = urllib.request.Request(url, headers={"User-Agent": "RealEstateRadar/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        return data.get("features", [])
    except Exception as e:
        print(f"  FETCH ERR at start={start}: {e}")
        return []

def upsert_batch(conn, features: list[dict]) -> int:
    if not features:
        return 0
    rows = []
    for f in features:
        p = f.get("properties", {})
        eid = p.get("EID_ETAZA")
        if not eid:
            continue
        rows.append((
            int(eid),
            p.get("STEVILKA_ETAZE"),
            int(p["EID_STAVBA"]) if p.get("EID_STAVBA") else None,
            p.get("NADMORSKA_VISINA"),
            p.get("VISINA_ETAZE"),
            p.get("POVRSINA"),
            bool(p.get("PRITLICNA_ETAZA")) if p.get("PRITLICNA_ETAZA") is not None else None,
            p.get("DATUM_SYS"),
        ))
    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, """
        INSERT INTO kn_etaze (
            eid_etaza, stevilka_etaze, eid_stavba,
            nadmorska_visina, visina_etaze, povrsina,
            pritlicna_etaza, datum_sys
        ) VALUES %s
        ON CONFLICT (eid_etaza) DO UPDATE SET
            nadmorska_visina = EXCLUDED.nadmorska_visina,
            visina_etaze     = EXCLUDED.visina_etaze,
            povrsina         = EXCLUDED.povrsina,
            imported_at      = NOW()
    """, rows)
    conn.commit()
    return len(rows)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=20000)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    ensure_table(conn)
    print(f"Importing ETAZE_H (batch={args.batch})...")

    total = 0
    start = args.start

    while True:
        if args.limit and total >= args.limit:
            break
        print(f"  Fetching [{start}–{start+args.batch})...", end=" ", flush=True)
        features = fetch_page(start, args.batch)
        if not features:
            print("empty — done")
            break
        inserted = upsert_batch(conn, features)
        total += inserted
        print(f"{inserted} upserted (total {total})")
        if len(features) < args.batch:
            print("Last page — done")
            break
        start += args.batch
        time.sleep(0.3)

    print(f"\n✅ ETAZE_H import done: {total} etaž")
    conn.close()

if __name__ == "__main__":
    main()
