import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createWriteStream, existsSync } from "fs";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

/**
 * KN Namembnost Import Pipeline
 *
 * Prenese bulk KN STAVBE ZIP iz uradnega GURS portala (ipi.eprostor.gov.si/jgp),
 * poišče CSV z deli stavb in upserta namembnost v tabelo deli_stavb_namembnost.
 *
 * API flow:
 *   1. GET /jgp-service-api/display-views/groups/121/composite-products/14/file?filterParam=DRZAVA&filterValue=1
 *      → vrne signed URL za KN_SLO_STAVBE_SLO_YYYYMMDD.zip (~666MB)
 *   2. Download ZIP
 *   3. Unzip → najdi *_deli_stavb_*.csv
 *   4. Parse CSV, upsert po EID_DEL_STAVBE
 *
 * CSV format: UTF-8, delimiter comma
 * Key columns: EID_DEL_STAVBE, VRSTA_DEJANSKE_RABE_DEL_ST_ID
 */

const JGP_API = "https://ipi.eprostor.gov.si/jgp-service-api";
const GROUP_ID = 121;
const DISPLAY_COMPOSITE_ID = 14;
const FILTER_PARAM = "DRZAVA";
const FILTER_VALUE = "1";

const BATCH_SIZE = 1000;

const prisma = new PrismaClient();

function parseInt_(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const num = parseInt(val.trim(), 10);
  return isNaN(num) ? null : num;
}

async function getSignedDownloadUrl(): Promise<string> {
  const url = `${JGP_API}/display-views/groups/${GROUP_ID}/composite-products/${DISPLAY_COMPOSITE_ID}/file?filterParam=${FILTER_PARAM}&filterValue=${FILTER_VALUE}`;
  console.log(`Fetching signed URL from: ${url}`);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to get signed URL: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { url: string };
  if (!data.url) {
    throw new Error(`No URL in response: ${JSON.stringify(data)}`);
  }
  console.log(`Got signed URL (expires soon)`);
  return data.url;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`Downloading to: ${destPath}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const mb = Math.round(parseInt(contentLength) / 1024 / 1024);
    console.log(`File size: ${mb}MB`);
  }
  const fileStream = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);
  console.log(`Download complete`);
}

async function extractAndFindCsv(zipPath: string, destDir: string): Promise<string> {
  const { execSync } = await import("child_process");
  console.log(`Extracting ZIP...`);
  execSync(`unzip -o "${zipPath}" "*.csv" -d "${destDir}" 2>/dev/null || unzip -o "${zipPath}" -d "${destDir}"`, {
    maxBuffer: 10 * 1024 * 1024,
  });

  // Najdi *_deli_stavb_*.csv
  const { readdir } = await import("fs/promises");
  const files = await readdir(destDir, { recursive: true });
  const deliStavbCsv = (files as string[]).find(
    (f) => f.toLowerCase().includes("deli_stavb") && f.toLowerCase().endsWith(".csv")
  );

  if (!deliStavbCsv) {
    // Izpiši vse CSV datoteke za debug
    const csvFiles = (files as string[]).filter((f) => f.toLowerCase().endsWith(".csv"));
    console.error(`Available CSV files: ${csvFiles.join(", ")}`);
    throw new Error(`deli_stavb CSV not found in ZIP!`);
  }

  const csvPath = join(destDir, deliStavbCsv);
  console.log(`Found: ${csvPath}`);
  return csvPath;
}

async function importCsv(csvPath: string): Promise<void> {
  console.log(`Parsing CSV...`);
  const buffer = await readFile(csvPath);
  const text = new TextDecoder("utf-8").decode(buffer);

  const records = parse(text, {
    delimiter: ",",
    columns: true,
    skipEmptyLines: true,
    relaxColumnCount: true,
    trim: true,
  }) as Record<string, string>[];

  console.log(`Total records: ${records.length.toLocaleString()}`);

  // Preveri da so pravi stolpci
  if (records.length > 0) {
    const firstRec = records[0];
    if (!("EID_DEL_STAVBE" in firstRec)) {
      throw new Error(`Missing EID_DEL_STAVBE column. Available: ${Object.keys(firstRec).join(", ")}`);
    }
    if (!("VRSTA_DEJANSKE_RABE_DEL_ST_ID" in firstRec)) {
      console.warn(`VRSTA_DEJANSKE_RABE_DEL_ST_ID column not found, will store null.`);
    }
  }

  let processed = 0;
  let skipped = 0;

  // Batch upsert
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const data = batch
      .map((r) => ({
        eidDelStavbe: r["EID_DEL_STAVBE"]?.trim(),
        vrstaNamembnosti: parseInt_(r["VRSTA_DEJANSKE_RABE_DEL_ST_ID"]),
      }))
      .filter((d) => d.eidDelStavbe && d.eidDelStavbe.length > 0);

    if (data.length === 0) {
      skipped += batch.length;
      continue;
    }

    await prisma.$transaction(
      data.map((d) =>
        prisma.deliStavbNamembnost.upsert({
          where: { eidDelStavbe: d.eidDelStavbe },
          update: { vrstaNamembnosti: d.vrstaNamembnosti },
          create: d,
        })
      )
    );

    processed += data.length;
    skipped += batch.length - data.length;

    if (processed % 50000 === 0 || i + BATCH_SIZE >= records.length) {
      const pct = Math.round(((i + BATCH_SIZE) / records.length) * 100);
      console.log(`Progress: ${processed.toLocaleString()} upserted, ${skipped} skipped (${pct}%)`);
    }
  }

  console.log(`Import complete: ${processed.toLocaleString()} records upserted`);
}

async function main() {
  console.log("=== KN Namembnost Import ===");

  const tmpDir = join(tmpdir(), `kn-namembnost-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const zipPath = join(tmpDir, "KN_SLO_STAVBE_SLO.zip");

  try {
    // 1. Pridobi signed URL
    const downloadUrl = await getSignedDownloadUrl();

    // 2. Download ZIP
    await downloadFile(downloadUrl, zipPath);

    // 3. Ekstrahiraj in najdi CSV
    const csvPath = await extractAndFindCsv(zipPath, tmpDir);

    // 4. Import v bazo
    await importCsv(csvPath);
  } finally {
    await prisma.$disconnect();
    // Cleanup
    const { rm } = await import("fs/promises");
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.log("Temp files cleaned up.");
  }
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
