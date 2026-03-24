#!/usr/bin/env python3
"""
import-gurs-kn-stavbe.py

Bulk import STAVBE_H iz GURS KN WFS v gurs_kn_stavbe tabelo.
WFS endpoint: https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs
Max 20,000 zapisov na request → ~60 requestov za vse SLO stavbe.

Pogon:
  python3 scripts/import-gurs-kn-stavbe.py [--batch 20000] [--start 0]
"""

import urllib.request, json, sys, os, time, argparse
import psycopg2, psycopg2.extras

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

WFS_BASE = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs"
TYPENAME = "SI.GURS.KN:STAVBE_H"

def wfs_url(start: int, count: int) -> str:
    return (
        f"{WFS_BASE}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
        f"&TYPENAMES={TYPENAME}"
        f"&OUTPUTFORMAT=application/json"
        f"&COUNT={count}&STARTINDEX={start}"
        f"&CQL_FILTER=STATUS_VELJAVNOSTI%3D%27V%27"  # samo veljavni
        f"&SRSNAME=EPSG:3794"
    )

def fetch_page(start: int, count: int) -> list[dict]:
    url = wfs_url(start, count)
    req = urllib.request.Request(url, headers={"User-Agent": "RealEstateRadar/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
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
        eid = p.get("EID_STAVBA")
        if not eid:
            continue
        rows.append((
            int(eid),
            p.get("KO_ID"),
            p.get("ST_STAVBE"),
            p.get("STEVILO_ETAZ"),
            p.get("STEVILO_STANOVANJ"),
            p.get("STEVILO_POSLOVNIH_PROSTOROV"),
            p.get("TIP_STAVBE_ID"),
            bool(p.get("ELEKTRIKA")),
            bool(p.get("PLIN")),
            bool(p.get("VODOVOD")),
            bool(p.get("KANALIZACIJA")),
            p.get("LETO_IZGRADNJE"),
            p.get("LETO_OBNOVE_FASADE"),
            p.get("LETO_OBNOVE_STREHE"),
            p.get("VISINA_H1"),
            p.get("VISINA_H2"),
            p.get("VISINA_H3"),
            p.get("VISINSKA_NATANCNOST_STAVBE_ID"),
            p.get("POLOZAJNA_NATANCNOST_STAVBE_ID"),
            p.get("NOSILNA_KONSTRUKCIJA_ID"),
            p.get("BRUTO_TLORISNA_POVRSINA"),
            json.dumps(p.get("OBRIS_GEOM")) if p.get("OBRIS_GEOM") else None,
            json.dumps(p.get("TEREN_GEOM")) if p.get("TEREN_GEOM") else None,
            json.dumps(p.get("CENTROID_GEOM")) if p.get("CENTROID_GEOM") else None,
            p.get("DATUM_SYS"),
            p.get("DATUM_OD"),
        ))

    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, """
        INSERT INTO gurs_kn_stavbe (
            eid_stavba, ko_id, st_stavbe, stevilo_etaz, stevilo_stanovanj,
            stevilo_posl, tip_stavbe_id, elektrika, plin, vodovod, kanalizacija,
            leto_izgradnje, leto_obnove_fasade, leto_obnove_strehe,
            visina_h1, visina_h2, visina_h3, visinska_natancnost, polozajna_natancnost,
            nosilna_konstrukcija_id, bruto_tlorisna_pov,
            obris_geom, teren_geom, centroid_geom, datum_sys, datum_od
        ) VALUES %s
        ON CONFLICT (eid_stavba) DO UPDATE SET
            stevilo_etaz        = EXCLUDED.stevilo_etaz,
            stevilo_stanovanj   = EXCLUDED.stevilo_stanovanj,
            tip_stavbe_id       = EXCLUDED.tip_stavbe_id,
            elektrika           = EXCLUDED.elektrika,
            plin                = EXCLUDED.plin,
            vodovod             = EXCLUDED.vodovod,
            kanalizacija        = EXCLUDED.kanalizacija,
            leto_izgradnje      = EXCLUDED.leto_izgradnje,
            leto_obnove_fasade  = COALESCE(EXCLUDED.leto_obnove_fasade, gurs_kn_stavbe.leto_obnove_fasade),
            leto_obnove_strehe  = COALESCE(EXCLUDED.leto_obnove_strehe, gurs_kn_stavbe.leto_obnove_strehe),
            visina_h2           = EXCLUDED.visina_h2,
            visina_h3           = EXCLUDED.visina_h3,
            nosilna_konstrukcija_id = EXCLUDED.nosilna_konstrukcija_id,
            bruto_tlorisna_pov  = EXCLUDED.bruto_tlorisna_pov,
            obris_geom          = EXCLUDED.obris_geom,
            teren_geom          = EXCLUDED.teren_geom,
            centroid_geom       = EXCLUDED.centroid_geom,
            imported_at         = NOW()
    """, rows)
    conn.commit()
    return len(rows)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=20000)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0, help="0 = no limit (all)")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    print(f"DB connected. Importing STAVBE_H from WFS (batch={args.batch})...")

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
        time.sleep(0.3)  # rate limit

    print(f"\n✅ Import done: {total} stavb v gurs_kn_stavbe")
    conn.close()

if __name__ == "__main__":
    main()
