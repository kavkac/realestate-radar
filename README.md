# RealEstateRadar 🏠

**SL:** Platforma za transparenten vpogled v slovensko nepremičninsko tržišče. Vnesite naslov ali EID nepremičnine in pridobite celovit pregled: katastrski podatki, energetska izkaznica, ocena vrednosti, potresna in poplavna tveganja, ter analiza ETN transakcij.

**EN:** A transparency platform for Slovenian real estate. Enter an address or property EID and get a comprehensive overview: cadastral data, energy certificate, estimated value, seismic and flood risk, and ETN transaction analysis.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Backend | Next.js API Routes (serverless) |
| Database | Railway PostgreSQL (ETN, EIZ cache) |
| Deployment | Vercel |
| Maps | Leaflet + react-leaflet |

## Data Sources

| Vir / Source | Data | License |
|---|---|---|
| **GURS Kataster nepremičnin** | Cadastral data, buildings, parcels | CC BY 4.0 (e-prostor.gov.si) |
| **GURS WFS/WMS** | Building geometry, floor plans | CC BY 4.0 |
| **GURS ETN** | Real estate transaction prices | CC BY 4.0 |
| **GURS EIZ** | Energy performance certificates | CC BY 4.0 |
| **GURS ZK GJI** | Gas infrastructure | CC BY 4.0 |
| **ARSO** | Seismic zones (Eurocode 8), flood risk | Open Government Data |
| **ISO 15686-7** | Building lifespan standards (condition formula) | Reference standard |

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL (Railway or local)
- Vercel CLI (optional for local dev with env)

### Local Development

```bash
git clone https://github.com/your-org/realestate-radar.git
cd realestate-radar
npm install

# Copy env template
cp .env.example .env.local
# Fill in DATABASE_URL and any API keys

npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

```env
DATABASE_URL=postgresql://...   # Railway PostgreSQL connection string
```

### Build & Deploy

```bash
npm run build   # Check for errors
npx tsc --noEmit  # TypeScript check
git push origin main  # Vercel auto-deploys
```

## Architecture

```
app/
  page.tsx              # Homepage with search
  api/
    lookup/route.ts     # Main property lookup endpoint
    notify/route.ts     # Notifications
components/
  property-card.tsx     # Main property display component (~2400 lines)
  cadastral-map.tsx     # Leaflet map with building outline
  credit-calculator.tsx # Mortgage calculator
lib/
  gurs-api.ts           # GURS WFS fetchers + condition score formula
  arso-api.ts           # ARSO seismic + flood risk
  wfs-cache.ts          # In-memory WFS response cache
  db.ts                 # PostgreSQL connection
```

## Features

- 🏗️ **Stavbni podatki** — konstrukcija, etaže, priključki, letnik gradnje
- ⚡ **Energetska izkaznica** — uradni razred + algoritmična ocena
- 📊 **Ocena stanja stavbe** — ISO 15686-7 formula (0–100 score)
- 💰 **Ocena vrednosti** — GURS EV + ETN tržna analiza
- 🌊 **Poplavna nevarnost** — ARSO WMS integracija
- 🌍 **Potresno tveganje** — Eurocode 8 seizmične cone
- 🗺️ **Katastrska mapa** — tloris stavbe iz WFS OBRIS_GEOM
- 🏦 **Kreditni kalkulator** — integriran v property card
- 🛡️ **Zavarovanje** — priporočena vsota in premija

## Team (AI Agents)

- **Atlas** (CEO) — product direction, Jaka interface
- **Apex** (Tech Lead) — architecture, implementation
- **Nova** (Producer) — coordination, ops
- **Pipeline** — data fetching, ETL
- **Shield** — security, compliance

---

*Podatki GURS so javni in licencirani pod CC BY 4.0. Vse ocene so informativne narave.*
*GURS data is public and licensed under CC BY 4.0. All estimates are informational only.*
