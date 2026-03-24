#!/usr/bin/env python3
"""
scrape-listings-full.py

Scrapa nepremicnine.net:
1. Pobere URLje z iskalnih strani (prodaja stanovanja, SLO)
2. Za vsak oglas: poišče NLP signale iz opisa
3. Shrani v listings_oglasi (cena, površina, ko_sifko, nlp_signals)

Zahteve:
  pip install playwright psycopg2-binary
  playwright install chromium

Pogon:
  DATABASE_URL=... python3 scripts/scrape-listings-full.py [--pages 5] [--region ljubljana]
"""

import asyncio, re, json, sys, os, argparse
from urllib.parse import urljoin

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: pip install playwright && playwright install chromium")
    sys.exit(1)

try:
    import psycopg2, psycopg2.extras
except ImportError:
    print("ERROR: pip install psycopg2-binary")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

REGIONS = {
    "ljubljana":   "https://www.nepremicnine.net/oglasi-prodaja/ljubljana-mesto/stanovanje/",
    "maribor":     "https://www.nepremicnine.net/oglasi-prodaja/podravska/stanovanje/",
    "koper":       "https://www.nepremicnine.net/oglasi-prodaja/obalno-kraska/stanovanje/",
    "kranj":       "https://www.nepremicnine.net/oglasi-prodaja/gorenjska/stanovanje/",
    "celje":       "https://www.nepremicnine.net/oglasi-prodaja/savinjska/stanovanje/",
    "slovenija":   "https://www.nepremicnine.net/oglasi-prodaja/slovenija/stanovanje/",
}

RATE_LIMIT_MS = 600  # ms med zahtevami

# ── NLP patterns (SLO) ───────────────────────────────────────────────────────

def parse_nlp(text: str) -> dict:
    t = text

    def b(pattern: str) -> bool | None:
        return True if re.search(pattern, t, re.I) else None

    def num(pattern: str) -> int | None:
        m = re.search(pattern, t, re.I)
        return int(m.group(1)) if m else None

    # Orientacija
    ori = []
    if re.search(r'\b(JV|jugovzhod)', t, re.I): ori.append("JV")
    elif re.search(r'\b(JZ|jugozahod)', t, re.I): ori.append("JZ")
    elif re.search(r'\b(lega|stran|orientacij)\s*(je\s*)?(J\b|jug)', t, re.I): ori.append("J")
    if re.search(r'\b(SV|severovzhod)', t, re.I): ori.append("SV")
    elif re.search(r'\b(SZ|severozahod)', t, re.I): ori.append("SZ")

    # Pogled
    pogled = None
    if re.search(r'pogled\s+na\s+(alpe|julian)', t, re.I): pogled = "alpe"
    elif re.search(r'pogled\s+na\s+(morje|jadran|zaliv)', t, re.I): pogled = "morje"
    elif re.search(r'pogled\s+na\s+(gore|planin|kamniš|karavanke)', t, re.I): pogled = "gore"
    elif re.search(r'pogled\s+na\s+(reko?|savo|dravo|ljubljanic)', t, re.I): pogled = "reka"
    elif re.search(r'panoram(ski|a)', t, re.I): pogled = "panorama"

    # Stanje
    stanje = None
    if re.search(r'ključ\s+v\s+roke|na\s+ključ', t, re.I): stanje = "kljuc_v_roke"
    elif re.search(r'vseljivo\s+takoj|takoj\s+vseljivo', t, re.I): stanje = "vseljivo_takoj"
    elif re.search(r'v\s+celoti\s+prenovlje|popolnoma\s+prenovlje', t, re.I): stanje = "prenovljeno"
    elif re.search(r'za\s+renov|potrebuje\s+renov', t, re.I): stanje = "za_renovacijo"

    leto_obnove_m = re.search(r'prenovlje\w*\s+(?:l\.|leta\s+|l\s+)?(\d{4})', t, re.I)

    # Gradnja
    gradnja = None
    if re.search(r'opečna[at]|opečnat', t, re.I): gradnja = "opeka"
    elif re.search(r'montažna?\s+gradnja|montiran', t, re.I): gradnja = "montazna"
    elif re.search(r'lesena?\s+gradnja|masivn\w+\s+les', t, re.I): gradnja = "les"

    signals = {
        "orientacija": ori if ori else None,
        "pogled": pogled,
        "toplotnaCarpalka": b(r'toplotn\w+\s+č\w+palko?'),
        "talnoGretje": b(r'taln\w+\s+gretj'),
        "rekuperator": b(r'rekuperator'),
        "soncniPaneli": b(r'sončni?\s+panel|predpriprav\w+\s+za\s+sončn'),
        "evPolnilnica": b(r'električ\w+\s+polnilnic|predpriprav\w+\s+za\s+(EV|električ)'),
        "klimatizacija": b(r'klimatsk\w+\s+enot|klimatizacij'),
        "protivlomniAlarm": b(r'protivlomn|alarmn'),
        "stanje": stanje,
        "letoObnove": int(leto_obnove_m.group(1)) if leto_obnove_m else None,
        "gradnja": gradnja,
        "stKopalnic": num(r'(\d+)\s*kopalnic'),
        "imaPisarno": b(r'pisarna|kabinet|home\s+office'),
        "imaShrambo": b(r'shramba|kletna\s+shramba'),
        "imaLopo": b(r'\blopa\b'),
        "imaAtrij": b(r'atrij|notranje?\s+dvorišče'),
        "imaTeraso": b(r'\bterasa\b'),
        "imaBalkon": b(r'\bbalkon\b'),
        "imaVrt": b(r'\bvrt\b'),
        "imaBasen": b(r'\bbazen\b'),
        "stParkingMest": num(r'(\d+)\s*[a-z]*\s*parkirni[a-z]*\s+mest'),
        "imaGaraza": b(r'\bgaraža\b'),
        "primernOddajanje": b(r'idealne?\s+za\s+oddajanje|primern\w+\s+za\s+oddajanje|investicij'),
        "novogradnja": b(r'novogradnja|nova\s+gradnja|zgrajeno?\s+l\.\s*202'),
        "blizinaVrtca": b(r'bliž\w+\s+vrtca?|vrtec\s+v\s+bliž'),
        "blizinaSole": b(r'bliž\w+\s+(osnov|šole?)|šola\s+v\s+bliž'),
        "blizinaFakultete": b(r'bliž\w+\s+fakult|medicinska?\s+fakult'),
        "blizinaUKC": b(r'UKC|klinični?\s+center'),
        "blizinaLPP": b(r'LPP|avtobusn\w+\s+postaj|javni\s+prevoz|tramvaj'),
        "blizinaObvoznice": b(r'obvoznica|priključek\s+na\s+avtoc'),
    }
    return signals

# ── Ko sifko iz naslova ───────────────────────────────────────────────────────

KO_MAP = {
    "LJUBLJANA": "1728", "ŠIŠKA": "1729", "VIČ": "1730", "MOSTE": "1731",
    "POLJE": "1732", "ROŽNIK": "1733", "ŠENTVID": "1734", "BEŽIGRAD": "1735",
    "MARIBOR": "657", "CELJE": "847", "KOPER": "2602", "KRANJ": "2101",
    "NOVO MESTO": "1481", "VELENJE": "963", "NOVA GORICA": "2310",
}

def guess_ko(text: str) -> str | None:
    for name, ko in KO_MAP.items():
        if name.lower() in text.lower():
            return ko
    return None

# ── Playwright scraper ────────────────────────────────────────────────────────

async def get_listing_ids_sequential(latest_id: int, count: int) -> list[dict]:
    """
    nepremicnine.net URLji so sekvenčni (id=7304327, 7304326, ...).
    Generiramo seznam IDjev od latest nazaj.
    """
    return [
        {"id": str(latest_id - i), "url": f"https://www.nepremicnine.net/nepremicnine.html?id={latest_id - i}", "snippet": ""}
        for i in range(count)
    ]

async def find_latest_id(page) -> int:
    """Poišče zadnji ID z iskalnih strani via Playwright."""
    try:
        await page.goto(
            "https://www.nepremicnine.net/oglasi-prodaja/slovenija/stanovanje/",
            wait_until="domcontentloaded", timeout=15000
        )
        await page.wait_for_timeout(2000)
        # Poišči max ID iz vseh linkov
        ids = await page.evaluate("""
            () => {
                const ids = [];
                document.querySelectorAll('a').forEach(a => {
                    const m = (a.href || '').match(/id=(\\d+)/);
                    if (m) ids.push(parseInt(m[1]));
                });
                return ids.sort((a,b) => b-a).slice(0, 5);
            }
        """)
        if ids:
            print(f"  Latest IDs from search page: {ids[:3]}")
            return ids[0]
    except Exception as e:
        print(f"  WARN: could not find latest ID: {e}")
    # Fallback: scrape 24ur.html za zadnje oglase
    try:
        await page.goto("https://www.nepremicnine.net/24ur.html", wait_until="domcontentloaded", timeout=10000)
        await page.wait_for_timeout(1500)
        ids = await page.evaluate("""
            () => {
                const ids = [];
                document.querySelectorAll('a').forEach(a => {
                    const m = (a.href || '').match(/id=(\\d+)/);
                    if (m) ids.push(parseInt(m[1]));
                });
                return ids.sort((a,b) => b-a).slice(0, 5);
            }
        """)
        if ids:
            return ids[0]
    except: pass
    return 7304327  # hard fallback (zadnji znan ID)

async def get_listing_urls(page, search_url: str, max_pages: int) -> list[dict]:
    """Poišče URLje — najprej iz iskalne strani, fallback na sekvenčno."""
    print("  Iščem zadnji ID...")
    latest_id = await find_latest_id(page)
    count = max_pages * 20  # ~20 oglasov/stran
    print(f"  Latest ID: {latest_id} → generiramo {count} IDjev sekvenčno")
    return await get_listing_ids_sequential(latest_id, count)

async def scrape_listing_detail(page, url: str) -> dict | None:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=12000)
        await page.wait_for_timeout(800)

        data = await page.evaluate("""
            () => {
                const body = document.body.innerText;

                // Cena
                const cenaM = body.match(/Cena[:\\s]+(\\d[\\d.,]+)\\s*EUR/i) ||
                               body.match(/(\\d[\\d.,]+)\\s*€/);
                const cena = cenaM ? parseFloat(cenaM[1].replace(/\\./g,'').replace(',','.')) : null;

                // Površina
                const povM = body.match(/Velikost[:\\s]+(\\d+[,.]?\\d*)\\s*m/i) ||
                              body.match(/(\\d+[,.]?\\d*)\\s*m\\s*²/);
                const pov = povM ? parseFloat(povM[1].replace(',','.')) : null;

                // Opis
                const idx = body.indexOf('Dodaten opis nepremičnine');
                const opis = idx > 0 ? body.slice(idx + 25, idx + 4000).trim() : '';

                // Naslov
                const h1 = document.querySelector('h1');
                const naslov = h1 ? h1.innerText.slice(0, 200) : '';

                // Nadstropje
                const nadM = body.match(/Nadstropje[:\\s]+([\\d+/PMKX]+)/i);
                const nad = nadM ? nadM[1] : null;

                return { cena, pov, opis, naslov, nadstropje: nad };
            }
        """)

        return data
    except Exception as e:
        print(f"  ERR detail {url}: {e}")
        return None

# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway")
    return psycopg2.connect(db_url)

def upsert_oglas(conn, portal: str, url: str, listing_id: str, naslov: str,
                 cena: float | None, pov: float | None, ko_sifko: str | None,
                 nlp_signals: dict) -> bool:
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO listings_oglasi (portal, url, naslov, cena_eur, povrsina_m2, ko_sifko, nlp_signals, tip, raw_data)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, 'stanovanje', '{}'::jsonb)
        ON CONFLICT (url) DO UPDATE SET
            naslov = EXCLUDED.naslov,
            cena_eur = COALESCE(EXCLUDED.cena_eur, listings_oglasi.cena_eur),
            povrsina_m2 = COALESCE(EXCLUDED.povrsina_m2, listings_oglasi.povrsina_m2),
            ko_sifko = COALESCE(EXCLUDED.ko_sifko, listings_oglasi.ko_sifko),
            nlp_signals = EXCLUDED.nlp_signals,
            datum_zajet = NOW()
    """, (portal, url, naslov, cena, pov, ko_sifko, json.dumps(nlp_signals, ensure_ascii=False)))
    conn.commit()
    return True

# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=3, help="Število iskalnih strani")
    parser.add_argument("--region", default="ljubljana", choices=list(REGIONS.keys()))
    parser.add_argument("--max-listings", type=int, default=50)
    args = parser.parse_args()

    search_url = REGIONS[args.region]
    print(f"Scraping: {search_url} | pages={args.pages} | max={args.max_listings}")

    conn = get_db()
    print("DB connected")

    # Upsert conflict handler — dodaj UNIQUE constraint če ne obstaja
    cur = conn.cursor()
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS listings_oglasi_url_uidx ON listings_oglasi(url);")
    conn.commit()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            locale="sl-SI",
        )
        page = await ctx.new_page()

        # 1. Poberi liste
        print("\n1. Pridobivam URLje...")
        listings = await get_listing_urls(page, search_url, args.pages)
        listings = listings[:args.max_listings]
        print(f"   Skupaj: {len(listings)} oglasov")

        # 2. Za vsak oglas: detail + NLP
        print("\n2. Scraping detajlov...")
        ok = 0
        for i, item in enumerate(listings):
            detail_url = f"https://www.nepremicnine.net/nepremicnine.html?id={item['id']}"
            detail = await scrape_listing_detail(page, detail_url)

            if not detail:
                continue

            opis = detail.get("opis", "") or ""
            # NLP iz opisa + snippeta
            combined = opis + "\n" + (item.get("snippet") or "")
            signals = parse_nlp(combined) if combined.strip() else {}

            ko = guess_ko(detail.get("naslov", "") + " " + (item.get("snippet") or ""))

            upsert_oglas(
                conn,
                portal="nepremicnine.net",
                url=detail_url,
                listing_id=item["id"],
                naslov=detail.get("naslov", "")[:200],
                cena=detail.get("cena"),
                pov=detail.get("pov"),
                ko_sifko=ko,
                nlp_signals=signals,
            )
            ok += 1

            # Log
            p = signals.get("pogled")
            tc = "TČ" if signals.get("toplotnaCarpalka") else ""
            print(f"  [{i+1}/{len(listings)}] {item['id']} | {detail.get('cena','?')}€ {detail.get('pov','?')}m² | {p or ''} {tc}")

            await page.wait_for_timeout(RATE_LIMIT_MS)

        await browser.close()

    print(f"\n✅ Done: {ok}/{len(listings)} shranjenih v DB")
    conn.close()

asyncio.run(main())
