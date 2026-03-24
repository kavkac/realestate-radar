/**
 * scrape-listings-nlp.ts
 *
 * Pobere opise oglasov iz listings_oglasi kjer opis IS NULL,
 * parsira z listing-nlp.ts in shrani nlp_signals v DB.
 *
 * Za izvajanje:
 *   DATABASE_URL=... npx ts-node scripts/scrape-listings-nlp.ts
 *
 * Scraping strategy: Playwright headless browser (Cloudflare bypass)
 * Portal: nepremicnine.net (primarni), bolha.com (sekundarni)
 */

import { PrismaClient } from "@prisma/client";
import { parseListingText } from "../lib/listing-nlp";

const prisma = new PrismaClient();

// ── Scraper za nepremicnine.net ───────────────────────────────────────────────

async function scrapeNepremicnine(url: string): Promise<string | null> {
  // Playwright headless — zaobide Cloudflare
  // Requires: npx playwright install chromium
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    // Poišči opis
    const opis = await page.evaluate(() => {
      const el = document.querySelector("#opis_text, .opis_text, [id*=opis]");
      if (el) return (el as HTMLElement).innerText;
      // Fallback: najdi besedilo po "Dodaten opis"
      const all = document.body.innerText;
      const idx = all.indexOf("Dodaten opis nepremičnine");
      if (idx > 0) return all.slice(idx, idx + 3000);
      return null;
    });
    
    await browser.close();
    return opis as string | null;
  } catch (e) {
    console.error(`Scrape failed for ${url}:`, e);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Poberi oglase brez opisa (max 100 na run)
  const oglasi = await prisma.$queryRawUnsafe<
    { id: number; url: string; portal: string }[]
  >(
    `SELECT id, url, portal FROM listings_oglasi
     WHERE opis IS NULL AND url IS NOT NULL
     AND portal = 'nepremicnine.net'
     LIMIT 100`
  );

  console.log(`Processing ${oglasi.length} listings...`);
  let ok = 0;

  for (const oglas of oglasi) {
    try {
      const opis = await scrapeNepremicnine(oglas.url);
      if (!opis || opis.length < 50) {
        console.log(`SKIP ${oglas.id}: no description`);
        continue;
      }

      const signals = parseListingText(opis);

      await prisma.$executeRawUnsafe(
        `UPDATE listings_oglasi SET opis = $1, nlp_signals = $2::jsonb WHERE id = $3`,
        opis.slice(0, 5000),
        JSON.stringify(signals),
        oglas.id
      );

      console.log(`OK ${oglas.id} | pogled=${signals.pogled} | tc=${signals.toplotnaCarpalka} | delta confidence=${signals.confidence.toFixed(2)}`);
      ok++;
      await new Promise(r => setTimeout(r, 500)); // rate limit
    } catch (e) {
      console.error(`ERR ${oglas.id}:`, e);
    }
  }

  console.log(`\nDone: ${ok}/${oglasi.length} scraped`);
  await prisma.$disconnect();
}

main().catch(console.error);
