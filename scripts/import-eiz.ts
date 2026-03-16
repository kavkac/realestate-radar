import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

const MONTHS = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "avg", "sep", "okt", "nov", "dec",
];

function getEizUrl(): string {
  const now = new Date();
  const month = MONTHS[now.getMonth()];
  const year = String(now.getFullYear()).slice(-2);
  return `https://www.energetika-portal.si/fileadmin/dokumenti/podrocja/energetika/energetske_izkaznice/ei_javni_register_${month}${year}.csv`;
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
  const url = process.env.EIZ_CSV_URL || getEizUrl();
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
    try {
      const certificateId = row[0]?.trim();
      if (!certificateId) {
        skipped++;
        continue;
      }

      const koId = parseInt_(row[3]);
      const stStavbe = parseInt_(row[4]);
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

      const energyClass = row[6]?.trim();
      if (!energyClass) {
        skipped++;
        continue;
      }

      await prisma.energyCertificate.upsert({
        where: { certificateId },
        update: {
          koId,
          stStavbe,
          stDelaStavbe: parseInt_(row[5]),
          issueDate,
          validUntil,
          energyClass,
          type: row[7]?.trim() || null,
          heatingNeed: parseFloat_(row[8]),
          deliveredEnergy: parseFloat_(row[9]),
          totalEnergy: parseFloat_(row[10]),
          electricEnergy: parseFloat_(row[11]),
          primaryEnergy: parseFloat_(row[12]),
          co2Emissions: parseFloat_(row[13]),
          conditionedArea: parseFloat_(row[14]),
        },
        create: {
          certificateId,
          koId,
          stStavbe,
          stDelaStavbe: parseInt_(row[5]),
          issueDate,
          validUntil,
          energyClass,
          type: row[7]?.trim() || null,
          heatingNeed: parseFloat_(row[8]),
          deliveredEnergy: parseFloat_(row[9]),
          totalEnergy: parseFloat_(row[10]),
          electricEnergy: parseFloat_(row[11]),
          primaryEnergy: parseFloat_(row[12]),
          co2Emissions: parseFloat_(row[13]),
          conditionedArea: parseFloat_(row[14]),
        },
      });

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
