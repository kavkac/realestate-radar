#!/usr/bin/env python3
"""
Property Signals Enrichment Pipeline
Populates property_signals.signals JSONB per stavba with:
  - river_view: bool           (within 100m of OSM waterway)
  - is_heritage: bool          (stavba itself is heritage object, within 15m)
  - heritage_neighborhood_score: int 0-100 (heritage objects within 300m — premium neighborhood)
  - transit_nearest_m: int     (meters to nearest transit stop)
  - energy_rating: str|null    ('A+','A','B'... from EIZ, else null)
  - energy_source: str         ('eiz' | 'missing')

Prereq: run import-osm-waterways.py first for river_view signal.
All spatial data uses D-96/TM integer coordinates (e, n) — same CRS as ev_stavba, osm_poi, osm_heritage.

Usage:
  python enrich-property-signals.py [--limit N] [--offset N] [--dry-run]
"""

import os
import sys
import json
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone

DB_URL = os.environ.get("DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway")

RIVER_VIEW_RADIUS_M      = 100
HERITAGE_SELF_RADIUS_M   = 15
HERITAGE_NBHD_RADIUS_M   = 300
TRANSIT_MAX_RADIUS_M     = 1500
BATCH_SIZE               = 500


def check_waterways(cur):
    cur.execute("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='osm_waterways')")
    exists = cur.fetchone()[0]
    if exists:
        cur.execute("SELECT count(*) FROM osm_waterways")
        cnt = cur.fetchone()[0]
        return cnt > 0
    return False


def enrich_stavba(cur, eid, ko_sifko, stev_st, e, n):
    """Return (signals, signal_dates, signal_sources) dicts for one stavba."""
    signals = {}
    dates = {}
    sources = {}
    now = datetime.now(timezone.utc).isoformat()

    def set_signal(key, val, src):
        signals[key] = val
        dates[key] = now
        sources[key] = src

    # --- river_view ---
    cur.execute("""
        SELECT EXISTS(
            SELECT 1 FROM osm_waterways
            WHERE |/((e-%s)^2 + (n-%s)^2) < %s
            LIMIT 1
        )
    """, (e, n, RIVER_VIEW_RADIUS_M))
    set_signal("river_view", cur.fetchone()[0], "osm_waterways")

    # --- is_heritage + heritage_neighborhood_score ---
    cur.execute("""
        SELECT
            COUNT(*) FILTER (WHERE |/((e-%s)^2 + (n-%s)^2) < %s) AS is_self,
            COUNT(*) FILTER (WHERE |/((e-%s)^2 + (n-%s)^2) < %s) AS nbhd
        FROM osm_heritage
        WHERE |/((e-%s)^2 + (n-%s)^2) < %s
    """, (
        e, n, HERITAGE_SELF_RADIUS_M,
        e, n, HERITAGE_NBHD_RADIUS_M,
        e, n, HERITAGE_NBHD_RADIUS_M
    ))
    row = cur.fetchone()
    set_signal("is_heritage", (row[0] > 0) if row else False, "osm_heritage")
    set_signal("heritage_neighborhood_score", min(int(row[1]) if row else 0, 100), "osm_heritage")

    # --- transit_nearest_m ---
    cur.execute("""
        SELECT MIN(|/((e-%s)^2 + (n-%s)^2))
        FROM osm_poi
        WHERE category = 'transit'
          AND |/((e-%s)^2 + (n-%s)^2) < %s
    """, (e, n, e, n, TRANSIT_MAX_RADIUS_M))
    row = cur.fetchone()
    val = round(row[0]) if row and row[0] is not None else None
    set_signal("transit_nearest_m", val, "osm_poi")

    # --- energy_rating ---
    cur.execute("""
        SELECT "energyClass"
        FROM energy_certificates
        WHERE "koId" = %s AND "stStavbe" = %s
          AND "energyClass" IS NOT NULL
          AND "energyClass" NOT IN ('', 'N/A')
        ORDER BY "issueDate" DESC NULLS LAST
        LIMIT 1
    """, (int(ko_sifko), int(stev_st)))
    row = cur.fetchone()
    if row:
        set_signal("energy_rating", row[0], "eiz")
    else:
        set_signal("energy_rating", None, "missing")

    return signals, dates, sources


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only-empty", action="store_true", help="Only enrich stavbe with no existing signals")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur2 = conn.cursor()

    has_waterways = check_waterways(cur2)
    if not has_waterways:
        print("⚠️  osm_waterways missing or empty — river_view will be False. Run import-osm-waterways.py first.")

    print("📦 Loading stavbe with coordinates...")
    query = """
        SELECT eid_stavba::bigint as eid, ko_sifko, stev_st, round(e::numeric)::int as e, round(n::numeric)::int as n
        FROM ev_stavba
        WHERE e IS NOT NULL AND n IS NOT NULL
          AND e::numeric > 0 AND n::numeric > 0
    """
    if args.only_empty:
        query += " AND eid_stavba::bigint NOT IN (SELECT stavba_eid FROM property_signals WHERE stavba_eid IS NOT NULL)"
    query += f" OFFSET {args.offset}"
    if args.limit:
        query += f" LIMIT {args.limit}"

    cur.execute(query)
    stavbe = cur.fetchall()
    total = len(stavbe)
    print(f"  → {total} stavb to enrich")

    processed = 0
    errors = 0

    for i in range(0, total, BATCH_SIZE):
        batch = stavbe[i:i+BATCH_SIZE]
        for row in batch:
            try:
                signals, dates, srcs = enrich_stavba(
                    cur2, row["eid"], row["ko_sifko"], row["stev_st"], row["e"], row["n"]
                )
                if not args.dry_run:
                    cur2.execute("""
                        INSERT INTO property_signals (stavba_eid, ko_sifko, signals, signal_dates, signal_sources, created_at, updated_at)
                        VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, NOW(), NOW())
                        ON CONFLICT (stavba_eid) WHERE stavba_eid IS NOT NULL DO UPDATE SET
                            signals       = property_signals.signals       || EXCLUDED.signals,
                            signal_dates  = property_signals.signal_dates  || EXCLUDED.signal_dates,
                            signal_sources= property_signals.signal_sources|| EXCLUDED.signal_sources,
                            updated_at    = NOW()
                    """, (
                        row["eid"], row["ko_sifko"],
                        json.dumps(signals), json.dumps(dates), json.dumps(srcs)
                    ))
                processed += 1
            except Exception as ex:
                errors += 1
                if errors <= 5:
                    print(f"  ⚠️  Error on eid {row['eid']}: {ex}")

        if not args.dry_run:
            conn.commit()

        pct = (i + len(batch)) / total * 100
        print(f"  [{pct:.0f}%] {i+len(batch)}/{total} — errors: {errors}")

    if args.dry_run:
        print(f"🔍 Dry run complete. Would enrich {processed} stavb.")
    else:
        conn.commit()
        print(f"✅ Done: {processed} enriched, {errors} errors")

    conn.close()


if __name__ == "__main__":
    main()
