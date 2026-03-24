#!/usr/bin/env python3
"""
download-lidar-tiles.py

Pobere DMR LiDAR tile-e iz CLSS CDN.
Token se avtomatsko bere iz DB (app_config) — refresh-clss-token.ts ga osvezi vsak dan.

Uporaba:
  python3 scripts/download-lidar-tiles.py --out-dir /data/lidar/dmr --workers 4
  python3 scripts/download-lidar-tiles.py --out-dir /data/lidar/dmr --limit 100  # test batch
  python3 scripts/download-lidar-tiles.py --out-dir /data/lidar/dmr --resume     # skip obstoječe
"""

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import psycopg2
import requests

DB_URL = "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"

DOWNLOAD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://lift.clss.si/",
    "Origin": "https://lift.clss.si",
}


def get_token(conn) -> str:
    """Preberi svež token iz DB."""
    with conn.cursor() as cur:
        cur.execute("SELECT value, updated_at FROM app_config WHERE key = 'clss_bearer_token'")
        row = cur.fetchone()
        if not row:
            print("❌ Token ni v DB. Zaženi: npx tsx scripts/refresh-clss-token.ts")
            sys.exit(1)
        token, updated_at = row
        import datetime
        age_hours = (datetime.datetime.now(datetime.timezone.utc) - updated_at).total_seconds() / 3600
        if age_hours > 23:
            print(f"⚠️  Token je {age_hours:.1f}h star — mogoče je expiril! Osveži z refresh-clss-token.ts")
        else:
            print(f"✅ Token pridobljen (star {age_hours:.1f}h)")
        return token


def get_tiles(conn, limit=None):
    """Preberi seznam tile-ov iz DB."""
    with conn.cursor() as cur:
        sql = "SELECT ti_name, link_dmr FROM dmr_download_urls WHERE link_dmr IS NOT NULL"
        if limit:
            sql += f" LIMIT {limit}"
        cur.execute(sql)
        return cur.fetchall()


def download_tile(ti_name: str, url: str, out_dir: Path, headers: dict, resume: bool) -> dict:
    """Prenesi en tile. Vrni status."""
    filename = url.split("/")[-1]
    out_path = out_dir / filename

    if resume and out_path.exists() and out_path.stat().st_size > 0:
        return {"ti_name": ti_name, "status": "skipped", "file": str(out_path)}

    try:
        r = requests.get(url, headers=headers, timeout=60, stream=True)
        if r.status_code == 401:
            return {"ti_name": ti_name, "status": "expired_token", "url": url}
        r.raise_for_status()

        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)

        size_mb = out_path.stat().st_size / 1024 / 1024
        return {"ti_name": ti_name, "status": "ok", "file": str(out_path), "size_mb": round(size_mb, 2)}

    except requests.RequestException as e:
        return {"ti_name": ti_name, "status": "error", "error": str(e), "url": url}


def main():
    parser = argparse.ArgumentParser(description="Download CLSS DMR LiDAR tiles")
    parser.add_argument("--out-dir", default="./lidar-data", help="Output directory")
    parser.add_argument("--workers", type=int, default=4, help="Parallel downloads")
    parser.add_argument("--limit", type=int, default=None, help="Max tiles to download (test mode)")
    parser.add_argument("--resume", action="store_true", help="Skip already downloaded tiles")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(DB_URL)
    token = get_token(conn)

    headers = {**DOWNLOAD_HEADERS, "Authorization": f"Bearer {token}"}

    tiles = get_tiles(conn, args.limit)
    conn.close()

    print(f"📦 {len(tiles)} tile-ov za prenos → {out_dir}")
    print(f"   Workers: {args.workers} | Resume: {args.resume}")

    results = {"ok": 0, "skipped": 0, "error": 0, "expired_token": 0}
    start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(download_tile, ti_name, url, out_dir, headers, args.resume): ti_name
            for ti_name, url in tiles
        }

        for i, future in enumerate(as_completed(futures), 1):
            result = future.result()
            status = result["status"]
            results[status] = results.get(status, 0) + 1

            if status == "expired_token":
                print("\n❌ Token expiril med prenosom! Zaženi refresh-clss-token.ts in ponovni zagon.")
                executor.shutdown(wait=False, cancel_futures=True)
                break

            if i % 100 == 0 or status == "error":
                elapsed = time.time() - start
                rate = i / elapsed * 60
                print(f"  [{i}/{len(tiles)}] {rate:.0f} tile/min | ✅{results['ok']} ⏭️{results['skipped']} ❌{results['error']}")
                if status == "error":
                    print(f"    ERROR: {result.get('error')} — {result.get('url','')[:80]}")

    elapsed = time.time() - start
    print(f"\n=== Done in {elapsed:.0f}s ===")
    print(f"✅ OK:      {results['ok']}")
    print(f"⏭️  Skipped: {results['skipped']}")
    print(f"❌ Errors:  {results['error']}")
    total_size = sum(f.stat().st_size for f in out_dir.glob("*.laz")) / 1024 / 1024 / 1024
    print(f"💾 Skupaj:  {total_size:.1f} GB")


if __name__ == "__main__":
    main()
