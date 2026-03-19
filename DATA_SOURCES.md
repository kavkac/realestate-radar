# DATA_SOURCES.md — RealEstateRadar Master Data Catalog

> Zadnja posodobitev: 2026-03-19  
> Avtor: Atlas (CEO), generiran z analizo live DB  
> DB: `postgresql://switchback.proxy.rlwy.net:31940/railway`

---

## 🏆 Hierarhija virov za vrednotenje nepremičnin

Za oceno vrednosti nepremičnine uporabljaj vire v tem vrstnem redu:

| Rang | Vir | Tip podatka | Zakaj |
|------|-----|-------------|-------|
| **#1** | `etn_posli` + `etn_delistavb` | Transakcijske cene kupoprodaje | Dejanske pogodbene cene, uradno evidentirane |
| **#2** | `etn_np_posli` + `etn_np_delistavb` | Tržne najemnine | Za yield kalkulacije in oceno prihodkov |
| **#3** | `ev_stavba` + `ev_del_stavbe` | Fizični atributi stavbe | Za price-per-m² normalizacijo in primerjave |
| **#4** | `energy_certificates` | Energetski razred | Korekcija vrednosti (+/- 5–15% glede na EI razred) |
| **#5** | `dmr_1m_tiles` + `dmr_download_urls` | Topografija/LiDAR | Micro-lokacijska korekcija (sever lega, strmina) |
| **#6** | GURS WFS API (live) | Parcelni atributi, lastništvo, REN | Preverjanje identity stavbe, KO/ŠT stavbe |
| **#7** | OSM Overpass API (live) | POI gostota, javni promet | Lokacijska premija/diskont |
| **#8** | ARSO API (live) | Potresna/poplavna nevarnost | Risk korekcija |

---

## 📊 Podrobna dokumentacija virov

---

### 1. `etn_posli` + `etn_delistavb` — ETN Kupoprodaja

**Namen:** Evidence trga nepremičnin (ETN) — kupoprodajni posli. Uradna evidenca GURS/FURS vseh sklenjenih kupoprodajnih pogodb nepremičnin v Sloveniji. Primarni vir za oceno tržne vrednosti.

**Vrstice:** `etn_posli`: 195,373 | `etn_delistavb`: 176,701  
**Časovni razpon:** 2019–2024 (datum sklenitve pogodbe)  
**Pokritost:** ~100% vseh tržnih kupoprodajnih poslov v SLO (zakonsko obvezna prijava)  
**Občine:** 214 od 212 (vključuje vse slovenske občine + ZKO enote)

**Natančnost/zanesljivost:** ⭐⭐⭐⭐⭐ (5/5)
- Dejanska pogodbena cena, ki jo stranki prijavita GURS/FURS
- Neodvisna verifikacija prek davčnih evidenc (FURS)
- Možne anomalije: napačno vpisane cene, nekateri posli niso "tržni" (TRZNOST_POSLA)

**Tabele in ključne kolumne:**

`etn_posli`:
- `id_posla` — primarni ključ za JOIN
- `pogodbena_cena_odskodnina` — skupna pogodbena cena (text → float)
- `datum_sklenitve_pogodbe` — format `DD.MM.YYYY`
- `trznost_posla` — tržnost posla (filtriraj na tržne!)
- `vrsta_kupoprodajnega_posla` — tip (stanovanje, hiša, poslovni, ...)
- `leto` — leto vpisa (2020–2025)

`etn_delistavb`:
- `id_posla` — FK → etn_posli
- `sifra_ko` + `stevilka_stavbe` + `stevilka_dela_stavbe` — identifikator stavbe
- `povrsina_dela_stavbe` / `uporabna_povrsina` — površina (text → float)
- `vrsta_dela_stavbe` — 15 vrst (stanovanje, garaža, pisarna, ...)
- `e_centroid` / `n_centroid` — centroid v D96/TM koordinatah
- `leto_izgradnje_dela_stavbe` — leto izgradnje (za age korekcijo)
- `novogradnja` — D/N flag

**Svežina:** Enkrat letno (GURS objavi letni bulk dump). Trenutni podatki: **2020–2025** (leto vpisa).  
**Cron refresh:** ❌ Ni avtomatskega cron-a — ročni import z `scripts/import-etn.ts`

**Omejitve:**
- Cene so **skupne** (cela enota), ne cena/m² direktno
- Ni podatka o stanju nepremičnine (urejenost, opremljenost)
- Nekateri starejši vnosi imajo manjkajoče površine
- Format datuma je `DD.MM.YYYY` — potreben parse pri filtriranju
- Ni ločene cene za garažo vs stanovanje pri skupnih poslih
- `trznost_posla` mora biti filtriran (izključi dedovanje, donacije)

**Uporaba v kodi:**
- `lib/etn-lookup.ts` → `getEtnAnaliza()` — analiza kupoprodajnih cen za KO
- `app/api/lookup/route.ts` — primarni endpoint za property valuation

**Priporočena uporaba:** 
- Vedno kot **primarni vir** za ceno/m²
- JOIN z `ev_stavba` za normalizacijo po fizičnih atributih
- Filter: `trznost_posla = 'T'` + `pogodbena_cena_odskodnina > 0`
- Kalibracijski faktorji po KO že implementirani (`KO_KALIBRACIJSKI_FAKTOR` v `etn-lookup.ts`)

---

### 2. `etn_np_posli` + `etn_np_delistavb` — ETN Najem

**Namen:** Evidence trga nepremičnin — najemni posli. Uradna evidenca GURS vseh sklenjenih najemnih pogodb v Sloveniji. Vir za izračun najemnih donosov (yield) in oceno mesečne najemnine.

**Vrstice:** `etn_np_posli`: 231,371 | `etn_np_delistavb`: 243,670  
**Časovni razpon:** 1971–2024 (starejši vnosi so revizije starih pogodb)  
**Pokritost:** ~80–85% najemnih poslov (manjša zakonska prisila kot pri kupoprodaji)

**Natančnost/zanesljivost:** ⭐⭐⭐⭐ (4/5)
- Uradna evidenca, a manjša compliance kot kupoprodaja
- Starejše cene (pred 2015) so manj zanesljive
- `CAS_NAJEMA` (mesečni/letni) mora biti preverjen pri kalkulacijah

**Tabele in ključne kolumne:**

`etn_np_posli`:
- `ID_POSLA` — primarni ključ (UPPERCASE!)
- `POGODBENA_NAJEMNINA` — najemnina (mesečna ali letna — glej `CAS_NAJEMA`)
- `CAS_NAJEMA` — M=mesečno, L=letno
- `TRAJANJE_NAJEMA` — določen/nedoločen čas
- `DATUM_SKLENITVE_POGODBE`, `DATUM_ZACETKA_NAJEMA`
- `TRZNOST_POSLA` — tržnost (filtrirati enako kot pri kupoprodaji)

`etn_np_delistavb`:
- `SIFRA_KO` + `STEVILKA_STAVBE` — identifikator
- `UPORABNA_POVRSINA_ODDANIH_PROSTOROV` / `POVRSINA_ODDANIH_PROSTOROV`
- `IME_KO` — ime katastrske občine

**⚠️ Pozor:** Kolumne so UPPERCASE v nasprotju z etn_posli (lowercase)!

**Svežina:** Enkrat letno skupaj z ETN kupoprodajo. Trenutni podatki: **2020–2025**.  
**Cron refresh:** ❌ Ni avtomatskega cron-a

**Omejitve:**
- Nižja compliance (prijava ni tako strogo sankcionirana)
- `CAS_NAJEMA` mora biti normaliziran na mesečno za primerjave
- Ni podatka o komunalnih stroških (vključeni/izključeni)
- Podnajemi niso evidentirani

**Uporaba v kodi:**
- `lib/etn-lookup.ts` → `getEtnNajemAnaliza()` — yield kalkulator

**Priporočena uporaba:**
- Za yield kalkulacijo (letna najemnina / vrednost × 100)
- Kombiniraj z ETN kupoprodajo za gross yield
- Filter: `TRZNOST_POSLA = 'T'` + zadnjih 5 let

---

### 3. `energy_certificates` + `energy_certificates_full` — EIZ Energetski certifikati

**Namen:** Energetske izkaznice stavb (EIZ) — uradni dokumenti o energetski učinkovitosti stavb. ARSO/ZAPS evidenca. Vir za energetski razred, toplotne izgube, CO₂ emisije.

**Vrstice:** `energy_certificates`: 73,549 | `energy_certificates_full`: 68,507  
**Časovni razpon:** 2016–2026 (veljavnost 10 let)  
**Pokritost:** ~20–30% stanovanjskih stavb (zahtevane pri prodaji/najemu od 2014)

**Natančnost/zanesljivost:** ⭐⭐⭐⭐⭐ (5/5)
- Meritve certificiranih energetskih svetovalcev
- Zakonsko obvezna pri prodaji/najemu (Direktiva 2010/31/EU)
- Razred A–G po EU standardu

**Tabele in ključne kolumne:**

`energy_certificates`:
- `certificateId` — ARSO ID certifikata
- `koId` + `stStavbe` + `stDelaStavbe` — link na stavbo
- `issueDate` / `validUntil` — veljavnost (10 let)
- `energyClass` — A2/A1/A/B/C/D/E/F/G
- `heatingNeed` — potreba po ogrevanju (kWh/m²a)
- `deliveredEnergy` — skupna dostavljena energija
- `primaryEnergy` / `co2Emissions` — emisijski odtis
- `conditionedArea` — kondicionirana površina

`energy_certificates_full`:
- Krajša tabela (68K vrstic) — verjetno samo veljavni certifikati

**Svežina:** Podatki do feb 2026. ARSO objavlja mesečno.  
**Cron refresh:** ❌ Ni implementiranega cron-a — priporočam mesečni refresh

**Omejitve:**
- Certifikat velja 10 let — stare izkaznice ne odražajo renovacij
- Ni pokritosti za starejše stavbe brez prodajnih transakcij
- Nekatere stavbe imajo samo stavbni certifikat (ne po-enoto)

**Uporaba v kodi:**
- `lib/eiz-lookup.ts` → `lookupEnergyCertificate()` — lookup po KO+stavba+enota
- `app/api/lookup/route.ts` — vrnjen v property response

**Priporočena uporaba:**
- Korekcija vrednosti: A2 certifikat +10–15% vs G razred
- Fallback hierarhija: enota → stavba → katerakoli veljavna

---

### 4. `ev_stavba` — Evidenca vrednotenja (stavba)

**Namen:** Register nepremičnin (REN) — fizični atributi vsake stavbe v SLO. GURS uradna evidenca.

**Vrstice:** 1,172,062  
**Pokritost:** ~95%+ vseh stavb v SLO (Register nepremičnin je zakonsko vzdrževan)

**Natančnost/zanesljivost:** ⭐⭐⭐⭐ (4/5)
- Uradna evidenca GURS
- Nekateri atributi so self-reported ali zastareli
- `leto_izg_sta` pogosto nepopoln (besedilno polje)

**Ključne kolumne:**
- `eid_stavba` — unikalni identifikator stavbe (za JOINe)
- `ko_sifko` + `stev_st` — KO + številka stavbe (za ETN join)
- `st_etaz` — število etaž
- `leto_izg_sta` — leto izgradnje
- `leto_obn_strehe` / `leto_obn_fasade` — renovacije
- `id_konstrukcija` — material (masivna/montažna/les/AB/jeklo)
- `ima_vodovod_dn`, `ima_elektriko_dn`, `ima_kanalizacijo_dn`, `ima_plin_dn`
- `id_tip_stavbe` — tip (enodružinska/večstanovanjska/poslovna/...)
- `e` / `n` — centroid D96/TM koordinate
- `st_stanovanj` + `st_poslovnih_prostorov`
- `pov_stavbe` — skupna površina stavbe
- `rpe_obcine_sifra` — šifra občine

**Svežina:** GURS vzdržuje sproti (WFS live). Bulk dump: letno.  
**Cron refresh:** ❌ Ni implementiranega cron-a

**Omejitve:**
- Leto izgradnje pogosto NULL ali napačno
- Renovacije niso vedno evidentirane
- Ne vsebuje cen ali ocen vrednosti

**Uporaba v kodi:**
- `lib/etn-lookup.ts` → JOIN z ETN za normalizacijo
- `lib/gurs-api.ts` → live WFS queries za stavbne atribute

**Priporočena uporaba:**
- JOIN z ETN za fizično normalizacijo cen (površina, tip, starost)
- Preverjanje identity (KO + stev_st → eid_stavba)

---

### 5. `ev_del_stavbe` — Evidenca vrednotenja (deli stavbe)

**Namen:** Fizični atributi posameznih delov stavbe (stanovanj, pisarn, garaž). Granularni register na nivoju enote.

**Vrstice:** 1,923,160  
**Pokritost:** ~90%+ vseh evidentiranih delov stavb

**Natančnost/zanesljivost:** ⭐⭐⭐⭐ (4/5)

**Ključne kolumne:**
- `eid_del_stavbe` / `eid_stavba` — identifikatorji
- `stev_dst` / `stev_stan` — številka dela stavbe
- `povrsina` / `upor_pov` — skupna in uporabna površina
- `st_nadstropja` — nadstropje
- `id_lega` — lega v stavbi (sev/jug/...)
- `leto_obn_oken` / `leto_obn_inst` — renovacije oken/inštalacij
- `ima_dvigalo_dn` — dvigalo
- `id_dr_dst` — vrsta dela stavbe

**Svežina:** Skupaj z ev_stavba — letni dump.  
**Cron refresh:** ❌ Ni avtomatskega cron-a

**Omejitve:**
- `povrsina` ≠ `upor_pov` — vedno preveri katera je relevantna
- Manjkajoče vrednosti za renovacije (NULL = ni podatka)

**Uporaba v kodi:**
- Posredno prek GURS WFS API za detail pogled

---

### 6. Ostale `ev_*` tabele — Pomožne evidence vrednotenja

| Tabela | Namen |
|--------|-------|
| `ev_parcela` | Parcele — geometrija, površina, vrsta rabe |
| `ev_oseba` | Lastniki — anonymiziran register |
| `ev_pravica_lastnistva` + `ev_imetnik_lastnistva` | Lastništvo stavb/parcel |
| `ev_sif_konstrukcija` | Šifrant materialov konstrukcij |
| `ev_sif_tip_stavbe` | Šifrant tipov stavb |
| `ev_sif_lega` | Šifrant lege v stavbi |
| `ev_sif_model` | Šifrant modelov vrednotenja |
| `ev_sif_obcina` | Šifrant občin |
| `evidenca_vrednotenja` | **Trenutno prazna** (0 vrstic) — rezervirano za masovne ocene |

---

### 7. `dmr_1m_tiles` + `dmr_download_urls` — LiDAR DMR Topografija

**Namen:** Digitalni model reliefa (DMR) 1m resolucija — LiDAR aero-snemanje celotne Slovenije. GURS podatki. Za izračun naklona, orientacije (sever/jug), nadmorske višine, poplavnih tveganj.

**Vrstice:** `dmr_1m_tiles`: 21,261 ploščic | `dmr_download_urls`: 14,721 blokov  
**Pokritost:** 100% ozemlja SLO

**Natančnost/zanesljivost:** ⭐⭐⭐⭐⭐ (5/5)
- LiDAR natančnost ±0.15m vertikalno
- 1m × 1m grid resolucija

**Tabele in ključne kolumne:**

`dmr_1m_tiles`:
- `tile_id` / `filename` — identifikator ploščice
- `bbox_minx/y` + `bbox_maxx/y` — bounding box v D96/TM
- `resolution` — "1m"
- `blok` / `datum_snem` — blok in datum snemanja
- `downloaded_at` — kdaj smo prenesli

`dmr_download_urls`:
- `ti_name` — ime ploščice (primarni ključ)
- `ime_ob` — ime občine
- `link_dmr` — URL za DMR (nadmorska višina)
- `link_dmp` — URL za DMP (digitalni model površja)
- `link_gkot` — URL za geoidne kote
- `link_pof` / `link_pofi` — pohodnost
- `link_ndmp` — normalizirani DMP (stavbe, drevesa)
- `link_pas` — pasovni model
- `dmr_size_mb` / `gkot_size_mb` — velikosti datotek

**Svežina:** GURS izdaja nov LiDAR ciklično (~5 let). Zadnje snemanje: 2011–2015 (večina SLO).  
**Cron refresh:** ❌ Ni potreben pogosto — statični podatki

**Omejitve:**
- Statični podatki — ne odražajo novih gradenj
- Ni podatkov o rabi tal ali vegetaciji (le relief)
- Prenos tileov je potreben za processing (ne live query)
- DMP (površje) vključuje stavbe — za relief brez stavb gebruik DMR

**Uporaba v kodi:**
- Trenutno: neuporabljeno v live endpointih
- Potencial: micro-lokacijska korekcija (južna lega +3–5%, strmina diskont)

**Priporočena uporaba:**
- Batch processing za izračun lokacijskih faktorjev
- Kombinirati z centroidi iz ev_stavba za nadmorsko višino vsake stavbe

---

## 🌐 Zunanji API viri (live, brez lokalnih kopij)

### GURS WFS API (e-prostor.gov.si)

**Namen:** Live WFS endpoint za register nepremičnin, parcele, stavbe, lastništvo.

**Natančnost/zanesljivost:** ⭐⭐⭐⭐⭐ (5/5) — uradni register  
**Pokritost:** 100% SLO  
**Svežina:** Realno-časovno (live)

**Endpointi:**
- `https://storitve.eprostor.gov.si/ows-pub-wfs/wfs` — javni register (RPE, stavbe)
- `https://ipi.eprostor.gov.si/wfs-si-gurs-kn/wfs` — kataster nepremičnin (KN)

**Uporaba v kodi:**
- `lib/gurs-api.ts` → `lookupByAddress()`, `getParcele()`, `getOwnership()`, `getBuildingsByParcel()`, `getBuildingParts()`, `getRenVrednost()`, etc.
- `app/api/lookup/route.ts` — osnova za vsak lookup

**Omejitve:**
- Rate limiting na javnem endpointu
- Timeout ~5–10s za kompleksne spatial queries
- Cache implementiran v `lib/wfs-cache.ts`

---

### OpenStreetMap Overpass API

**Namen:** POI gostota v okolici (šole, parki, javni promet, trgovine, restavracije).

**Natančnost/zanesljivost:** ⭐⭐⭐ (3/5) — odvisno od regije
**Pokritost:** ~80% POI v urbanih območjih, manj v ruralnih

**Endpointi:** `https://overpass-api.de/api/interpreter`

**Implementirano:**
- Avtobusne postaje (300m radius)
- Železniške postaje (300m radius)
- Tramvajske postaje (300m radius)
- Višine stavb, material fasade, streha

**Uporaba v kodi:** `lib/osm-api.ts` → `fetchOsmBuildingData()`

**Omejitve:**
- Public API — rate limiting
- Podatki so community-maintained (neenaka kakovost)
- Timeout 12s

---

### ARSO API

**Namen:** Poplavna nevarnost, potresna conacija.

**Natančnost/zanesljivost:** ⭐⭐⭐⭐ (4/5) — uradni vladni vir  
**Pokritost:** 100% SLO

**Uporaba v kodi:** `lib/arso-api.ts` → `getPoplavnaNevarnost()`, `getSeizmicnaCona()`

---

## 🔍 Analiza manjkajočih virov

### ✅ Implementirano (ni treba dodajati)
- GURS WFS live ✅
- OSM Overpass ✅  
- ARSO poplave/potresi ✅
- ETN kupoprodaja + najem ✅
- EIZ certifikati ✅
- LiDAR DMR (tiles shranjene) ✅

### 🟡 Potencialni novi viri — ocena

#### 1. GURS Register nepremičnin (REN) — Bulk API
- **Status:** Delno implementirano prek WFS live
- **Vrednost:** Leto izgradnje, površine, material — vse že v `ev_stavba`
- **Priporočilo:** Ni treba — `ev_stavba` bulk dump pokriva potrebe. WFS za live.

#### 2. OPSI/SURS indeksi cen nepremičnin
- **URL:** `https://pxweb.stat.si/SiStatData/pxweb/sl/Data/Data/2007001S.px`
- **Vrednost:** Regionalni cenovni indeksi (četrtletni) za trend korekcijo
- **Zanesljivost:** ⭐⭐⭐ — agregirani, ne po-stavbni
- **Priporočilo:** Implementirati za trend adjustment (Q-o-Q korekcija). Lahek CSV fetch.
- **Implementacija:** Preprosta — OPSI API vrne CSV/JSON

#### 3. Kataster stavb — GURS WFS
- **Status:** Že implementirano (`lib/gurs-api.ts` → BASE_KN endpoint)
- **Priporočilo:** Ni treba — že pokrito

#### 4. Nepremičnine.net / Bolha scraping
- **Status:** ❌ NI implementirano
- **Vrednost:** Oglasne cene (asking price) — dober indikator tržnega razpoloženja
- **ToS tveganje:** Nepremičnine.net ima ToS ki prepoveduje scraping
- **Alternativa:** SLONEP.net ima API program; Bolha.com — preglej ToS
- **Priporočilo:** ⚠️ Ne implementirati brez pravnega pregleda

#### 5. Kataster komunalne infrastrukture
- **Vrednost:** Plinovod, daljinska toplota — delno v `ev_stavba` (ima_plin_dn)
- **Priporočilo:** Zadostno pokrito z ev_stavba atributi

---

## 📋 Tabele brez podatkov (prazne)

| Tabela | Namen | Status |
|--------|-------|--------|
| `buildings` | Interna buildings cache | 0 vrstic — neuporabljeno |
| `transactions` | Interne transakcije | 0 vrstic — neuporabljeno |
| `properties` | Interne lastnosti | 0 vrstic — neuporabljeno |
| `evidenca_vrednotenja` | Masovne ocene | 0 vrstic — pripravljeno |

---

## 🔄 Refresh Plan

| Vir | Frekvenca | Metoda | Odgovoren |
|-----|-----------|--------|-----------|
| ETN kupoprodaja | Letno (jan) | `scripts/import-etn.ts` | DevOps |
| ETN najem | Letno (jan) | `scripts/import-etn.ts` | DevOps |
| EIZ certifikati | Mesečno | Potrebno implementirati cron | Apex |
| ev_stavba / ev_del_stavbe | Letno | `scripts/import-ev.ts` | DevOps |
| DMR tiles | 5-letno | Ročno | DevOps |
| GURS WFS | Live | Cache v wfs-cache.ts | — |
| OSM | Live | Direct API call | — |
| ARSO | Live | Direct API call | — |

---

## 🔗 JOIN vzorci

```sql
-- ETN cena + fizični atributi stavbe
SELECT 
  p.pogodbena_cena_odskodnina::float AS cena,
  d.povrsina_dela_stavbe::float AS povrsina,
  ev.leto_izg_sta,
  ev.id_konstrukcija
FROM etn_posli p
JOIN etn_delistavb d ON d.id_posla = p.id_posla
JOIN ev_stavba ev ON ev.ko_sifko = d.sifra_ko AND ev.stev_st = d.stevilka_stavbe
WHERE p.trznost_posla = 'T'
  AND d.sifra_ko = '1722'  -- Ljubljana Center
  AND TO_DATE(p.datum_sklenitve_pogodbe, 'DD.MM.YYYY') >= NOW() - INTERVAL '3 years';

-- ETN najem yield kalkulator
SELECT 
  np."POGODBENA_NAJEMNINA"::float * 12 AS letna_najemnina,
  COALESCE(nd."UPORABNA_POVRSINA_ODDANIH_PROSTOROV", nd."POVRSINA_ODDANIH_PROSTOROV")::float AS povrsina
FROM etn_np_posli np
JOIN etn_np_delistavb nd ON nd."ID_POSLA" = np."ID_POSLA"
WHERE nd."SIFRA_KO" = '1722'
  AND np."CAS_NAJEMA" = 'M'
  AND np."TRZNOST_POSLA" = 'T';

-- EIZ za stavbo
SELECT energyClass, heatingNeed, co2Emissions
FROM energy_certificates
WHERE "koId" = 1722 AND "stStavbe" = 100
ORDER BY "issueDate" DESC LIMIT 1;
```
