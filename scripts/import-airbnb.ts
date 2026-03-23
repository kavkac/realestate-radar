/**
 * Inside Airbnb Ljubljana Import Script
 *
 * Downloads Inside Airbnb Ljubljana dataset and imports into DB.
 * Source: http://data.insideairbnb.com/slovenia/osrednjeslovenska/ljubljana/
 *
 * Usage: DATABASE_URL=... npx tsx scripts/import-airbnb.ts
 */

import { createWriteStream } from "fs";
import { mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Inside Airbnb Ljubljana data URLs (try in order - newer first)
const AIRBNB_URLS = [
  "http://data.insideairbnb.com/slovenia/osrednjeslovenska/ljubljana/2024-09-27/data/listings.csv.gz",
  "http://data.insideairbnb.com/slovenia/osrednjeslovenska/ljubljana/2024-06-23/data/listings.csv.gz",
  "http://data.insideairbnb.com/slovenia/osrednjeslovenska/ljubljana/2024-03-23/data/listings.csv.gz",
];

async function createTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS airbnb_listings (
      id BIGINT PRIMARY KEY,
      lat FLOAT NOT NULL,
      lng FLOAT NOT NULL,
      price_night FLOAT,
      room_type TEXT,
      availability_365 INT,
      reviews_per_month FLOAT,
      minimum_nights INT,
      imported_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS airbnb_listings_latlng ON airbnb_listings (lat, lng);
  `);
  console.log("Table airbnb_listings ready");
}

async function downloadGzipped(url: string, destPath: string): Promise<boolean> {
  console.log(`Trying: ${url}`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RealEstateRadar/1.0 research@realestate-radar.si" },
    });
    if (!res.ok) {
      console.log(`  Failed: ${res.status} ${res.statusText}`);
      return false;
    }
    const fileStream = createWriteStream(destPath);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);
    console.log(`  Downloaded to: ${destPath}`);
    return true;
  } catch (err) {
    console.log(`  Error: ${(err as Error).message}`);
    return false;
  }
}

async function decompressGzip(gzPath: string, outPath: string): Promise<void> {
  const { createReadStream } = await import("fs");
  const input = createReadStream(gzPath);
  const output = createWriteStream(outPath);
  const gunzip = createGunzip();
  await pipeline(input, gunzip, output);
}

function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null;
  // Format: "$123.00" or "123.00" or "$1,234.00"
  const cleaned = priceStr.replace(/[$,]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseFloat_(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const num = parseFloat(val.trim());
  return isNaN(num) ? null : num;
}

function parseInt_(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const num = parseInt(val.trim(), 10);
  return isNaN(num) ? null : num;
}

async function main() {
  console.log("Airbnb Import started");

  await createTable();

  const tmpDir = join(tmpdir(), `airbnb-import-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const gzPath = join(tmpDir, "listings.csv.gz");
  const csvPath = join(tmpDir, "listings.csv");

  try {
    // Try downloading from each URL until one succeeds
    let downloaded = false;
    for (const url of AIRBNB_URLS) {
      downloaded = await downloadGzipped(url, gzPath);
      if (downloaded) break;
    }

    if (!downloaded) {
      throw new Error("Failed to download from all URLs");
    }

    // Decompress
    console.log("Decompressing...");
    await decompressGzip(gzPath, csvPath);

    // Parse CSV
    console.log("Parsing CSV...");
    const csvContent = await readFile(csvPath, "utf-8");
    const records = parse(csvContent, {
      columns: true,
      skipEmptyLines: true,
      relaxColumnCount: true,
      trim: true,
    }) as Record<string, string>[];

    console.log(`Parsed ${records.length} records`);

    // Upsert into DB
    let upserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of records) {
      try {
        const id = parseInt_(row.id);
        const lat = parseFloat_(row.latitude);
        const lng = parseFloat_(row.longitude);

        // Skip rows with missing essential data
        if (!id || lat == null || lng == null) {
          skipped++;
          continue;
        }

        const priceNight = parsePrice(row.price);
        const roomType = row.room_type || null;
        const availability365 = parseInt_(row.availability_365);
        const reviewsPerMonth = parseFloat_(row.reviews_per_month);
        const minimumNights = parseInt_(row.minimum_nights);

        await pool.query(
          `INSERT INTO airbnb_listings (id, lat, lng, price_night, room_type, availability_365, reviews_per_month, minimum_nights, imported_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id) DO UPDATE SET
             lat = EXCLUDED.lat,
             lng = EXCLUDED.lng,
             price_night = EXCLUDED.price_night,
             room_type = EXCLUDED.room_type,
             availability_365 = EXCLUDED.availability_365,
             reviews_per_month = EXCLUDED.reviews_per_month,
             minimum_nights = EXCLUDED.minimum_nights,
             imported_at = NOW()`,
          [id, lat, lng, priceNight, roomType, availability365, reviewsPerMonth, minimumNights]
        );

        upserted++;
        if (upserted % 500 === 0) {
          console.log(`  Progress: ${upserted} upserted, ${skipped} skipped, ${errors} errors`);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.error(`  Error on row: ${(err as Error).message}`);
        }
      }
    }

    console.log(`\nImport complete:`);
    console.log(`  Upserted: ${upserted}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Errors:   ${errors}`);
  } finally {
    // Cleanup temp files
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
