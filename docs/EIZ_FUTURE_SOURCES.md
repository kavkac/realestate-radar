# EIZ — Prihodnji viri podatkov (čakamo na dostop / pravna vprašanja)

## 🔒 Potrebuje formalni dogovor / poizvedbo

### SODO pametni števci
- **Kaj:** Poraba elektrike per naslov/merilno mesto
- **Vrednost:** Zimska poraba direktno korelira z EIZ razredom — brez potrebe po izračunu
- **Status:** Ni javno. GDPR agregiran dostop možen z dogovorom.
- **Akcija:** Formalna poizvedba pri SODO po MVP

### Stanovanjski sklad RS
- **Kaj:** Detajlni podatki (tlorisi, U-vrednosti, ogrevanje) za ~10k javnih stanovanj
- **Vrednost:** Točni podatki za celoten javni stanovanjski fond
- **Status:** Ni javno. Formalna poizvedba.
- **Akcija:** Email po MVP

### ARSO polni EIZ XML
- **Kaj:** Polni XML izvoz energetskih izkaznic (vključno z okni, U-vrednostmi, orientacijami)
- **Vrednost:** Za 73k stavb bi imeli izmerjene površine oken — zamenjalo bi Mapillary ML
- **Status:** V teku (poizvedba poslana)

### Eko sklad obnove baza
- **Kaj:** Vse subvencionirane obnove fasad/oken/streh z letom in specifikacijo
- **Vrednost:** Točen datum in tip obnove za vse Eko sklad financirane projekte
- **Status:** Ni javno. GDPR dogovor možen.

## 🔧 Tehnično izvedljivo, čaka na infrastrukturo

### Interior foto ML iz oglasov
- **Kaj:** ML analiza fotografij notranjosti → tip oken, ogrevanje, stanje prenove
- **Vrednost:** Pokritost ~30-40% stanovanj ki so bila na trgu
- **Odvisno od:** RE portal scraper (nepremicnine.net)
- **Implementacija:** Ko bo scraper live, dodamo CV pipeline

### Tlorisi iz RE oglasov
- **Kaj:** ML ekstrakcija pozicij oken iz tlorisnih slik v oglasih
- **Vrednost:** Window area per orientation za oglaševano nepremičnino
- **Odvisno od:** RE portal scraper

### Text mining oglasnih opisov
- **Kaj:** NLP ekstrakcija "nova okna 2019", "toplotna črpalka", "daljinska toplota" iz opisov
- **Vrednost:** Ogrevalni sistem + obnove za oglaševane nepremičnine
- **Odvisno od:** RE portal scraper

### GURS Kataster stavb — tlorisni načrti ML
- **Kaj:** OCR/ML na skeniranih tlorisnih načrtih pri GURS
- **Vrednost:** Pozicije oken, debelina sten za vse registrirane stavbe
- **Status:** GURS ima fizično, ni API. Projekt za dogovor z GURS.

### PISO gradbena dovoljenja po občinah
- **Kaj:** Digitalni arhitekturni načrti za post-2000 stavbe
- **Vrednost:** Točne specifikacije (izolacija, okna) iz uradnih dokumentov
- **Status:** Po občinah, ni centralizirano. Pilot z LJ.

## 📡 Možni komercialni viri

### Nearmap / Vexcel oblique imagery
- **Kaj:** Poševne aero slike fasad za SLO mesta
- **Vrednost:** Realne meritve oken z ML — brez Mapillary omejitev pokritosti
- **Cena:** ~€10-50k/leto za SLO
- **Kdaj:** Ko EIZ feature postane revenue driver

### IR termografija (aero)
- **Kaj:** Infrardečni aeroposnetki → toplotne izgube stavb
- **Vrednost:** Direktna meritev kakovosti toplotne lupine
- **Status:** Preveriti ali katera SLO občina že ima (Ljubljana pilotno)
