#!/usr/bin/env python3
"""
RealEstateRadar — Portal Scraper
Portal: nepremicnine.net (robots.txt allows /oglasi-prodaja/)
Author: RealEstateRadar Engineering

robots.txt analiza (2026-03-19):
  nepremicnine.net  → Allow: /oglasi-prodaja/, /oglasi-oddaja/ za User-agent: * ✅
                      Cloudflare managed — zahteva JS challenge za bote
  bolha.com         → /nepremicnine/ ni eksplicitno prepovedan za User-agent: *
                      Radware Bot Manager CAPTCHA blokira preproste HTTP zahteve
  nepremicnine.si   → redirect na nepremicnine.net (isti robots.txt)
  re-max.si         → Allow: / za User-agent: * ✅ (minimalna pokritost)

OPOZORILO: Vsi večji portali imajo anti-bot zaščito (Cloudflare/Radware).
Za produkcijsko rabo priporočamo:
  1. Playwright headless browser (npm install playwright)
  2. API partnerstvo z portalom
  3. Alternativni viri: ARSO, FURS javni podatki

Ta skript poskusi scraping z realističnimi headerji. Za produkcijo
zamenjajte HTTP requests z Playwright.
"""

import re
import time
import json
import random
import logging
import argparse
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin

import psycopg2
from psycopg2.extras import execute_values

try:
    from bs4 import BeautifulSoup
    import requests
except ImportError:
    print("Namesti odvisnosti: pip install requests beautifulsoup4 psycopg2-binary")
    raise

# ── Konfiguracija ───────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
PORTAL = "nepremicnine.net"
BASE_URL = "https://www.nepremicnine.net"

# robots.txt dovoljuje te poti za User-agent: *
ALLOWED_PATHS = [
    "/oglasi-prodaja/slovenija/stanovanje/",
    "/oglasi-prodaja/slovenija/hisa/",
    "/oglasi-prodaja/slovenija/",
]

USER_AGENT = "RealEstateRadar/1.0 research@realestate-radar.si"
RATE_LIMIT_SEC = 2.0  # min 1 req / 2 sek kot zahtevano
MAX_PAGES = 5  # testni run = ~50-100 oglasov (20 na stran)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── HTTP session ─────────────────────────────────────────────────────────────

def make_session() -> requests.Session:
    """Ustvari sejo z realističnimi browser headerji."""
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "sl-SI,sl;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
    })
    return s


def fetch_page(session: requests.Session, url: str) -> Optional[str]:
    """Prenese stran s rate limitingom. Vrne HTML ali None ob napaki."""
    try:
        time.sleep(RATE_LIMIT_SEC + random.uniform(0, 0.5))
        r = session.get(url, timeout=20, allow_redirects=True)
        if r.status_code == 200:
            # Cloudflare JS challenge
            if "just a moment" in r.text.lower() or "cf-challenge" in r.text.lower():
                log.warning(f"Cloudflare JS challenge na {url} — skipping")
                log.warning("Za produkcijsko rabo uporabite Playwright: https://playwright.dev/python/")
                return None
            return r.text
        elif r.status_code == 403:
            log.warning(f"403 Forbidden: {url} — bot zaščita aktivna")
            return None
        else:
            log.warning(f"HTTP {r.status_code}: {url}")
            return None
    except Exception as e:
        log.error(f"Napaka pri {url}: {e}")
        return None

# ── Parser za nepremicnine.net ────────────────────────────────────────────────

def parse_listing_page(html: str, page_url: str) -> list[dict]:
    """
    Parsira seznam oglasov z nepremicnine.net.
    Struktura: <article class="single-results"> ali .ad-list article
    """
    soup = BeautifulSoup(html, "html.parser")
    listings = []

    # nepremicnine.net struktura (2024-2026): article elementi z data-id
    articles = soup.find_all("article", class_=re.compile(r"single-result|property-list"))
    if not articles:
        # Fallback: iščemo po href vzorcu
        articles = soup.find_all("article")

    log.info(f"  Najdenih {len(articles)} artikel elementov na {page_url}")

    for article in articles:
        try:
            listing = parse_single_article(article, page_url)
            if listing:
                listings.append(listing)
        except Exception as e:
            log.debug(f"  Napaka pri parsiranju article: {e}")
            continue

    return listings


def parse_single_article(article, page_url: str) -> Optional[dict]:
    """Parsira en oglas iz article elementa."""
    # URL
    link = article.find("a", href=True)
    if not link:
        return None
    url = urljoin(BASE_URL, link["href"])
    if not url.startswith(BASE_URL):
        return None

    # Naslov
    title_el = article.find(class_=re.compile(r"title|naslov|name"))
    if not title_el:
        title_el = article.find(["h2", "h3", "h4"])
    naslov = title_el.get_text(strip=True) if title_el else None

    # Cena
    cena_eur = None
    price_el = article.find(class_=re.compile(r"price|cena"))
    if price_el:
        price_text = price_el.get_text(strip=True)
        price_match = re.search(r"([\d\.,]+)", price_text.replace(".", "").replace(",", "."))
        if price_match:
            try:
                cena_eur = float(price_match.group(1).replace(",", "."))
                # Normalizacija: če je < 1000, verjetno v tisočih
                if cena_eur < 1000 and "000" in price_text:
                    cena_eur *= 1000
            except ValueError:
                pass

    # Površina
    povrsina_m2 = None
    area_el = article.find(class_=re.compile(r"size|povrsina|area|m2"))
    if not area_el:
        # Iščemo v textu
        for el in article.find_all(text=re.compile(r"\d+[\s,.]?\d*\s*m")):
            m = re.search(r"([\d,\.]+)\s*m", el)
            if m:
                try:
                    povrsina_m2 = float(m.group(1).replace(",", "."))
                    break
                except ValueError:
                    pass
    else:
        area_text = area_el.get_text(strip=True)
        m = re.search(r"([\d,\.]+)", area_text)
        if m:
            try:
                povrsina_m2 = float(m.group(1).replace(",", "."))
            except ValueError:
                pass

    # Tip nepremičnine
    tip = "stanovanje"
    if "hisa" in url or "hiša" in (naslov or "").lower():
        tip = "hisa"
    elif "stanovanje" in url or "stanovan" in (naslov or "").lower():
        tip = "stanovanje"

    # Občina iz URL ali naslova
    obcina = None
    url_parts = url.split("/")
    if len(url_parts) > 4:
        obcina_candidate = url_parts[4] if len(url_parts) > 4 else None
        if obcina_candidate and obcina_candidate not in ["oglasi-prodaja", "slovenija", "stanovanje", "hisa"]:
            obcina = obcina_candidate.replace("-", " ").title()

    # Datum objave (meta ali data atribut)
    datum_objave = None
    date_el = article.find(attrs={"data-date": True})
    if date_el:
        try:
            datum_objave = datetime.fromisoformat(date_el["data-date"]).date()
        except Exception:
            pass

    # Raw data za debugging
    raw_data = {
        "source_url": page_url,
        "html_snippet": str(article)[:500],
    }

    if not url or not naslov:
        return None

    return {
        "portal": PORTAL,
        "url": url,
        "naslov": naslov,
        "cena_eur": cena_eur,
        "povrsina_m2": povrsina_m2,
        "tip": tip,
        "obcina": obcina,
        "ko_sifko": None,
        "lat": None,
        "lng": None,
        "datum_objave": datum_objave,
        "raw_data": json.dumps(raw_data, ensure_ascii=False),
    }


def get_next_page_url(html: str, current_url: str) -> Optional[str]:
    """Najde URL naslednje strani."""
    soup = BeautifulSoup(html, "html.parser")
    next_link = soup.find("a", class_=re.compile(r"next|nasledn"), href=True)
    if not next_link:
        # Iščemo po aria-label
        next_link = soup.find("a", attrs={"aria-label": re.compile(r"next|nasledn", re.I)}, href=True)
    if next_link:
        return urljoin(BASE_URL, next_link["href"])

    # Paginacija: /N/ na koncu URL
    m = re.search(r"/(\d+)/$", current_url)
    if m:
        page_num = int(m.group(1))
        return re.sub(r"/\d+/$", f"/{page_num + 1}/", current_url)

    return None

# ── DB operacije ──────────────────────────────────────────────────────────────

def get_db_connection():
    return psycopg2.connect(DB_URL)


def upsert_listings(conn, listings: list[dict]) -> int:
    """Vstavi ali posodobi oglase. Vrne število vstavljenih."""
    if not listings:
        return 0

    rows = [
        (
            l["portal"], l["url"], l["naslov"],
            l["cena_eur"], l["povrsina_m2"],
            l["tip"], l["obcina"], l["ko_sifko"],
            l["lat"], l["lng"],
            l["datum_objave"],
            l["raw_data"],
        )
        for l in listings
    ]

    sql = """
        INSERT INTO listings_oglasi
            (portal, url, naslov, cena_eur, povrsina_m2, tip, obcina, ko_sifko,
             lat, lng, datum_objave, raw_data)
        VALUES %s
        ON CONFLICT (url) DO UPDATE SET
            naslov = EXCLUDED.naslov,
            cena_eur = EXCLUDED.cena_eur,
            povrsina_m2 = EXCLUDED.povrsina_m2,
            tip = EXCLUDED.tip,
            obcina = EXCLUDED.obcina,
            datum_zajet = NOW(),
            raw_data = EXCLUDED.raw_data
        RETURNING id
    """
    with conn.cursor() as cur:
        result = execute_values(cur, sql, rows, fetch=True)
        conn.commit()
        return len(result)


# ── Bolha.com fallback parser ────────────────────────────────────────────────
# robots.txt: User-agent: * ne prepoveduje /nepremicnine/ eksplicitno
# (prepoveduje /search in /hitro-iskanje, ne pa direktnih listing strani)

BOLHA_PORTAL = "bolha.com"
BOLHA_BASE = "https://www.bolha.com"
BOLHA_PATHS = [
    "/nepremicnine/stanovanja/prodaja-stanovanj/",
]

def parse_bolha_listing(html: str, page_url: str) -> list[dict]:
    """Parser za bolha.com oglase."""
    soup = BeautifulSoup(html, "html.parser")
    listings = []

    # Bolha.com: <article class="entity-body"> ali <li class="EntityList-item">
    articles = soup.find_all("article", class_=re.compile(r"entity|listing"))
    if not articles:
        articles = soup.find_all("li", class_=re.compile(r"EntityList"))

    log.info(f"  Bolha: Najdenih {len(articles)} elementov na {page_url}")

    for article in articles:
        try:
            link = article.find("a", class_=re.compile(r"entity-title|title"), href=True)
            if not link:
                link = article.find("a", href=re.compile(r"/oglas/"))
            if not link:
                continue

            url = urljoin(BOLHA_BASE, link["href"])
            naslov = link.get_text(strip=True)

            # Cena
            cena_eur = None
            price_el = article.find(class_=re.compile(r"price|Price"))
            if price_el:
                price_text = price_el.get_text(strip=True)
                m = re.search(r"([\d\.\,]+)", price_text.replace(".", "").replace(",", ""))
                if m:
                    try:
                        cena_eur = float(m.group(1))
                    except ValueError:
                        pass

            # Površina
            povrsina_m2 = None
            details = article.find(class_=re.compile(r"details|attr"))
            if details:
                m = re.search(r"([\d,\.]+)\s*m²", details.get_text())
                if m:
                    try:
                        povrsina_m2 = float(m.group(1).replace(",", "."))
                    except ValueError:
                        pass

            listings.append({
                "portal": BOLHA_PORTAL,
                "url": url,
                "naslov": naslov,
                "cena_eur": cena_eur,
                "povrsina_m2": povrsina_m2,
                "tip": "stanovanje",
                "obcina": None,
                "ko_sifko": None,
                "lat": None,
                "lng": None,
                "datum_objave": None,
                "raw_data": json.dumps({"source_url": page_url}, ensure_ascii=False),
            })
        except Exception as e:
            log.debug(f"  Napaka pri parsiranju bolha article: {e}")
            continue

    return listings


# ── Glavni scraper ────────────────────────────────────────────────────────────

def scrape(max_pages: int = MAX_PAGES, dry_run: bool = False) -> dict:
    """Glavni scraper. Vrne statistike."""
    log.info("=== RealEstateRadar Scraper ===")
    log.info(f"Portal: {PORTAL}")
    log.info(f"Max strani: {max_pages}")
    log.info(f"Rate limit: {RATE_LIMIT_SEC}s med zahtevki")
    log.info(f"User-Agent: {USER_AGENT}")

    session = make_session()
    all_listings: list[dict] = []
    blocked_urls: list[str] = []

    # Scrape nepremicnine.net
    start_url = urljoin(BASE_URL, ALLOWED_PATHS[0])
    current_url = start_url
    page_num = 0

    while current_url and page_num < max_pages:
        log.info(f"[{page_num + 1}/{max_pages}] Scraping: {current_url}")
        html = fetch_page(session, current_url)

        if html is None:
            log.warning(f"Stran ni dostopna: {current_url}")
            blocked_urls.append(current_url)
            # Poskusi bolha.com kot fallback
            break

        listings = parse_listing_page(html, current_url)
        log.info(f"  Parsiranih {len(listings)} oglasov")
        all_listings.extend(listings)

        current_url = get_next_page_url(html, current_url)
        page_num += 1

    # Če nepremicnine.net ne deluje, poskusi bolha.com
    if not all_listings and blocked_urls:
        log.info("\n--- Fallback: bolha.com ---")
        bolha_url = urljoin(BOLHA_BASE, BOLHA_PATHS[0])
        for page_i in range(min(max_pages, 3)):
            html = fetch_page(session, bolha_url if page_i == 0 else f"{bolha_url}?page={page_i + 1}")
            if html is None:
                log.warning("Bolha.com prav tako blokiran")
                break
            listings = parse_bolha_listing(html, bolha_url)
            all_listings.extend(listings)
            log.info(f"  Bolha stran {page_i + 1}: {len(listings)} oglasov")

    # Statistike
    valid = [l for l in all_listings if l["cena_eur"] and l["povrsina_m2"]]
    cene_m2 = [l["cena_eur"] / l["povrsina_m2"] for l in valid]
    mediana_cena_m2 = sorted(cene_m2)[len(cene_m2) // 2] if cene_m2 else None

    log.info(f"\n=== Rezultati ===")
    log.info(f"Skupaj scraped: {len(all_listings)} oglasov")
    log.info(f"Z veljavno ceno in površino: {len(valid)}")
    if mediana_cena_m2:
        log.info(f"Mediana cena/m²: {mediana_cena_m2:.0f} €/m²")

    # Shrani v DB
    saved = 0
    if all_listings and not dry_run:
        log.info(f"\nShranjujem v DB...")
        conn = get_db_connection()
        try:
            saved = upsert_listings(conn, all_listings)
            log.info(f"Shranjenih/posodobljenih: {saved} oglasov")
        finally:
            conn.close()
    elif dry_run:
        log.info("Dry-run način — nič ni shranjeno v DB")
        # Prikaži vzorec
        for l in all_listings[:5]:
            log.info(f"  {l['naslov'][:60]} | {l['cena_eur']} € | {l['povrsina_m2']} m² | {l['url'][:60]}")

    if blocked_urls and not all_listings:
        log.warning("\n⚠️  Vsi portali so blokirani z anti-bot zaščito.")
        log.warning("Priporočene alternative:")
        log.warning("  1. Playwright headless browser: pip install playwright && playwright install chromium")
        log.warning("  2. API partnerstvo z nepremicnine.net ali bolha.com")
        log.warning("  3. ARSO / FURS javni podatki o transakcijah")

    return {
        "total_scraped": len(all_listings),
        "valid_with_price": len(valid),
        "saved_to_db": saved,
        "mediana_cena_m2": mediana_cena_m2,
        "blocked_urls": blocked_urls,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RealEstateRadar Portal Scraper")
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES, help=f"Max strani (default: {MAX_PAGES})")
    parser.add_argument("--dry-run", action="store_true", help="Ne shrani v DB")
    args = parser.parse_args()

    result = scrape(max_pages=args.max_pages, dry_run=args.dry_run)
    print(f"\n✅ Scraping zaključen: {result['total_scraped']} oglasov, {result['valid_with_price']} veljavnih, mediana {result['mediana_cena_m2']:.0f if result['mediana_cena_m2'] else 'N/A'} €/m²")
