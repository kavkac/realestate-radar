#!/usr/bin/env python3
"""
backfill-deli-stavb-kn.py

Backfill DELI_STAVB_H delta columns into ev_del_stavbe:
  - etazna_lastnina
  - skupni_del_etazna_lastnina
  - upravnik_id
  - eid_stanovanje
  - nacin_dolocitve_povrsine

Fetches from WFS in batches by eid_del_stavbe list from DB.

Pogon:
  python3 scripts/backfill-deli-stavb-kn.py [--batch 500]
"""

import urllib.request, json, os, time, argparse
import psycopg2, psycopg2.extras

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)
WFS_BASE = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs"

def fetch_deli_stavb(eid_list: list[str]) -> dict[str, dict]:
    """Fetch DELI_STAVB_H for a list of eid_del_stavbe. Returns dict keyed by EID."""
    ids_filter = " OR ".join(f"EID_DEL_STAVBE='{e}'" for e in eid_list)
    url = (
        f"{WFS_BASE}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
        f"&TYPENAMES=SI.GURS.KN:DELI_STAVB_H"
        f"&OUTPUTFORMAT=application/json"
        f"&CQL_FILTER=STATUS_VELJAVNOSTI='V' AND ({ids_filter})"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "RealEstateRadar/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        result = {}
        for f in data.get("features", []):
            p = f["properties"]
            eid = str(p.get("EID_DEL_STAVBE", ""))
            if eid:
                result[eid] = p
        return result
    except Exception as e:
        print(f"  WFS ERR: {e}")
        return {}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=200)
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Get all eid_del_stavbe where new columns are NULL
    cur.execute("""
        SELECT eid_del_stavbe FROM ev_del_stavbe
        WHERE etazna_lastnina IS NULL
        ORDER BY eid_del_stavbe
    """)
    all_eids = [row[0] for row in cur.fetchall()]
    total_todo = len(all_eids)
    print(f"Backfilling {total_todo} del_stavbe records...")

    updated = 0
    for i in range(0, total_todo, args.batch):
        batch = all_eids[i:i + args.batch]
        print(f"  Batch [{i}–{i+len(batch)})...", end=" ", flush=True)

        kn_data = fetch_deli_stavb(batch)
        if not kn_data:
            print("no data")
            continue

        rows = []
        for eid in batch:
            p = kn_data.get(eid)
            if not p:
                continue
            rows.append((
                p.get("ETAZNA_LASTNINA"),
                p.get("SKUPNI_DEL_ETAZNA_LASTNINA"),
                str(p["UPRAVNIK_ID"]) if p.get("UPRAVNIK_ID") else None,
                str(p["EID_STANOVANJE"]) if p.get("EID_STANOVANJE") else None,
                p.get("NACIN_DOLOCITVE_POVRSINE_DELA_STAVBE_ID"),
                eid,
            ))

        if rows:
            psycopg2.extras.execute_values(
                cur,
                """
                UPDATE ev_del_stavbe SET
                    etazna_lastnina = data.etazna_lastnina::boolean,
                    skupni_del_etazna_lastnina = data.skupni_del::boolean,
                    upravnik_id = data.upravnik_id,
                    eid_stanovanje = data.eid_stanovanje,
                    nacin_dolocitve_povrsine = data.nacin::int
                FROM (VALUES %s) AS data(etazna_lastnina, skupni_del, upravnik_id, eid_stanovanje, nacin, eid)
                WHERE ev_del_stavbe.eid_del_stavbe = data.eid
                """,
                rows
            )
            conn.commit()
            updated += len(rows)
            print(f"{len(rows)} updated (total {updated})")
        else:
            print("0 matched from WFS")

        time.sleep(0.2)

    print(f"\n✅ Backfill done: {updated}/{total_todo} del_stavbe enriched")
    conn.close()

if __name__ == "__main__":
    main()
