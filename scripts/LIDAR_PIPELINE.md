# LiDAR Processing Pipeline

Preračuna terrain, solar, viewshed, vegetation, privacy in urban morphology
feature-je iz DMR + DMP LiDAR tilov za ~1.17M stavb v SLO.

## Setup

```bash
pip install rasterio pdal pvlib psycopg2-binary shapely numpy scipy
```

Opcijsko za boljši viewshed:
```bash
pip install richdem
```

## Podatki

- `~/lidar/dmr/DMR_XXX_YYY.laz` — 14,721 tilov, 60GB
- `~/lidar/dmp/DMP_XXX_YYY.laz` — 14,721 tilov, 77GB
- EPSG:3794, 1m resolucija
- Tile naming: XXX*1000 = easting SW corner, YYY*1000 = northing SW corner

## Pogon

### Test (10 stavb, Ljubljana area)
```bash
cd realestate-radar
python3 scripts/process-lidar.py --test
```

### Ena bbox celica (10km x 10km)
```bash
python3 scripts/process-lidar.py --bbox '460000,100000,470000,110000'
```

### Celotna SLO (vikend job, ~15-20h)
```bash
nohup python3 scripts/process-lidar.py --all --resume --workers 4 \
  > /tmp/lidar-process.log 2>&1 &
echo "PID: $!"
```

### Resume po prekinitvi
```bash
python3 scripts/process-lidar.py --all --resume --workers 4
```
`--resume` preskoči batch-e s statusom `done` in že-processed stavbe.

## Progress monitoring

```sql
-- Status po bbox celicah
SELECT batch_id, status, buildings_processed, buildings_total,
       ROUND(buildings_processed::numeric/NULLIF(buildings_total,0)*100, 1) AS pct,
       started_at, completed_at
FROM lidar_processing_log
ORDER BY started_at DESC;

-- Skupaj processed
SELECT COUNT(*) FROM lidar_building_features;

-- Kvaliteta
SELECT quality_flag, COUNT(*) FROM lidar_building_features GROUP BY quality_flag;

-- Viewshed distribution
SELECT
  CASE WHEN viewshed_score_360 > 80 THEN 'odličen'
       WHEN viewshed_score_360 > 50 THEN 'dober'
       WHEN viewshed_score_360 > 20 THEN 'omejen'
       ELSE 'zaprt' END AS razred,
  COUNT(*)
FROM lidar_building_features
GROUP BY 1;
```

## Log

```bash
tail -f /tmp/lidar-process.log
```

## Cache

GeoTIFF cache: `/tmp/lidar_cache/` (~50-100GB med procesiranjem).
Po končanem procesiranju lahko pobrišeš:
```bash
rm -rf /tmp/lidar_cache/
```

## Schema

Apply ročno:
```bash
psql $DATABASE_URL -f scripts/lidar-schema.sql
```

Tabele:
- `lidar_building_features` — rezultati (1 row per stavba)
- `lidar_processing_log` — progress tracking

## Estimated time (MacBook Pro M)

| Faza | Čas |
|---|---|
| LAZ → GeoTIFF (enkratno) | ~1.5h |
| Terrain + height (500k) | ~15 min |
| Solar radiation | ~2-3h |
| Viewshed (bottleneck) | ~10-15h |
| Vegetation + privacy | ~1h |
| **Skupaj** | **~15-20h** |

## Features ki jih računamo

### Terrain (DMR)
- `elevation_m` — nadmorska višina
- `slope_avg_deg`, `slope_max_deg` — nagib
- `aspect_dominant`, `aspect_degrees` — orientacija pobočja
- `tpi_score` — Topographic Position Index (greben=+, dolina=-)
- `wetness_index` — TWI (poplave)
- `relative_elevation_100m/500m` — višina vs okolica
- `depression_score` — 0-1 kotanja
- `flood_risk_score` — 0-1 composite

### Building (DMP-DMR)
- `building_height_m`, `building_height_mean_m`
- `roof_type` — flat/pitched/complex
- `floor_height_m` — višina etaže

### Solar
- `solar_radiation_annual/summer/winter_kwh_m2`
- `sun_hours_summer/winter_solstice`
- `sky_view_factor` — 0-1 % vidnega neba
- `shadow_morning/afternoon_score` — 0-1 zasenčenost

### Viewshed (iz vrha stavbe, r=1km)
- `viewshed_score_360` — 0-100 povprečje
- `viewshed_n/ne/e/se/s/sw/w/nw` — 0-100 per smer
- `horizon_distance_avg_m`
- `mountain_visibility_bool/distance_m`
- `water_visibility_bool/distance_m`
- `green_visibility_pct`, `openness_index`

### Vegetation
- `canopy_cover_50m/200m/500m_pct`
- `tree_height_avg_m`, `tree_height_max_m`
- `green_space_area_200m_m2`

### Privacy
- `building_proximity_avg_m`
- `overlooked_score` — 0-1
- `privacy_score` — 0-1 composite
- `road_exposure_score` — 0-1

### Urban morphology
- `building_density_200m` — stavb/km²
- `avg_building_height_200m_m`
- `open_space_ratio_200m` — 0-1
