/**
 * refresh-clss-token.ts
 *
 * Avtomatsko pridobi svež CLSS Bearer token z Playwright headless browserjem.
 * Token je public guest token (sub: ffffffff-...) — ne zahteva osebnih kredencialov.
 *
 * Run: npx tsx scripts/refresh-clss-token.ts
 * Cron: vsak dan ob 03:00 (token traja 24h)
 *
 * Shrani token v:
 *   1. DB tabela app_config (key='clss_bearer_token')
 *   2. .env.local (za lokalni razvoj)
 */

import { chromium } from "playwright";
import { Client } from "pg";
import fs from "fs";
import path from "path";

const DB_URL =
  "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway";

const CLSS_MAP_URL = "https://lift.clss.si/maps/de8a5798-adcb-11ef-98f2-02420a000587";
const TOKEN_KEY = "clss_bearer_token";

async function ensureAppConfigTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function saveTokenToDB(client: Client, token: string) {
  await client.query(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
  `, [TOKEN_KEY, token]);
}

async function updateEnvLocal(token: string) {
  const envPath = path.join(process.cwd(), ".env.local");
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
    // Replace existing CLSS_BEARER_TOKEN line
    if (content.includes("CLSS_BEARER_TOKEN=")) {
      content = content.replace(/CLSS_BEARER_TOKEN=.*/g, `CLSS_BEARER_TOKEN=${token}`);
    } else {
      content += `\nCLSS_BEARER_TOKEN=${token}`;
    }
  } else {
    content = `CLSS_BEARER_TOKEN=${token}\n`;
  }
  fs.writeFileSync(envPath, content);
}

function decodeJwtExpiry(token: string): Date | null {
  try {
    const payload = Buffer.from(token.split(".")[1], "base64").toString("utf-8");
    const { exp } = JSON.parse(payload);
    return exp ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Starting CLSS token refresh...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  let accessToken: string | null = null;

  // Intercept OAuth token response
  context.on("response", async (response) => {
    if (response.url().includes("/oauth/token") && response.status() === 200) {
      try {
        const body = await response.json();
        if (body.access_token) {
          accessToken = body.access_token;
          console.log("Token intercepted from /oauth/token response");
        }
      } catch {
        // ignore
      }
    }
  });

  const page = await context.newPage();

  console.log(`Navigating to ${CLSS_MAP_URL}`);
  await page.goto(CLSS_MAP_URL, { waitUntil: "networkidle", timeout: 30000 });

  // Wait a bit for JS app to initialize
  await page.waitForTimeout(3000);

  // Try to get token from localStorage if not intercepted
  if (!accessToken) {
    const stored = await page.evaluate(() => {
      // Common localStorage keys for auth tokens
      const keys = ["access_token", "token", "lift_token", "bearer_token", "auth_token"];
      for (const key of keys) {
        const val = localStorage.getItem(key);
        if (val) return { key, val };
      }
      // Check all localStorage keys
      const all: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) all[k] = localStorage.getItem(k) || "";
      }
      return { all };
    });
    console.log("localStorage check:", JSON.stringify(stored).slice(0, 200));

    // Try Vuex store if available
    const storeToken = await page.evaluate(() => {
      try {
        // @ts-ignore
        const store = window.__vue_store__ || window.store;
        if (store) {
          return store.getters?.["Auth/getToken"] || store.state?.auth?.access_token;
        }
      } catch { return null; }
      return null;
    });
    if (storeToken) accessToken = storeToken;
  }

  await browser.close();

  if (!accessToken) {
    console.error("❌ Could not extract token. Check if CLSS URL is still valid.");
    process.exit(1);
  }

  const expiry = decodeJwtExpiry(accessToken);
  console.log(`✅ Token obtained. Expires: ${expiry?.toISOString() ?? "unknown"}`);
  console.log(`   Token preview: ${accessToken.slice(0, 50)}...`);

  // Save to DB
  const dbClient = new Client({ connectionString: DB_URL });
  await dbClient.connect();
  await ensureAppConfigTable(dbClient);
  await saveTokenToDB(dbClient, accessToken);
  await dbClient.end();
  console.log("✅ Token saved to DB (app_config.clss_bearer_token)");

  // Save to .env.local
  updateEnvLocal(accessToken);
  console.log("✅ Token saved to .env.local");

  console.log("\nDone. Token will be valid for ~24h.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
