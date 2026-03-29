import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

const MONTHS = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "avg", "sep", "okt", "nov", "dec",
];

async function getEizUrl(): Promise<string> {
  const now = new Date();
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const month = MONTHS[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    const url = `https://www.energetika-portal.si/fileadmin/dokumenti/podrocja/energetika/energetske_izkaznice/ei_javni_register_${month}${year}.csv`;
    const res = await fetch(url, { method: "HEAD" });
    if (res.ok) return url;
  }
  throw new Error("EIZ CSV not found for last 3 months");
}

function parseFloat_(val: string): number | null {
  if (!val || val.trim() === "") return null;
  const cleaned = val.replace(",", ".").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseInt_(val: string): number | null {
  if (!val || val.trim() === "") return null;
  const num = parseInt(val.trim(), 10);
  return isNaN(num) ? null : num;
}

function parseDate_(val: string): Date | null {
  if (!val || val.trim() === "") return null;
  // Try DD.MM.YYYY format (common in Slovenian CSVs)
  const dotMatch = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    return new Date(`${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(2, "0")}`);
  }
  // Try ISO format
  const d = new Date(val.trim());
  return isNaN(d.getTime()) ? null : d;
}

async function downloadCsv(url: string): Promise<string> {
  console.log(`Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download CSV: ${res.status} ${res.statusText}`);
  }

  const buffer = await res.arrayBuffer();

  // Try UTF-8 first
  let text = new TextDecoder("utf-8").decode(buffer);

  // If we see garbled characters typical of Windows-1250, try that encoding
  if (text.includes("\ufffd") || text.includes("Å¾")) {
    try {
      text = new TextDecoder("windows-1250").decode(buffer);
    } catch {
      // Stick with UTF-8
    }
  }

  return text;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run") || process.argv.includes("--test");
  const testLimit = isDryRun ? 100 : Infinity;
  if (isDryRun) console.log("Running in DRY-RUN / TEST mode (first 100 rows, no DB writes)");

  const url = process.env.EIZ_CSV_URL || await getEizUrl();
  console.log(`EIZ Import started`);
  console.log(`URL: ${url}`);

  const csvText = await downloadCsv(url);

  const records: string[][] = parse(csvText, {
    delimiter: "|",
    relaxColumnCount: true,
    skipEmptyLines: true,
  });

  // Skip header row
  const dataRows = records.slice(1);
  console.log(`Parsed ${dataRows.length} records`);

  let upserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of dataRows) {
    if (upserted + skipped + errors >= testLimit) break;
    try {
      const certificateId = row[0]?.trim();
      if (!certificateId) {
        skipped++;
        continue;
      }

      const koId = parseInt_(row[3]);
      const stStavbe = parseInt_(row[4]);
      const stDelaStavbe = parseInt_(row[5]);
      if (koId == null || stStavbe == null) {
        skipped++;
        continue;
      }

      const issueDate = parseDate_(row[1]);
      const validUntil = parseDate_(row[2]);
      if (!issueDate || !validUntil) {
        skipped++;
        continue;
      }

      // Column mapping (0-indexed, pipe-separated):
      // 6: Tip izkaznice → type
      // 7: Potrebna toplota → heatingNeed
      // 8: Dovedena energija → deliveredEnergy
      // 9: Celotna energija → totalEnergy
      // 10: Dovedena električna → electricEnergy
      // 11: Primarna energija → primaryEnergy
      // 12: Emisije CO2 → co2Emissions
      // 13: Kondicionirana površina → conditionedArea
      // 14: Energijski razred → energyClass
      const type = row[6]?.trim() || null;
      const energyClass = row[14]?.trim();
      if (!energyClass) {
        skipped++;
        continue;
      }

      if (isDryRun) {
        console.log(`[DRY-RUN] ${certificateId} | type=${type} | energyClass=${energyClass} | area=${row[13]?.trim()}`);
        upserted++;
        continue;
      }

      // Make cert ID unique per unit: "certId__stDela" or "certId__0" for building-level
      const uniqueCertId = stDelaStavbe != null ? `${certificateId}__${stDelaStavbe}` : `${certificateId}__0`;
      // Use raw SQL INSERT ... ON CONFLICT DO UPDATE to avoid needing a specific DB constraint
      await prisma.$executeRaw`
        INSERT INTO energy_certificates (id, "certificateId", "koId", "stStavbe", "stDelaStavbe",
          "issueDate", "validUntil", "energyClass", type,
          "heatingNeed", "deliveredEnergy", "totalEnergy", "electricEnergy",
          "primaryEnergy", "co2Emissions", "conditionedArea", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${uniqueCertId}, ${koId}, ${stStavbe}, ${stDelaStavbe},
          ${issueDate}, ${validUntil}, ${energyClass ?? ""}, ${type},
          ${parseFloat_(row[7])}, ${parseFloat_(row[8])}, ${parseFloat_(row[9])}, ${parseFloat_(row[10])},
          ${parseFloat_(row[11])}, ${parseFloat_(row[12])}, ${parseFloat_(row[13])},
          NOW(), NOW())
        ON CONFLICT ("koId", "stStavbe", "stDelaStavbe") DO UPDATE SET
          "certificateId" = EXCLUDED."certificateId",
          "koId" = EXCLUDED."koId",
          "stStavbe" = EXCLUDED."stStavbe",
          "stDelaStavbe" = EXCLUDED."stDelaStavbe",
          "issueDate" = EXCLUDED."issueDate",
          "validUntil" = EXCLUDED."validUntil",
          "energyClass" = EXCLUDED."energyClass",
          "type" = EXCLUDED."type",
          "heatingNeed" = EXCLUDED."heatingNeed",
          "deliveredEnergy" = EXCLUDED."deliveredEnergy",
          "totalEnergy" = EXCLUDED."totalEnergy",
          "electricEnergy" = EXCLUDED."electricEnergy",
          "primaryEnergy" = EXCLUDED."primaryEnergy",
          "co2Emissions" = EXCLUDED."co2Emissions",
          "conditionedArea" = EXCLUDED."conditionedArea",
          "updatedAt" = NOW()
      `;

      upserted++;
      if (upserted % 1000 === 0) {
        console.log(`Progress: ${upserted} upserted, ${skipped} skipped, ${errors} errors`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`Error on row: ${(err as Error).message}`);
      }
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Upserted: ${upserted}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
