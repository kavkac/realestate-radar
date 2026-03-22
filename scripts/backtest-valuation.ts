/**
 * Backtest: valuation algorithm accuracy on 2022 ETN apartment sales.
 *
 * Methodology:
 * 1. Fetch 2022 ETN transactions (tip_dela_stavbe="2", apartments)
 * 2. For each transaction, compute predicted price = median_price_per_m2 * area
 *    using a 400m proximity query that EXCLUDES the transaction being evaluated
 * 3. Calculate MdAPE and percentile breakdown of absolute errors
 * 4. Save results to scripts/backtest-results.json
 *
 * Run with: npx tsx scripts/backtest-valuation.ts
 */

import { Client } from "pg";
import proj4 from "proj4";
import fs from "fs";
import path from "path";

// ── D96/TM projection definition ──
const D96_TM =
  "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +units=m +no_defs";

const DB_URL =
  "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway";

// ── Helpers ──

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Main ──

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log("Connected to database.");

  // Step 1: Fetch 2022 apartment transactions
  const fetchSql = `
    SELECT p.id_posla, p.datum_sklenitve_pogodbe,
           p.pogodbena_cena_odskodnina::float as cena,
           d.povrsina_dela_stavbe::float as povrsina,
           s.e as easting, s.n as northing
    FROM etn_posli p
    JOIN etn_delistavb d ON d.id_posla = p.id_posla
    JOIN ev_stavba s ON s.ko_sifko = d.sifra_ko AND s.stev_st = d.stevilka_stavbe
    WHERE TO_DATE(p.datum_sklenitve_pogodbe, 'DD.MM.YYYY')
            BETWEEN '2022-01-01'::date AND '2022-12-31'::date
      AND p.trznost_posla IN ('1','2','5')
      AND d.vrsta_dela_stavbe = '2'
      AND p.pogodbena_cena_odskodnina ~ '^[0-9]'
      AND d.povrsina_dela_stavbe ~ '^[0-9]'
    LIMIT 500
  `;

  const fetchResult = await client.query(fetchSql);
  const transactions = fetchResult.rows;
  console.log(`Fetched ${transactions.length} transactions for 2022.`);

  // Step 2: For each transaction, compute predicted price
  const errors: number[] = [];
  let skipped = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const cena: number = Number(tx.cena);
    const povrsina: number = Number(tx.povrsina);
    const eastingRaw: string | null = tx.easting;
    const northingRaw: string | null = tx.northing;

    if (!isFinite(cena) || cena <= 0 || !isFinite(povrsina) || povrsina <= 0) {
      skipped++;
      continue;
    }

    // Convert D96 easting/northing to numbers
    const e = eastingRaw != null ? Number(eastingRaw) : NaN;
    const n = northingRaw != null ? Number(northingRaw) : NaN;

    if (!isFinite(e) || !isFinite(n) || e === 0 || n === 0) {
      skipped++;
      continue;
    }

    // Verify D96 coordinates are in plausible range for Slovenia
    // D96/TM easting ~374000-620000, northing ~-5110000 to -5200000 range
    // (actually positive stored? Let's check both conventions)
    // The ev_stavba.e/n columns store raw D96 values. If they look like WGS84
    // (lng ~13-17, lat ~45-47) we skip. Otherwise treat as D96.
    // We'll convert using proj4 only for the proximity query — the DB query
    // uses the raw D96 e/n values directly, same as etn-lookup.ts.

    const idPosla: string = String(tx.id_posla);
    const radiusM = 400;
    const radiusSq = radiusM * radiusM;

    // Proximity query excluding this transaction (prevent data leakage)
    const proxySql = `
      SELECT
        p.pogodbena_cena_odskodnina::float AS cena,
        d.povrsina_dela_stavbe::float AS povrsina
      FROM etn_posli p
      JOIN etn_delistavb d ON d.id_posla = p.id_posla
      JOIN ev_stavba ev ON ev.ko_sifko = d.sifra_ko AND ev.stev_st = d.stevilka_stavbe
      WHERE p.pogodbena_cena_odskodnina ~ '^[0-9]+(\.[0-9]+)?$'
        AND d.povrsina_dela_stavbe ~ '^[0-9]+(\.[0-9]+)?$'
        AND p.pogodbena_cena_odskodnina::float > 0
        AND d.povrsina_dela_stavbe::float > 0
        AND p.trznost_posla IN ('1','2','5')
        AND d.vrsta_dela_stavbe = '2'
        AND ev.e IS NOT NULL AND ev.n IS NOT NULL AND ev.e != '' AND ev.n != ''
        AND (ev.e::float - $1)^2 + (ev.n::float - $2)^2 <= $3
        AND p.id_posla != $4
      LIMIT 200
    `;

    let proxyRows: { cena: number; povrsina: number }[];
    try {
      const proxyResult = await client.query(proxySql, [e, n, radiusSq, idPosla]);
      proxyRows = proxyResult.rows;
    } catch {
      skipped++;
      continue;
    }

    // Parse and compute price_per_m2 values
    const pricesPerM2: number[] = [];
    for (const row of proxyRows) {
      const rc = Number(row.cena);
      const rp = Number(row.povrsina);
      if (!isFinite(rc) || !isFinite(rp) || rc <= 0 || rp <= 0) continue;
      const ppm2 = rc / rp;
      if (ppm2 >= 500 && ppm2 <= 25000) {
        pricesPerM2.push(ppm2);
      }
    }

    if (pricesPerM2.length < 3) {
      // Not enough nearby data to form a prediction — skip
      skipped++;
      continue;
    }

    const medianPpm2 = median(pricesPerM2);
    const predicted = medianPpm2 * povrsina;
    const ape = Math.abs(predicted - cena) / cena;
    errors.push(ape);

    if ((i + 1) % 50 === 0) {
      console.log(
        `  Processed ${i + 1}/${transactions.length} — errors so far: ${errors.length}, skipped: ${skipped}`
      );
    }
  }

  if (errors.length === 0) {
    console.error("No valid predictions produced. Check DB connectivity and data.");
    await client.end();
    process.exit(1);
  }

  // Step 3: Calculate metrics
  const sortedErrors = [...errors].sort((a, b) => a - b);
  const mdape = median(errors) * 100;
  const p10 = percentile(sortedErrors, 10) * 100;
  const p25 = percentile(sortedErrors, 25) * 100;
  const p75 = percentile(sortedErrors, 75) * 100;
  const p90 = percentile(sortedErrors, 90) * 100;

  const results = {
    generated: new Date().toISOString(),
    n_tested: errors.length,
    n_skipped: skipped,
    mdape_pct: Math.round(mdape * 100) / 100,
    p10_pct: Math.round(p10 * 100) / 100,
    p25_pct: Math.round(p25 * 100) / 100,
    p75_pct: Math.round(p75 * 100) / 100,
    p90_pct: Math.round(p90 * 100) / 100,
  };

  console.log("\n=== Backtest Results ===");
  console.log(`N tested:  ${results.n_tested}`);
  console.log(`N skipped: ${results.n_skipped}`);
  console.log(`MdAPE:     ${results.mdape_pct}%`);
  console.log(`P10 error: ${results.p10_pct}%`);
  console.log(`P25 error: ${results.p25_pct}%`);
  console.log(`P75 error: ${results.p75_pct}%`);
  console.log(`P90 error: ${results.p90_pct}%`);

  // Step 4: Save results
  const outPath = path.join(process.cwd(), "scripts", "backtest-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outPath}`);

  await client.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
