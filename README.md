# RealEstateRadar

Celovit pregled nepremičninskih podatkov za Slovenijo.

## Zahteve

- Node.js 20+
- PostgreSQL 15+ z razširitvijo PostGIS
- Redis (opcijsko, za predpomnjenje)

## Namestitev

```bash
# Namesti odvisnosti
npm install

# Kopiraj okoljske spremenljivke
cp .env.example .env
# Uredi .env z ustreznimi podatki za bazo

# Generiraj Prisma klienta
npm run db:generate

# Poženi migracije
npm run db:push

# Zaženi razvojni strežnik
npm run dev
```

## Viri podatkov

- **GURS RPE** — register prostorskih enot (ulice, hišne številke, naslovi)
- **GURS KN** — kataster nepremičnin (stavbe, deli stavb)
- **Portal energetskih izkaznic** — energetske izkaznice stavb
- **ETN** — evidenca trga nepremičnin (transakcije)

## Vercel deployment

Set these environment variables in Vercel project settings:

- `DATABASE_URL` — PostgreSQL connection string
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps API key with Places API enabled (for address autocomplete). Use: `AIzaSyBdsTqzdIZ8MTDnnrvtelugoEYXjS-V1wQ`

## Tehnologije

- Next.js 14 (App Router)
- TypeScript (strict mode)
- Tailwind CSS + shadcn/ui
- Prisma ORM + PostgreSQL + PostGIS
- Zod (validacija)
