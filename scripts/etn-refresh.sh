#!/bin/bash
set -e

# ETN Monthly Refresh Script
# Downloads ETN (Evidenca trga nepremicnin) data from e-prostor and upserts into database
# Run monthly via cron: 0 3 1 * * /path/to/scripts/etn-refresh.sh >> /var/log/etn-refresh.log 2>&1

DB_URL="${DATABASE_URL:-postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway}"
TMP=/tmp/etn-refresh-$$
mkdir -p "$TMP"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "=== ETN Refresh $(date) ==="

# Download KPP (kupoprodajni posli - buy/sell transactions)
echo "Downloading ETN KPP..."
curl -L -o "$TMP/ETN_SLO_KPP.zip" \
  "https://e-prostor.gov.si/fileadmin/etn/ETN_SLO_KPP.zip" \
  -H "User-Agent: RealEstateRadar/1.0 research@realestate-radar.si" \
  --fail --silent --show-error

unzip -o "$TMP/ETN_SLO_KPP.zip" -d "$TMP/kpp/"

# Find the CSV file (name may vary by date)
KPP_CSV=$(find "$TMP/kpp" -name "*.csv" -o -name "*.CSV" | head -1)
if [ -z "$KPP_CSV" ]; then
  echo "ERROR: No CSV found in ETN_SLO_KPP.zip"
  exit 1
fi
echo "Found KPP CSV: $KPP_CSV"

# Create staging table and import
psql "$DB_URL" <<SQL
-- Create staging table for ETN posli
DROP TABLE IF EXISTS etn_posli_staging;
CREATE TABLE etn_posli_staging (
  id_posla TEXT,
  datum_pogodbe DATE,
  vrsta_posla TEXT,
  ko_id INTEGER,
  st_stavbe INTEGER,
  st_dela_stavbe INTEGER,
  povrsina NUMERIC,
  cena NUMERIC,
  cena_m2 NUMERIC,
  obcina TEXT,
  tip_nepremicnine TEXT
);
SQL

# Import CSV (assumes header row, semicolon delimiter common for Slovenian exports)
# Adjust delimiter if needed: -c "\\COPY ... WITH (FORMAT csv, HEADER, DELIMITER ';')"
echo "Importing KPP data..."
psql "$DB_URL" -c "\\COPY etn_posli_staging FROM '$KPP_CSV' WITH (FORMAT csv, HEADER true, DELIMITER ';', NULL '')"

# Count imported rows
IMPORTED=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM etn_posli_staging")
echo "Imported $IMPORTED rows to staging"

# Upsert into main transactions table
echo "Upserting to transactions..."
psql "$DB_URL" <<SQL
INSERT INTO transactions (
  id,
  ko_id,
  st_stavbe,
  st_dela_stavbe,
  price,
  price_per_m2,
  area,
  date,
  type,
  municipality,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid()::text,
  ko_id,
  st_stavbe,
  st_dela_stavbe,
  cena,
  cena_m2,
  povrsina,
  datum_pogodbe,
  tip_nepremicnine,
  obcina,
  NOW(),
  NOW()
FROM etn_posli_staging
WHERE ko_id IS NOT NULL AND st_stavbe IS NOT NULL AND cena IS NOT NULL
ON CONFLICT (ko_id, st_stavbe, st_dela_stavbe, date)
DO UPDATE SET
  price = EXCLUDED.price,
  price_per_m2 = EXCLUDED.price_per_m2,
  area = EXCLUDED.area,
  type = EXCLUDED.type,
  municipality = EXCLUDED.municipality,
  updated_at = NOW();

-- Report stats
SELECT 'Transactions after upsert:', COUNT(*) FROM transactions;

-- Cleanup staging
DROP TABLE etn_posli_staging;
SQL

# Download najemni posli (rental transactions) if available
echo "Downloading ETN Najemni..."
if curl -L -o "$TMP/ETN_SLO_NAJ.zip" \
  "https://e-prostor.gov.si/fileadmin/etn/ETN_SLO_NAJ.zip" \
  -H "User-Agent: RealEstateRadar/1.0 research@realestate-radar.si" \
  --fail --silent --show-error 2>/dev/null; then

  unzip -o "$TMP/ETN_SLO_NAJ.zip" -d "$TMP/naj/"
  NAJ_CSV=$(find "$TMP/naj" -name "*.csv" -o -name "*.CSV" | head -1)

  if [ -n "$NAJ_CSV" ]; then
    echo "Found Najemni CSV: $NAJ_CSV"

    psql "$DB_URL" <<SQL
DROP TABLE IF EXISTS etn_najemni_staging;
CREATE TABLE etn_najemni_staging (
  id_posla TEXT,
  datum_pogodbe DATE,
  ko_id INTEGER,
  st_stavbe INTEGER,
  st_dela_stavbe INTEGER,
  povrsina NUMERIC,
  najemnina NUMERIC,
  najemnina_m2 NUMERIC,
  obcina TEXT,
  tip_nepremicnine TEXT
);
SQL

    psql "$DB_URL" -c "\\COPY etn_najemni_staging FROM '$NAJ_CSV' WITH (FORMAT csv, HEADER true, DELIMITER ';', NULL '')"

    NAJ_IMPORTED=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM etn_najemni_staging")
    echo "Imported $NAJ_IMPORTED rental rows"

    # Upsert rentals (if rental_transactions table exists)
    psql "$DB_URL" <<SQL || echo "Note: rental_transactions table may not exist yet"
INSERT INTO rental_transactions (
  id,
  ko_id,
  st_stavbe,
  st_dela_stavbe,
  rent,
  rent_per_m2,
  area,
  date,
  type,
  municipality,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid()::text,
  ko_id,
  st_stavbe,
  st_dela_stavbe,
  najemnina,
  najemnina_m2,
  povrsina,
  datum_pogodbe,
  tip_nepremicnine,
  obcina,
  NOW(),
  NOW()
FROM etn_najemni_staging
WHERE ko_id IS NOT NULL AND st_stavbe IS NOT NULL AND najemnina IS NOT NULL
ON CONFLICT (ko_id, st_stavbe, st_dela_stavbe, date)
DO UPDATE SET
  rent = EXCLUDED.rent,
  rent_per_m2 = EXCLUDED.rent_per_m2,
  area = EXCLUDED.area,
  type = EXCLUDED.type,
  municipality = EXCLUDED.municipality,
  updated_at = NOW();

DROP TABLE etn_najemni_staging;
SQL
  fi
else
  echo "Najemni data not available (may require separate access)"
fi

echo "=== ETN Refresh Complete $(date) ==="
