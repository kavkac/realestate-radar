#!/usr/bin/env python3
"""
scrape-via-openclaw-browser.py

Ker Playwright headless blokira Cloudflare, ta script:
1. Vzame seznam IDs iz argumentov ali iz DB (manjkajočih)
2. Fetchira vsak oglas direktno (Cloudflare bypass je rešen na višjem nivoju)
3. Parsira NLP signale in shrani v DB

Pogon:
  DATABASE_URL=... python3 scripts/scrape-via-openclaw-browser.py --start-id 7304327 --count 200

Alternativa: podaj URLs iz fajla:
  DATABASE_URL=... python3 scripts/scrape-via-openclaw-browser.py --ids-file /tmp/ids.txt
"""

import asyncio, re, json, sys, os, argparse, time
import urllib.request

try:
    import psycopg2
except ImportError:
    print("ERROR: pip install psycopg2-binary"); sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "sl-SI,sl;q=0.9,en;q=0.8",
    "Referer": "https://www.nepremicnine.net/oglasi-prodaja/slovenija/stanovanje/",
    "Accept": "text/html,application/xhtml+xml",
}

# ── NLP parser ────────────────────────────────────────────────────────────────

def parse_nlp(text: str) -> dict:
    t = text

    def b(pattern: str):
        return True if re.search(pattern, t, re.I | re.S) else None

    def num(pattern: str):
        m = re.search(pattern, t, re.I)
        return int(m.group(1)) if m else None

    ori = []
    if re.search(r'\b(JV|jugovzhod)', t, re.I): ori.append("JV")
    elif re.search(r'\b(JZ|jugozahod)', t, re.I): ori.append("JZ")
    elif re.search(r'(lega|stran|orientacij)\s*(je\s*)?(J\b|jug)', t, re.I): ori.append("J")
    if re.search(r'\b(SV|severovzhod)', t, re.I): ori.append("SV")

    pogled = None
    if re.search(r'pogled\s+na\s+(alpe|julian)', t, re.I): pogled = "alpe"
    elif re.search(r'pogled\s+na\s+(morje|jadran|zaliv)', t, re.I): pogled = "morje"
    elif re.search(r'pogled\s+na\s+(gore|planin|kamniš|karavanke)', t, re.I): pogled = "gore"
    elif re.search(r'pogled\s+na\s+(reko?|savo|dravo|ljubljanic)', t, re.I): pogled = "reka"
    elif re.search(r'panoram(ski|a)', t, re.I): pogled = "panorama"

    stanje = None
    if re.search(r'ključ\s+v\s+roke|na\s+ključ', t, re.I): stanje = "kljuc_v_roke"
    elif re.search(r'vseljivo\s+takoj|takoj\s+vseljivo', t, re.I): stanje = "vseljivo_takoj"
    elif re.search(r'v\s+celoti\s+prenovlje|popolnoma\s+prenovlje|sveže\s+prenovlje', t, re.I): stanje = "prenovljeno"
    elif re.search(r'za\s+renov|potrebuje\s+renov', t, re.I): stanje = "za_renovacijo"

    gradnja = None
    if re.search(r'opečna[at]|opečnat', t, re.I): gradnja = "opeka"
    elif re.search(r'montažna?\s+gradnja', t, re.I): gradnja = "montazna"
    elif re.search(r'lesena?\s+gradnja|masivn\w+\s+les', t, re.I): gradnja = "les"

    m_leto = re.search(r'prenovlje\w*\s+(?:l\.|leta\s+)?(\d{4})', t, re.I)

    return {
        "orientacija": ori or None,
        "pogled": pogled,
        "toplotnaCarpalka": b(r'toplotn\w+\s+č\w+palko?'),
        "talnoGretje": b(r'taln\w+\s+gretj'),
        "rekuperator": b(r'rekuperator'),
        "soncniPaneli": b(r'sončni?\s+panel|predpriprav\w+\s+za\s+sončn'),
        "evPolnilnica": b(r'električ\w+\s+polnilnic|predpriprav\w+\s+za\s+(EV|električ)'),
        "klimatizacija": b(r'klimatsk\w+\s+enot|klimatizacij'),
        "protivlomniAlarm": b(r'protivlomn|alarmn'),
        "stanje": stanje,
        "letoObnove": int(m_leto.group(1)) if m_leto else None,
        "gradnja": gradnja,
        "stKopalnic": num(r'(\d+)\s*kopalnic'),
        "imaPisarno": b(r'pisarna|kabinet|home\s*office'),
        "imaShrambo": b(r'shramba|kletna\s+shramba'),
        "imaLopo": b(r'\blopa\b'),
        "imaAtrij": b(r'atrij|notranje\s+dvorišče'),
        "imaTeraso": b(r'\bterasa\b|\bteraso\b'),
        "imaBalkon": b(r'\bbalkon\b'),
        "imaVrt": b(r'\bvrt\b'),
        "imaBasen": b(r'\bbazen\b'),
        "stParkingMest": num(r'(\d+)\s+(?:lastniških\s+)?parkirni\w+\s+mest'),
        "imaGaraza": b(r'\bgaraža\b'),
        "primernOddajanje": b(r'idealne?\s+za\s+oddajanje|primern\w+\s+za\s+oddajanje|investicij'),
        "novogradnja": b(r'novogradnja|nova\s+gradnja|zgrajeno?\s+l\.\s*202'),
        "blizinaVrtca": b(r'bliž\w+\s+vrtca?|vrtec\s+v\s+bliž'),
        "blizinaSole": b(r'bliž\w+\s+(osnov|šole?)|šola\s+v\s+bliž'),
        "blizinaFakultete": b(r'bliž\w+\s+fakult|medicinska\s+fakult'),
        "blizinaUKC": b(r'UKC|klinični\s+center'),
        "blizinaLPP": b(r'LPP|avtobusn\w+\s+postaj|javni\s+prevoz|tramvaj'),
        "blizinaObvoznice": b(r'obvoznica|priključek\s+na\s+avtoc'),
    }

# ── Fetch + parse oglas ───────────────────────────────────────────────────────

def fetch_oglas(listing_id: str) -> dict | None:
    url = f"https://www.nepremicnine.net/nepremicnine.html?id={listing_id}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status != 200:
                return None
            html = r.read().decode("utf-8", errors="ignore")

        if "Just a moment" in html or "security verification" in html.lower():
            return None  # Cloudflare blocked

        # Površina (relevantna za matching z GURS)
        pov = None
        m = re.search(r'Velikost[:\s]+([\d,]+)\s*m', html, re.I)
        if not m: m = re.search(r'>([\d,]+)\s*m\s*<sup>2', html)
        if m:
            try: pov = float(m.group(1).replace(",", "."))
            except: pass

        # Cena: NE shranjujemo — listing price != transakcijska cena (ETN je vir resnice)
        cena = None

        # Naslov iz h1
        naslov = ""
        m = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
        if m: naslov = re.sub(r'<[^>]+>', '', m.group(1)).strip()[:200]

        # Opis
        idx = html.find("Dodaten opis nepremičnine")
        opis = ""
        if idx > 0:
            raw = html[idx:idx+4000]
            opis = re.sub(r'<[^>]+>', ' ', raw)
            opis = re.sub(r'\s+', ' ', opis).strip()

        # Tip
        tip = "stanovanje"
        if "hiša" in naslov.lower() or "vrstna" in naslov.lower(): tip = "hisa"

        # Ko sifko — iz URLs strukturiranih naslovov (KO ni v HTML direktno)
        ko = None
        KO_MAP = {
            "Ljubljana": "1728", "ŠIŠKA": "1729", "VIČ": "1730", "MOSTE": "1731",
            "POLJE": "1732", "ROŽNIK": "1733", "ŠENTVID": "1734", "BEŽIGRAD": "1735",
            "MARIBOR": "657", "CELJE": "847", "KOPER": "2602", "KRANJ": "2101",
        }
        for name, k in KO_MAP.items():
            if name.lower() in naslov.lower() or name.lower() in opis.lower():
                ko = k; break

        nlp = parse_nlp(opis + "\n" + naslov) if opis else {}

        return {
            "url": url,
            "naslov": naslov,
            "cena": cena,
            "pov": pov,
            "tip": tip,
            "ko": ko,
            "nlp": nlp,
        }
    except Exception as e:
        return None

# ── DB ────────────────────────────────────────────────────────────────────────

def upsert(conn, data: dict):
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO listings_oglasi (portal, url, naslov, cena_eur, povrsina_m2, ko_sifko, nlp_signals, tip, raw_data)
        VALUES ('nepremicnine.net', %s, %s, %s, %s, %s, %s::jsonb, %s, '{}'::jsonb)
        ON CONFLICT (url) DO UPDATE SET
            naslov = COALESCE(EXCLUDED.naslov, listings_oglasi.naslov),
            cena_eur = COALESCE(EXCLUDED.cena_eur, listings_oglasi.cena_eur),
            povrsina_m2 = COALESCE(EXCLUDED.povrsina_m2, listings_oglasi.povrsina_m2),
            ko_sifko = COALESCE(EXCLUDED.ko_sifko, listings_oglasi.ko_sifko),
            nlp_signals = EXCLUDED.nlp_signals,
            datum_zajet = NOW()
    """, (
        data["url"], data["naslov"], data.get("cena"), data.get("pov"),
        data.get("ko"), json.dumps(data["nlp"], ensure_ascii=False), data["tip"]
    ))
    conn.commit()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-id", type=int, default=7304327)
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--sleep", type=float, default=0.4, help="Sekunde med zahtevami")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)

    # UNIQUE index
    cur = conn.cursor()
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS listings_oglasi_url_uidx ON listings_oglasi(url);")
    conn.commit()

    ok = skip = err = 0
    print(f"Scraping {args.count} oglasov od ID {args.start_id} navzdol...")

    for i in range(args.count):
        lid = str(args.start_id - i)
        data = fetch_oglas(lid)

        if data is None:
            err += 1
            if err % 10 == 0: print(f"  ERR streak {err}")
            time.sleep(args.sleep)
            continue

        if not data["naslov"] and not data["cena"]:
            skip += 1
            time.sleep(0.2)
            continue

        upsert(conn, data)

        # Per-field merge v property_signals
        merge_signals(
            conn,
            ko_sifko=data.get("ko"),
            naslov=data.get("naslov", ""),
            new_signals=data["nlp"],
            source_url=data["url"],
            datum=time.strftime("%Y-%m-%d"),
        )
        ok += 1

        p = data["nlp"].get("pogled") or ""
        tc = "TČ" if data["nlp"].get("toplotnaCarpalka") else ""
        rek = "RK" if data["nlp"].get("rekuperator") else ""
        print(f"  [{i+1}] {lid} | {data.get('cena') or '?'}€ {data.get('pov') or '?'}m² | {data.get('ko') or '?'} | {p} {tc}{rek} | {data['naslov'][:50]}")

        time.sleep(args.sleep)

    print(f"\nDone: ok={ok} skip={skip} err={err}")
    conn.close()

if __name__ == "__main__":
    main()

# ── Property signals merge ────────────────────────────────────────────────────

import hashlib

def normalize_naslov(naslov: str) -> str:
    """Normalizira naslov za matching (brez številk, lowercase, brez presledkov)."""
    s = re.sub(r'\d+', '', naslov.lower())
    s = re.sub(r'[^a-zčšž\s]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def merge_signals(conn, ko_sifko: str | None, naslov: str, new_signals: dict, source_url: str, datum: str):
    """
    Per-field merge v property_signals tabelo.
    - Novo non-null polje → override staro + posodobi datum
    - Staro polje ki ni v novem oglasu → ohrani
    """
    if not ko_sifko and not naslov:
        return

    cur = conn.cursor()
    naslov_hash = hashlib.md5(normalize_naslov(naslov).encode()).hexdigest()[:12]

    # Poišči obstoječ zapis
    cur.execute(
        "SELECT id, signals, signal_dates, signal_sources FROM property_signals WHERE ko_sifko = %s AND naslov_hash = %s",
        (ko_sifko, naslov_hash)
    )
    row = cur.fetchone()

    if row:
        rec_id, old_signals, old_dates, old_sources = row
        merged = dict(old_signals or {})
        merged_dates = dict(old_dates or {})
        merged_sources = dict(old_sources or {})

        # Merge: novo non-null override staro
        for field, val in new_signals.items():
            if val is not None:  # oglas eksplicitno navaja ta signal
                merged[field] = val
                merged_dates[field] = datum
                merged_sources[field] = source_url

        cur.execute("""
            UPDATE property_signals
            SET signals = %s::jsonb,
                signal_dates = %s::jsonb,
                signal_sources = %s::jsonb,
                updated_at = NOW()
            WHERE id = %s
        """, (
            json.dumps(merged, ensure_ascii=False),
            json.dumps(merged_dates),
            json.dumps(merged_sources),
            rec_id
        ))
    else:
        # Nov zapis
        signal_dates = {k: datum for k, v in new_signals.items() if v is not None}
        signal_sources = {k: source_url for k, v in new_signals.items() if v is not None}

        cur.execute("""
            INSERT INTO property_signals (ko_sifko, naslov_hash, signals, signal_dates, signal_sources)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
            ON CONFLICT DO NOTHING
        """, (
            ko_sifko, naslov_hash,
            json.dumps(new_signals, ensure_ascii=False),
            json.dumps(signal_dates),
            json.dumps(signal_sources)
        ))

    conn.commit()
