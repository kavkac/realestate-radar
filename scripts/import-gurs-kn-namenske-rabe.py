#!/usr/bin/env python3
"""
import-gurs-kn-namenske-rabe.py

Bulk import NAMENSKE_RABE iz GURS KN WFS → kn_namenske_rabe tabela.
Atributi: NAMENSKA_RABA_ID, PODROBNA_NAMENSKA_RABA_ID, sifra, naziv_sl, geometry

Pogon:
  python3 scripts/import-gurs-kn-namenske-rabe.py
"""

import urllib.request, json, os, time, argparse
import psycopg2, psycopg2.extras

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

WFS_BASE = "https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs"
TYPENAME = "SI.GURS.KN:NAMENSKE_RABE"

# Šifrant: osnovna namenska raba
NAMENSKA_RABA = {
    1: "Stanovanjska",
    2: "Mešana",
    3: "Centralna",
    4: "Gospodarska/industrijska",
    5: "Zelene površine",
    6: "Prometna",
    7: "Komunalna",
    8: "Kmetijska",
    9: "Gozdna",
    10: "Voda",
    11: "Ostalo",
}

def ensure_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS kn_namenske_rabe (
          featureid              text PRIMARY KEY,
          namenska_raba_id       int,
          namenska_raba_naziv    text,
          podrobna_raba_id       int,
          podrobna_raba_sifra    text,
          podrobna_raba_naziv    text,
          vir_ident              text,
          datum_sys              timestamptz,
          geom                   jsonb,   -- polygon EPSG:3794
          imported_at            timestamptz DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS kn_nr_raba_idx ON kn_namenske_rabe(namenska_raba_id);
        CREATE INDEX IF NOT EXISTS kn_nr_podrobna_idx ON kn_namenske_rabe(podrobna_raba_sifra);
    """)
    conn.commit()
    print("Table kn_namenske_rabe ready")

def wfs_url(start: int, count: int) -> str:
    # No STATUS_VELJAVNOSTI filter — NAMENSKE_RABE doesn't have that column
    return (
        f"{WFS_BASE}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
        f"&TYPENAMES={TYPENAME}"
        f"&OUTPUTFORMAT=application/json"
        f"&COUNT={count}&STARTINDEX={start}"
        f"&SRSNAME=EPSG:3794"
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
        fid = p.get("FEATUREID")
        if not fid:
            continue
        nr_id = p.get("NAMENSKA_RABA_ID")
        rows.append((
            str(fid),
            nr_id,
            NAMENSKA_RABA.get(nr_id) if nr_id else None,
            p.get("PODROBNA_NAMENSKA_RABA_ID"),
            p.get("PODROBNE_NAMENSKE_RABE_SIFRA"),
            p.get("PODROBNE_NAMENSKE_RABE_NAZIV_SL"),
            p.get("VIR_IDENT"),
            p.get("DATUM_SYS"),
            json.dumps(f.get("geometry")) if f.get("geometry") else None,
        ))
    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, """
        INSERT INTO kn_namenske_rabe (
            featureid, namenska_raba_id, namenska_raba_naziv,
            podrobna_raba_id, podrobna_raba_sifra, podrobna_raba_naziv,
            vir_ident, datum_sys, geom
        ) VALUES %s
        ON CONFLICT (featureid) DO UPDATE SET
            namenska_raba_id  = EXCLUDED.namenska_raba_id,
            podrobna_raba_sifra = EXCLUDED.podrobna_raba_sifra,
            geom              = EXCLUDED.geom,
            imported_at       = NOW()
    """, rows)
    conn.commit()
    return len(rows)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=20000)
    parser.add_argument("--start", type=int, default=0)
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    ensure_table(conn)
    print(f"Importing NAMENSKE_RABE (batch={args.batch})...")

    total = 0
    start = args.start

    while True:
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

    print(f"\n✅ NAMENSKE_RABE import done: {total} območij")
    conn.close()

if __name__ == "__main__":
    main()
