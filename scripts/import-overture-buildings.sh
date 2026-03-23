#!/bin/bash
# import-overture-buildings.sh
# Prenese Overture Maps building data za Slovenijo in uvozi v DB
# Zahteva: duckdb, psql
# Uporaba: bash scripts/import-overture-buildings.sh

set -e

DB_URL="postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
OUT_FILE="/tmp/overture-slo-buildings.parquet"
OVERTURE_RELEASE="2026-02-18.0"

echo "=== Overture Maps SLO Buildings Import ==="
echo "Release: $OVERTURE_RELEASE"
echo "Output: $OUT_FILE"

# Step 1: Download SLO buildings from Overture via DuckDB
echo ""
echo "1. Downloading from Overture Maps S3..."
duckdb << DUCKEOF
INSTALL spatial; INSTALL httpfs; LOAD spatial; LOAD httpfs;
SET s3_region='us-west-2';
COPY (
  SELECT
    id,
    ST_AsGeoJSON(geometry) AS geometry,
    subtype,
    class,
    height,
    num_floors,
    facade_material,
    facade_color,
    roof_shape,
    roof_height,
    roof_direction,
    roof_orientation,
    roof_material,
    roof_color,
    is_underground,
    -- Centroid for spatial lookup
    ST_X(ST_Centroid(geometry)) AS lng,
    ST_Y(ST_Centroid(geometry)) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=buildings/type=building/*',
    filename=true, hive_partitioning=1)
  WHERE bbox.xmin BETWEEN 13.3 AND 16.6
    AND bbox.ymin BETWEEN 45.4 AND 46.9
    AND is_underground IS DISTINCT FROM true
) TO '${OUT_FILE}' (FORMAT PARQUET, COMPRESSION SNAPPY);
DUCKEOF

echo "Download done: $(ls -lh $OUT_FILE | awk '{print $5}')"

# Step 2: Count
TOTAL=$(duckdb -c "SELECT COUNT(*) FROM read_parquet('${OUT_FILE}');" | grep -E '^\s*[0-9]' | tr -d ' ')
echo "Total buildings: $TOTAL"

# Step 3: Import to PostgreSQL via CSV
echo ""
echo "2. Importing to PostgreSQL..."
duckdb << DUCKEOF
LOAD httpfs;
INSTALL postgres; LOAD postgres;
ATTACH 'dbname=railway host=switchback.proxy.rlwy.net port=31940 user=postgres password=BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz' AS pg (TYPE POSTGRES);

INSERT OR REPLACE INTO pg.overture_buildings 
SELECT id, geometry, subtype, class, height, num_floors,
       facade_material, facade_color, roof_shape, roof_height,
       roof_direction, roof_orientation, roof_material, roof_color,
       is_underground, lng, lat
FROM read_parquet('${OUT_FILE}');
DUCKEOF

echo ""
echo "=== Done ==="
psql "$DB_URL" -c "SELECT COUNT(*), COUNT(roof_shape) as has_roof, COUNT(height) as has_height, COUNT(facade_material) as has_facade FROM overture_buildings;"
