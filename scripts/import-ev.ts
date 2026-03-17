import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

// TODO: Replace with the actual GURS EV download URL once confirmed.
// The EV (Evidenca vrednotenja) CSV is distributed by GURS via the JGP portal:
//   https://jgp.eprostor.gov.si/jgp/ → Nepremičnine → Evidenca vrednotenja
// Expected format: ZIP archive containing CSV file(s) with pipe (|) or semicolon delimiter.
// Fields of interest: EID_DEL_STAVBE, POSPLOSENA_VREDNOST, VREDNOST_NA_M2, ID_MODEL,
//                     LETO_IZGRADNJE, POVRSINA
//
// Alternative manual download path:
//   https://egp.gu.gov.si/egp/ → Evidenca vrednotenja nepremičnin
//
// Set env variable EV_CSV_URL to override.
const EV_CSV_URL =
  process.env.EV_CSV_URL ||
  "https://egp.gu.gov.si/egp/products/EvidencaVrednotenjaCSV/EV_DEL_STAVBE.zip";

const prisma = new PrismaClient();

function parseFloat_(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const cleaned = val.replace(",", ".").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseInt_(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const num = parseInt(val.trim(), 10);
  return isNaN(num) ? null : num;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }
  const fileStream = createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);
  console.log(`Downloaded to: ${destPath}`);
}

async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  // Use system unzip command
  const { execSync } = await import("child_process");
  execSync(`unzip -o "${zipPath}" -d "${destDir}"`);
  const { readdir } = await import("fs/promises");
  const files = await readdir(destDir);
  return files
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => join(destDir, f));
}

async function parseCsvFile(filePath: string): Promise<Record<string, string>[]> {
  const { readFile } = await import("fs/promises");
  let buffer = await readFile(filePath);

  // Try UTF-8 first, fallback to windows-1250
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.includes("\ufffd")) {
    try {
      text = new TextDecoder("windows-1250").decode(buffer);
    } catch {
      // Keep UTF-8
    }
  }

  // Auto-detect delimiter: try semicolon and pipe
  const firstLine = text.split("\n")[0] || "";
  const delimiter = firstLine.includes(";") ? ";" : firstLine.includes("|") ? "|" : ";";

  const records = parse(text, {
    delimiter,
    columns: true,
    skipEmptyLines: true,
    relaxColumnCount: true,
    trim: true,
  }) as Record<string, string>[];

  return records;
}

async function main() {
  const url = EV_CSV_URL;
  console.log(`EV Import started`);
  console.log(`URL: ${url}`);

  const tmpDir = join(tmpdir(), `ev-import-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const zipPath = join(tmpDir, "ev.zip");

  try {
    await downloadFile(url, zipPath);

    console.log("Extracting ZIP...");
    const csvFiles = await extractZip(zipPath, tmpDir);
    console.log(`Found CSV files: ${csvFiles.join(", ")}`);

    if (csvFiles.length === 0) {
      throw new Error("No CSV files found in ZIP archive");
    }

    let totalUpserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const csvFile of csvFiles) {
      console.log(`\nProcessing: ${csvFile}`);
      const records = await parseCsvFile(csvFile);
      console.log(`Parsed ${records.length} records`);

      let upserted = 0;
      let skipped = 0;
      let errors = 0;

      for (const row of records) {
        try {
          // Field name mapping — handles common GURS CSV column naming conventions
          const eidDelStavbe =
            row["EID_DEL_STAVBE"] ||
            row["eid_del_stavbe"] ||
            row["EID_DEL_STAVB"] ||
            "";

          if (!eidDelStavbe) {
            skipped++;
            continue;
          }

          const posplosenaVrednost =
            parseFloat_(row["POSPLOSENA_VREDNOST"] ?? row["posplosena_vrednost"]);
          const vrednostNaM2 =
            parseFloat_(row["VREDNOST_NA_M2"] ?? row["vrednost_na_m2"] ?? row["VREDNOST_M2"]);
          const idModel =
            row["ID_MODEL"] || row["id_model"] || row["MODEL"] || null;
          const letoIzgradnje =
            parseInt_(row["LETO_IZGRADNJE"] ?? row["leto_izgradnje"] ?? row["LETO_IZG"]);
          const povrsina =
            parseFloat_(row["POVRSINA"] ?? row["povrsina"] ?? row["POVRŠINA"] ?? row["POVR"]);

          await prisma.evidencaVrednotenja.upsert({
            where: { eidDelStavbe },
            update: {
              posplosenaVrednost,
              vrednostNaM2,
              idModel,
              letoIzgradnje,
              povrsina,
            },
            create: {
              eidDelStavbe,
              posplosenaVrednost,
              vrednostNaM2,
              idModel,
              letoIzgradnje,
              povrsina,
            },
          });

          upserted++;
          if (upserted % 1000 === 0) {
            console.log(
              `  Progress: ${upserted} upserted, ${skipped} skipped, ${errors} errors`
            );
          }
        } catch (err) {
          errors++;
          if (errors <= 5) {
            console.error(`  Error on row: ${(err as Error).message}`);
          }
        }
      }

      console.log(`  File done: ${upserted} upserted, ${skipped} skipped, ${errors} errors`);
      totalUpserted += upserted;
      totalSkipped += skipped;
      totalErrors += errors;
    }

    console.log(`\nImport complete:`);
    console.log(`  Upserted: ${totalUpserted}`);
    console.log(`  Skipped:  ${totalSkipped}`);
    console.log(`  Errors:   ${totalErrors}`);
  } finally {
    // Cleanup temp files
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
