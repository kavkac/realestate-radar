#!/usr/bin/env python3
"""
Fast batch SQL enrichment — chunked INSERT SELECT with bounding box spatial filters.
Processes CHUNK stavb per batch, WORKERS parallel connections.
Uses row_number() LIMIT/OFFSET approach to avoid eid gaps.
"""
import os, psycopg2, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_URL = os.environ.get("DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway")

CHUNK = 5000
WORKERS = 8
R_RIVER = 100
R_HERITAGE_SELF = 15
R_HERITAGE_NBHD = 300
R_TRANSIT = 1500

ENRICH_SQL = """
INSERT INTO property_signals (stavba_eid, ko_sifko, signals, signal_dates, signal_sources, created_at, updated_at)
SELECT
    ev.eid_stavba::bigint,
    ev.ko_sifko,
    jsonb_build_object(
        'river_view', (
            SELECT EXISTS(
                SELECT 1 FROM osm_waterways w
                WHERE w.e BETWEEN ev_e - {r_river} AND ev_e + {r_river}
                  AND w.n BETWEEN ev_n - {r_river} AND ev_n + {r_river}
                  AND |/((w.e - ev_e)^2 + (w.n - ev_n)^2) < {r_river}
            )
        ),
        'is_heritage', (
            SELECT EXISTS(
                SELECT 1 FROM osm_heritage h
                WHERE h.e BETWEEN ev_e - {r_hs} AND ev_e + {r_hs}
                  AND h.n BETWEEN ev_n - {r_hs} AND ev_n + {r_hs}
                  AND |/((h.e - ev_e)^2 + (h.n - ev_n)^2) < {r_hs}
            )
        ),
        'heritage_neighborhood_score', (
            SELECT LEAST(count(*), 100)::int FROM osm_heritage h
            WHERE h.e BETWEEN ev_e - {r_hn} AND ev_e + {r_hn}
              AND h.n BETWEEN ev_n - {r_hn} AND ev_n + {r_hn}
              AND |/((h.e - ev_e)^2 + (h.n - ev_n)^2) < {r_hn}
        ),
        'transit_nearest_m', (
            SELECT round(MIN(|/((p.e - ev_e)^2 + (p.n - ev_n)^2)))::int
            FROM osm_poi p
            WHERE p.category = 'transit'
              AND p.e BETWEEN ev_e - {r_tr} AND ev_e + {r_tr}
              AND p.n BETWEEN ev_n - {r_tr} AND ev_n + {r_tr}
              AND |/((p.e - ev_e)^2 + (p.n - ev_n)^2) < {r_tr}
        ),
        'energy_rating', (
            SELECT ec."energyClass" FROM energy_certificates ec
            WHERE ec."koId" = ev.ko_sifko::int
              AND ec."stStavbe" = ev.stev_st::int
              AND ec."energyClass" NOT IN ('N/A','')
            ORDER BY ec."issueDate" DESC NULLS LAST LIMIT 1
        )
    ),
    jsonb_build_object('enriched_at', now()::text),
    jsonb_build_object('all', 'batch_sql_v2'),
    NOW(), NOW()
FROM (
    SELECT eid_stavba, ko_sifko, stev_st,
           round(e::numeric)::int AS ev_e,
           round(n::numeric)::int AS ev_n
    FROM ev_stavba
    WHERE e IS NOT NULL AND n IS NOT NULL
      AND e::numeric BETWEEN 370000 AND 620000
      AND n::numeric BETWEEN 20000 AND 200000
    LIMIT {chunk} OFFSET %(offset)s
) ev
ON CONFLICT (stavba_eid) WHERE stavba_eid IS NOT NULL DO NOTHING
RETURNING stavba_eid;
""".format(r_river=R_RIVER, r_hs=R_HERITAGE_SELF, r_hn=R_HERITAGE_NBHD, r_tr=R_TRANSIT, chunk=CHUNK)

lock = threading.Lock()
total_done = [0]

def process_chunk(offset, worker_id, already_done):
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(ENRICH_SQL, {"offset": offset})
            rows = cur.fetchall()
            inserted = len(rows)
            conn.commit()
        with lock:
            total_done[0] += inserted
            print(f"  [w{worker_id}] offset={offset:>8} → +{inserted:>4}  total={already_done + total_done[0]}", flush=True)
        return inserted
    except Exception as e:
        conn.rollback()
        print(f"  [w{worker_id}] ERROR offset={offset}: {e}", flush=True)
        return 0
    finally:
        conn.close()

def get_counts():
    conn = psycopg2.connect(DB_URL)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM property_signals")
        done = cur.fetchone()[0]
        cur.execute("""SELECT count(*) FROM ev_stavba
            WHERE e IS NOT NULL AND n IS NOT NULL
              AND e::numeric BETWEEN 370000 AND 620000
              AND n::numeric BETWEEN 20000 AND 200000""")
        total = cur.fetchone()[0]
    conn.close()
    return done, total

def main():
    import sys
    start_offset = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    already_done, total = get_counts()
    print(f"📊 Total stavbe with coords: {total}")
    print(f"✅ Already enriched: {already_done}")
    print(f"🚀 Starting at offset={start_offset}, {WORKERS} workers, {CHUNK} per chunk")

    offset = start_offset
    consecutive_empty = 0

    while offset < total:
        offsets = [offset + i * CHUNK for i in range(WORKERS)]
        offset += WORKERS * CHUNK

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(process_chunk, o, i, already_done) for i, o in enumerate(offsets)]
            results = [f.result() for f in futures]

        if sum(results) == 0:
            consecutive_empty += 1
            if consecutive_empty >= 3:
                break
        else:
            consecutive_empty = 0

    final_done, _ = get_counts()
    print(f"\n✅ Done! Total enriched: {final_done} / {total}")

if __name__ == "__main__":
    main()
