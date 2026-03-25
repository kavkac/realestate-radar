#!/usr/bin/env python3
"""
process-lidar.py

LiDAR processing pipeline za RealEstateRadar.
Preračuna terrain, solar, viewshed, vegetation, privacy in morphology feature-je
za vsako stavbo iz gurs_kn_stavbe ter jih shrani v lidar_building_features.

Podatki:
  DMR tiles: ~/lidar/dmr/DMR_XXX_YYY.laz  (EPSG:3794, 1m resolucija)
  DMP tiles: ~/lidar/dmp/DMP_XXX_YYY.laz

Tile naming konvencija:
  DMR_XXX_YYY.laz → SW corner = (XXX*1000, YYY*1000) v EPSG:3794

Pogon:
  python3 scripts/process-lidar.py --test
  python3 scripts/process-lidar.py --bbox '460000,100000,470000,110000'
  python3 scripts/process-lidar.py --all --resume --workers 4

Čas: ~15-20h za celo SLO na MacBook Pro M
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import numpy as np
import psycopg2
import psycopg2.extras

# Optional heavy deps — graceful fallback
try:
    import rasterio
    import rasterio.merge
    import rasterio.transform
    from rasterio.warp import transform_bounds
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False
    print("WARNING: rasterio not installed. Run: pip install rasterio", file=sys.stderr)

try:
    import pdal
    HAS_PDAL = True
except ImportError:
    HAS_PDAL = False
    print("WARNING: pdal not installed. Run: pip install pdal", file=sys.stderr)

try:
    import pvlib
    HAS_PVLIB = True
except ImportError:
    HAS_PVLIB = False

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway"
)

DMR_DIR = Path.home() / "lidar" / "dmr"
DMP_DIR = Path.home() / "lidar" / "dmp"
CACHE_DIR = Path("/tmp/lidar_cache")
LOG_FILE = Path("/tmp/lidar-process.log")

PIPELINE_VERSION = "1.0.0"
BBOX_GRID_SIZE = 10_000       # 10km x 10km celice
TILE_SIZE = 1_000             # 1km x 1km tile
VIEWSHED_RADIUS_M = 1_000     # 1km viewshed radius
VIEWSHED_RESOLUTION_M = 5     # 5m grid za viewshed (hitrost vs natančnost)
CHECKPOINT_EVERY = 50         # upsert vsakih N stavb
VEGETATION_HEIGHT_THRESHOLD = 1.5  # DMP-DMR > 1.5m = vegetacija

# SLO bounding box v EPSG:3794
SLO_XMIN, SLO_YMIN = 374_000, 32_000
SLO_XMAX, SLO_YMAX = 624_000, 194_000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE),
    ]
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# TILE UTILITIES
# ─────────────────────────────────────────────

def tile_name_to_bbox(tile_path: Path) -> tuple[int, int, int, int]:
    """DMR_XXX_YYY.laz → (xmin, ymin, xmax, ymax) v EPSG:3794."""
    m = re.search(r"_(\d+)_(\d+)\.laz$", tile_path.name, re.IGNORECASE)
    if not m:
        raise ValueError(f"Cannot parse tile name: {tile_path.name}")
    xxx, yyy = int(m.group(1)), int(m.group(2))
    xmin = xxx * 1000
    ymin = yyy * 1000
    return xmin, ymin, xmin + TILE_SIZE, ymin + TILE_SIZE


def get_tiles_for_bbox(
    xmin: float, ymin: float, xmax: float, ymax: float,
    layer: str = "dmr",
    buffer_m: float = 1000,
) -> list[Path]:
    """Vrni tile paths ki pokrivajo bbox (z bufferjem)."""
    tile_dir = DMR_DIR if layer == "dmr" else DMP_DIR
    prefix = "DMR" if layer == "dmr" else "DMP"

    # Tile SW corners ki se prekrivajo z buffered bbox
    bxmin = xmin - buffer_m
    bymin = ymin - buffer_m
    bxmax = xmax + buffer_m
    bymax = ymax + buffer_m

    tiles = []
    for path in tile_dir.glob(f"{prefix}_*.laz"):
        try:
            txmin, tymin, txmax, tymax = tile_name_to_bbox(path)
            # Overlap check
            if txmax > bxmin and txmin < bxmax and tymax > bymin and tymin < bymax:
                tiles.append(path)
        except ValueError:
            continue
    return tiles


# ─────────────────────────────────────────────
# LAZ → GEOTIFF (PDAL)
# ─────────────────────────────────────────────

def laz_to_geotiff(laz_path: Path, out_path: Path, resolution: float = 1.0) -> bool:
    """Convert .laz to GeoTIFF using PDAL. Returns True on success."""
    if out_path.exists():
        return True  # cache hit

    if not HAS_PDAL:
        log.warning("pdal not available, skipping tile conversion")
        return False

    pipeline_json = json.dumps({
        "pipeline": [
            {
                "type": "readers.las",
                "filename": str(laz_path),
                "override_srs": "EPSG:3794",
            },
            {
                "type": "writers.gdal",
                "filename": str(out_path),
                "resolution": resolution,
                "output_type": "idw",
                "gdalopts": "COMPRESS=LZW",
                "override_srs": "EPSG:3794",
            }
        ]
    })

    try:
        p = pdal.Pipeline(pipeline_json)
        p.execute()
        return True
    except Exception as e:
        log.error(f"PDAL failed for {laz_path.name}: {e}")
        return False


def get_or_create_geotiff(laz_path: Path, layer: str) -> Optional[Path]:
    """Get cached GeoTIFF or create it."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CACHE_DIR / f"{laz_path.stem}.tif"
    if laz_to_geotiff(laz_path, out_path):
        return out_path
    return None


# ─────────────────────────────────────────────
# RASTER UTILITIES
# ─────────────────────────────────────────────

def load_raster_array(tif_path: Path) -> tuple[np.ndarray, object]:
    """Load GeoTIFF as numpy array. Returns (array, transform)."""
    if not HAS_RASTERIO:
        raise RuntimeError("rasterio required")
    with rasterio.open(tif_path) as src:
        arr = src.read(1).astype(np.float32)
        arr[arr == src.nodata] = np.nan
        return arr, src.transform


def merge_rasters(tif_paths: list[Path]) -> tuple[Optional[np.ndarray], Optional[object]]:
    """Merge multiple GeoTIFFs into single array."""
    if not tif_paths or not HAS_RASTERIO:
        return None, None
    try:
        datasets = [rasterio.open(p) for p in tif_paths]
        merged, transform = rasterio.merge.merge(datasets)
        for ds in datasets:
            ds.close()
        arr = merged[0].astype(np.float32)
        arr[arr < -9000] = np.nan
        return arr, transform
    except Exception as e:
        log.error(f"Raster merge failed: {e}")
        return None, None


def sample_raster(arr: np.ndarray, transform, x: float, y: float) -> Optional[float]:
    """Sample raster value at (x, y) in raster CRS."""
    if arr is None or transform is None:
        return None
    try:
        row, col = rasterio.transform.rowcol(transform, x, y)
        if 0 <= row < arr.shape[0] and 0 <= col < arr.shape[1]:
            val = arr[row, col]
            return float(val) if not np.isnan(val) else None
    except Exception:
        return None
    return None


def sample_raster_window(
    arr: np.ndarray, transform, x: float, y: float, radius_m: float
) -> Optional[np.ndarray]:
    """Extract a square window around (x,y)."""
    if arr is None or transform is None:
        return None
    try:
        pixel_size = abs(transform.a)
        half = int(radius_m / pixel_size)
        row, col = rasterio.transform.rowcol(transform, x, y)
        r0, r1 = max(0, row - half), min(arr.shape[0], row + half)
        c0, c1 = max(0, col - half), min(arr.shape[1], col + half)
        window = arr[r0:r1, c0:c1]
        return window if window.size > 0 else None
    except Exception:
        return None


# ─────────────────────────────────────────────
# TERRAIN FEATURES
# ─────────────────────────────────────────────

def compute_terrain_features(
    dmr: np.ndarray, transform, cx: float, cy: float
) -> dict:
    """Compute terrain features from DMR at centroid (cx, cy)."""
    result: dict = {}

    elevation = sample_raster(dmr, transform, cx, cy)
    result["elevation_m"] = elevation

    # Window 100m and 500m
    w100 = sample_raster_window(dmr, transform, cx, cy, 100)
    w500 = sample_raster_window(dmr, transform, cx, cy, 500)

    if w100 is not None and w100.size > 0:
        valid = w100[~np.isnan(w100)]
        if valid.size > 0 and elevation is not None:
            result["relative_elevation_100m"] = round(float(elevation - np.mean(valid)), 2)

            # Slope from window
            if valid.size >= 4:
                pixel_size = abs(transform.a)
                gy, gx = np.gradient(w100, pixel_size, pixel_size)
                slope = np.degrees(np.arctan(np.sqrt(gx**2 + gy**2)))
                slope_valid = slope[~np.isnan(slope)]
                if slope_valid.size > 0:
                    result["slope_avg_deg"] = round(float(np.nanmean(slope)), 2)
                    result["slope_max_deg"] = round(float(np.nanmax(slope)), 2)

                    # Aspect
                    aspect_rad = np.arctan2(-gy, gx)
                    aspect_deg = (np.degrees(aspect_rad) + 360) % 360
                    mean_asp = float(np.nanmean(aspect_deg))
                    result["aspect_degrees"] = round(mean_asp, 1)
                    result["aspect_dominant"] = degrees_to_aspect(mean_asp)

            # TPI (Topographic Position Index)
            if elevation is not None:
                result["tpi_score"] = round(float(elevation - np.nanmean(valid)), 3)

            # Depression score (negative TPI = below surroundings)
            tpi = result.get("tpi_score", 0) or 0
            result["depression_score"] = round(max(0.0, min(1.0, -tpi / 10.0)), 3)

    if w500 is not None and w500.size > 0 and elevation is not None:
        valid500 = w500[~np.isnan(w500)]
        if valid500.size > 0:
            result["relative_elevation_500m"] = round(float(elevation - np.mean(valid500)), 2)

    # Wetness index proxy (TWI = ln(catchment_area / tan(slope)))
    slope_avg = result.get("slope_avg_deg")
    if slope_avg is not None and slope_avg > 0.1:
        slope_rad = math.radians(slope_avg)
        catchment_proxy = 100.0  # default, no flow accumulation
        try:
            result["wetness_index"] = round(math.log(catchment_proxy / math.tan(slope_rad)), 3)
        except (ValueError, ZeroDivisionError):
            result["wetness_index"] = None

    # Flood risk composite
    depression = result.get("depression_score", 0) or 0
    elevation_val = result.get("elevation_m")
    low_elevation_factor = 0.0
    if elevation_val is not None and elevation_val < 300:
        low_elevation_factor = max(0.0, (300 - elevation_val) / 300) * 0.3
    result["flood_risk_score"] = round(min(1.0, depression * 0.7 + low_elevation_factor), 3)

    return result


def degrees_to_aspect(deg: float) -> str:
    dirs = ["N","NE","E","SE","S","SW","W","NW"]
    idx = int((deg + 22.5) / 45) % 8
    return dirs[idx]


# ─────────────────────────────────────────────
# BUILDING HEIGHT
# ─────────────────────────────────────────────

def compute_building_height(
    dmr: np.ndarray, dmr_transform,
    dmp: np.ndarray, dmp_transform,
    cx: float, cy: float,
    stevilo_etaz: Optional[int] = None,
) -> dict:
    """Building height = DMP - DMR at centroid.

    Corrections applied to get usable ceiling height:
    - Use DMP median (not max/mean) — avoids roof ridge inflation
    - Subtract roof structure offset per roof type
    - Subtract floor slab thickness (0.25m × num_floors)
    """
    result: dict = {}

    # Roof structure offsets (DMP includes roof tiles/truss/insulation)
    ROOF_OFFSET = {"flat": 0.30, "pitched": 0.60, "complex": 0.80}
    SLAB_THICKNESS_M = 0.25  # per floor (concrete slab)

    dmr_val = sample_raster(dmr, dmr_transform, cx, cy)
    dmp_val = sample_raster(dmp, dmp_transform, cx, cy)

    # Window for better estimate
    w_dmr = sample_raster_window(dmr, dmr_transform, cx, cy, 15)
    w_dmp = sample_raster_window(dmp, dmp_transform, cx, cy, 15)

    if dmr_val is not None and dmp_val is not None:
        # Use median of window (more stable than max, avoids ridge spike)
        if w_dmr is not None and w_dmp is not None:
            dmr_valid = w_dmr[~np.isnan(w_dmr)]
            dmp_valid = w_dmp[~np.isnan(w_dmp)]
            dmr_median = float(np.nanmedian(dmr_valid)) if dmr_valid.size > 0 else dmr_val
            dmp_median = float(np.nanmedian(dmp_valid)) if dmp_valid.size > 0 else dmp_val
            dmp_max = float(np.nanmax(dmp_valid)) if dmp_valid.size > 0 else dmp_val
        else:
            dmr_median = dmr_val
            dmp_median = dmp_val
            dmp_max = dmp_val

        # Raw height from DMP median - DMR median
        raw_height = max(0.0, dmp_median - dmr_median)
        result["building_height_m"] = round(raw_height, 2)

        # Also store max-based height for reference
        result["building_height_mean_m"] = round(max(0.0, dmp_max - dmr_median), 2)

        # Roof type from DMP variance in window
        if w_dmp is not None and w_dmp.size > 4:
            dmp_std = float(np.nanstd(w_dmp))
            h = raw_height
            if h < 1.0 or dmp_std < 0.3:
                result["roof_type"] = "flat"
            elif dmp_std < 1.5:
                result["roof_type"] = "pitched"
            else:
                result["roof_type"] = "complex"
        else:
            result["roof_type"] = "pitched"  # default

        # Corrected usable building height
        roof_offset = ROOF_OFFSET.get(result.get("roof_type", "pitched"), 0.60)
        num_floors = stevilo_etaz if stevilo_etaz and stevilo_etaz > 0 else 1
        slab_total = SLAB_THICKNESS_M * num_floors

        usable_height = max(0.0, raw_height - roof_offset - slab_total)
        result["building_height_usable_m"] = round(usable_height, 2)

        # Ceiling height per floor (corrected)
        if num_floors > 0 and usable_height > 0:
            result["floor_height_m"] = round(usable_height / num_floors, 2)
        elif stevilo_etaz and stevilo_etaz > 0:
            # Fallback: raw / floors (uncorrected, for audit)
            result["floor_height_m"] = round(raw_height / stevilo_etaz, 2)

    return result


# ─────────────────────────────────────────────
# SOLAR RADIATION
# ─────────────────────────────────────────────

def compute_solar_features(
    dmr: np.ndarray, dmr_transform,
    cx_3794: float, cy_3794: float,
    lat: float, lon: float,
) -> dict:
    """Estimate solar radiation using pvlib or simplified model."""
    result: dict = {}

    sky_view = estimate_sky_view_factor(dmr, dmr_transform, cx_3794, cy_3794)
    result["sky_view_factor"] = sky_view

    if HAS_PVLIB:
        result.update(_pvlib_solar(lat, lon, sky_view))
    else:
        result.update(_simple_solar(lat, sky_view))

    # Shadow scores (simplified: south-facing open = less shadow)
    aspect_deg = None
    w = sample_raster_window(dmr, dmr_transform, cx_3794, cy_3794, 100)
    if w is not None and w.size > 0:
        pixel_size = abs(dmr_transform.a)
        gy, gx = np.gradient(w, pixel_size, pixel_size)
        aspect_rad = np.arctan2(-np.nanmean(gy), np.nanmean(gx))
        aspect_deg = (math.degrees(aspect_rad) + 360) % 360

    svf = sky_view or 0.5
    if aspect_deg is not None:
        # Morning sun from east (90°), afternoon from west (270°)
        east_factor = abs(math.cos(math.radians(aspect_deg - 90))) * 0.5
        west_factor = abs(math.cos(math.radians(aspect_deg - 270))) * 0.5
        result["shadow_morning_score"] = round(1.0 - min(1.0, svf * (0.5 + east_factor)), 3)
        result["shadow_afternoon_score"] = round(1.0 - min(1.0, svf * (0.5 + west_factor)), 3)
    else:
        base_shadow = round(1.0 - svf * 0.8, 3)
        result["shadow_morning_score"] = base_shadow
        result["shadow_afternoon_score"] = base_shadow

    return result


def estimate_sky_view_factor(
    dmr: np.ndarray, transform, cx: float, cy: float, radius_m: float = 200
) -> float:
    """Estimate SVF via horizon angles in 8 directions."""
    if dmr is None:
        return 0.5

    pixel_size = abs(transform.a)
    center_elev = sample_raster(dmr, transform, cx, cy)
    if center_elev is None:
        return 0.5

    horizon_angles = []
    for az_deg in range(0, 360, 45):
        az_rad = math.radians(az_deg)
        dx = math.sin(az_rad)
        dy = -math.cos(az_rad)
        max_angle = 0.0
        for dist in range(int(pixel_size), int(radius_m), int(pixel_size)):
            tx = cx + dx * dist
            ty = cy + dy * dist
            elev = sample_raster(dmr, transform, tx, ty)
            if elev is not None:
                angle = math.degrees(math.atan2(elev - center_elev, dist))
                if angle > max_angle:
                    max_angle = angle
        horizon_angles.append(max_angle)

    mean_horizon = np.mean(horizon_angles)
    svf = max(0.0, min(1.0, 1.0 - mean_horizon / 90.0))
    return round(float(svf), 3)


def _pvlib_solar(lat: float, lon: float, sky_view: float) -> dict:
    """Solar radiation via pvlib."""
    import pvlib
    result = {}
    location = pvlib.location.Location(lat, lon, tz="Europe/Ljubljana", altitude=300)

    for label, months in [("annual", list(range(1,13))), ("summer", [6,7,8]), ("winter", [12,1,2])]:
        total_irr = 0.0
        for month in months:
            times = pvlib.tools.datetime_range(
                start=f"2023-{month:02d}-15",
                end=f"2023-{month:02d}-16",
                freq="1h",
                tz="Europe/Ljubljana",
            )
            solar_pos = location.get_solarposition(times)
            clearsky = location.get_clearsky(times)
            ghi = clearsky["ghi"].sum()
            total_irr += float(ghi) * sky_view
        key = f"solar_radiation_{label}_kwh_m2"
        result[key] = round(total_irr / 1000, 1)

    # Sun hours on solstices
    for label, date in [("summer", "2023-06-21"), ("winter", "2023-12-21")]:
        times = pvlib.tools.datetime_range(start=date, end=date, freq="1h", tz="Europe/Ljubljana",
                                            periods=24)
        solar_pos = location.get_solarposition(times)
        sun_hours = float((solar_pos["elevation"] > 5).sum()) * sky_view
        result[f"sun_hours_{label}_solstice"] = round(sun_hours, 1)

    return result


def _simple_solar(lat: float, sky_view: float) -> dict:
    """Simplified solar model without pvlib."""
    # Average insolation for Slovenia lat range (~46°N)
    annual_base = 1200.0  # kWh/m²/year at 46°N clear sky
    summer_base = 600.0
    winter_base = 150.0

    # Adjust for sky view factor
    svf = sky_view or 0.5
    return {
        "solar_radiation_annual_kwh_m2": round(annual_base * svf, 1),
        "solar_radiation_summer_kwh_m2": round(summer_base * svf, 1),
        "solar_radiation_winter_kwh_m2": round(winter_base * svf, 1),
        "sun_hours_summer_solstice": round(14.0 * svf, 1),
        "sun_hours_winter_solstice": round(8.0 * svf, 1),
    }


# ─────────────────────────────────────────────
# VIEWSHED (ray-casting)
# ─────────────────────────────────────────────

def compute_viewshed_features(
    dmr: np.ndarray, transform,
    cx: float, cy: float,
    observer_height_m: float = 3.0,
    radius_m: float = VIEWSHED_RADIUS_M,
) -> dict:
    """Ray-casting viewshed in 8 directions."""
    result: dict = {}

    center_elev = sample_raster(dmr, transform, cx, cy)
    if center_elev is None:
        result["quality_flag"] = 2
        return result

    observer_elev = center_elev + observer_height_m
    pixel_size = abs(transform.a)
    step_m = max(pixel_size, VIEWSHED_RESOLUTION_M)

    directions = {
        "N": 0, "NE": 45, "E": 90, "SE": 135,
        "S": 180, "SW": 225, "W": 270, "NW": 315,
    }

    dir_scores = {}
    dir_horizons = {}
    mountain_distances = []

    for dir_name, az_deg in directions.items():
        az_rad = math.radians(az_deg)
        dx = math.sin(az_rad)
        dy = -math.cos(az_rad)

        max_angle = -90.0
        first_obstruction_m = radius_m
        visible_count = 0
        total_count = 0

        for dist in np.arange(step_m, radius_m + step_m, step_m):
            tx = cx + dx * float(dist)
            ty = cy + dy * float(dist)
            elev = sample_raster(dmr, transform, tx, ty)
            if elev is None:
                continue

            total_count += 1
            angle = math.degrees(math.atan2(elev - observer_elev, dist))

            if angle <= max_angle:
                visible_count += 1
            else:
                if first_obstruction_m == radius_m:
                    first_obstruction_m = dist
                max_angle = angle

            # Mountain detection: horizon > 10° above horizontal
            if angle > 10.0:
                mountain_distances.append(dist)

        score = (visible_count / total_count * 100) if total_count > 0 else 0.0
        dir_scores[dir_name] = round(score, 1)
        dir_horizons[dir_name] = round(first_obstruction_m, 0)

    # Fill result
    for dir_name in ["n","ne","e","se","s","sw","w","nw"]:
        result[f"viewshed_{dir_name}"] = dir_scores.get(dir_name.upper(), 0.0)

    result["viewshed_score_360"] = round(float(np.mean(list(dir_scores.values()))), 1)
    result["horizon_distance_avg_m"] = round(float(np.mean(list(dir_horizons.values()))), 0)

    if mountain_distances:
        result["mountain_visibility_bool"] = True
        result["mountain_visibility_distance_m"] = round(float(min(mountain_distances)), 0)
    else:
        result["mountain_visibility_bool"] = False
        result["mountain_visibility_distance_m"] = None

    # Openness index
    result["openness_index"] = round(result["viewshed_score_360"] / 100.0, 3)

    return result


# ─────────────────────────────────────────────
# VEGETATION
# ─────────────────────────────────────────────

def compute_vegetation_features(
    dmr: np.ndarray, dmr_transform,
    dmp: np.ndarray, dmp_transform,
    cx: float, cy: float,
) -> dict:
    """Vegetation = DMP - DMR > threshold where no building."""
    result: dict = {}

    for radius, key in [(50, "canopy_cover_50m_pct"), (200, "canopy_cover_200m_pct"), (500, "canopy_cover_500m_pct")]:
        w_dmr = sample_raster_window(dmr, dmr_transform, cx, cy, radius)
        w_dmp = sample_raster_window(dmp, dmp_transform, cx, cy, radius)
        if w_dmr is not None and w_dmp is not None and w_dmr.shape == w_dmp.shape:
            diff = w_dmp - w_dmr
            valid = ~(np.isnan(diff))
            vegetation = (diff > VEGETATION_HEIGHT_THRESHOLD) & valid
            if valid.sum() > 0:
                result[key] = round(float(vegetation.sum() / valid.sum() * 100), 1)

    w200_dmp = sample_raster_window(dmp, dmp_transform, cx, cy, 200)
    w200_dmr = sample_raster_window(dmr, dmr_transform, cx, cy, 200)
    if w200_dmp is not None and w200_dmr is not None and w200_dmp.shape == w200_dmr.shape:
        diff = w200_dmp - w200_dmr
        veg_mask = diff > VEGETATION_HEIGHT_THRESHOLD
        if veg_mask.any():
            veg_heights = diff[veg_mask & ~np.isnan(diff)]
            if veg_heights.size > 0:
                result["tree_height_avg_m"] = round(float(np.mean(veg_heights)), 2)
                result["tree_height_max_m"] = round(float(np.max(veg_heights)), 2)

        pixel_size = abs(dmp_transform.a)
        result["green_space_area_200m_m2"] = round(float(veg_mask.sum() * pixel_size**2), 1)

    # Green visibility for viewshed
    canopy_200 = result.get("canopy_cover_200m_pct", 0) or 0
    result["green_visibility_pct"] = round(canopy_200, 1)

    return result


# ─────────────────────────────────────────────
# PRIVACY & MORPHOLOGY
# ─────────────────────────────────────────────

def compute_privacy_morphology(
    cx_3794: float, cy_3794: float,
    neighbor_buildings: list[dict],
    dmp: Optional[np.ndarray] = None,
    dmp_transform=None,
) -> dict:
    """Privacy and urban morphology from neighboring buildings."""
    result: dict = {}

    if not neighbor_buildings:
        result["building_density_200m"] = 0.0
        result["open_space_ratio_200m"] = 1.0
        result["building_proximity_avg_m"] = 999.0
        result["overlooked_score"] = 0.0
        result["privacy_score"] = 1.0
        result["road_exposure_score"] = 0.0
        return result

    distances = []
    total_area_200 = math.pi * 200**2
    building_area = 0.0
    overlooked_sum = 0.0

    for nb in neighbor_buildings:
        nbx = nb.get("cx") or 0
        nby = nb.get("cy") or 0
        dist = math.sqrt((cx_3794 - nbx)**2 + (cy_3794 - nby)**2)
        if dist < 1:
            continue
        distances.append(dist)

        # Rough building footprint area
        bruto = nb.get("bruto_tlorisna_pov") or 0
        if dist <= 200:
            building_area += bruto or 50  # default 50m² if unknown

        # Overlooked score: higher neighbor + close = privacy risk
        nb_height = nb.get("building_height_m") or 6.0
        if dist < 30 and nb_height > 3.0:
            overlooked_sum += (nb_height / max(dist, 5)) * 0.1

    result["building_density_200m"] = round(len([d for d in distances if d <= 200]) / (math.pi * 0.04) * 1000, 1)
    result["open_space_ratio_200m"] = round(max(0.0, 1.0 - building_area / total_area_200), 3)
    result["building_proximity_avg_m"] = round(float(np.mean(distances)), 1) if distances else 999.0
    result["avg_building_height_200m_m"] = None  # filled by caller

    overlooked = min(1.0, overlooked_sum)
    result["overlooked_score"] = round(overlooked, 3)

    # Privacy composite
    proximity_factor = min(1.0, 20.0 / max(result["building_proximity_avg_m"], 1)) * 0.3
    result["privacy_score"] = round(max(0.0, 1.0 - overlooked * 0.5 - proximity_factor), 3)
    result["road_exposure_score"] = 0.0  # TODO: OSM road data integration

    return result


# ─────────────────────────────────────────────
# DB UTILITIES
# ─────────────────────────────────────────────

def get_gurs_floor_heights(conn, eid_stavba: int) -> Optional[dict]:
    """Fetch GURS declared floor heights from kn_etaze.
    Returns dict with avg/min/max visina_etaze, or None if no data.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("""
            SELECT
                COUNT(*) as floor_count,
                AVG(visina_etaze) as avg_floor_height,
                MIN(visina_etaze) as min_floor_height,
                MAX(visina_etaze) as max_floor_height,
                MIN(nadmorska_visina) as ground_elevation_m
            FROM kn_etaze
            WHERE eid_stavba = %s
              AND visina_etaze IS NOT NULL
              AND visina_etaze > 0.5
              AND visina_etaze < 10.0
        """, (eid_stavba,))
        row = cur.fetchone()
        if row and row["floor_count"] and row["floor_count"] > 0:
            return dict(row)
    except Exception as e:
        log.debug(f"kn_etaze lookup failed for {eid_stavba}: {e}")
    return None


def get_buildings_for_bbox(
    conn, xmin: float, ymin: float, xmax: float, ymax: float
) -> list[dict]:
    """Fetch buildings in bbox from gurs_kn_stavbe."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Try centroid_geom first
    try:
        cur.execute("""
            SELECT
                eid_stavba, ko_id, st_stavbe,
                stevilo_etaz, stevilo_stanovanj, bruto_tlorisna_pov,
                centroid_geom
            FROM gurs_kn_stavbe
            WHERE centroid_geom IS NOT NULL
              AND (centroid_geom->>'x')::float BETWEEN %s AND %s
              AND (centroid_geom->>'y')::float BETWEEN %s AND %s
        """, (xmin, xmax, ymin, ymax))
        rows = cur.fetchall()
        if rows:
            return [dict(r) for r in rows]
    except Exception:
        pass

    # Fallback: ko_id range (approximate)
    cur.execute("""
        SELECT eid_stavba, ko_id, st_stavbe, stevilo_etaz, bruto_tlorisna_pov, centroid_geom
        FROM gurs_kn_stavbe
        LIMIT 1000 OFFSET %s
    """, (0,))
    return [dict(r) for r in cur.fetchall()]


def get_centroid(building: dict) -> Optional[tuple[float, float]]:
    """Extract centroid coordinates from building dict."""
    cg = building.get("centroid_geom")
    if cg is None:
        return None
    if isinstance(cg, str):
        try:
            cg = json.loads(cg)
        except Exception:
            return None
    if isinstance(cg, dict):
        x = cg.get("x") or cg.get("coordinates", [None, None])[0]
        y = cg.get("y") or cg.get("coordinates", [None, None])[1]
        if x and y:
            return float(x), float(y)
    return None


def epsg3794_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert EPSG:3794 to WGS84 (lat, lon). Approximate for SLO."""
    # Simple affine approximation for Slovenia
    lon = (x - 374_000) / (624_000 - 374_000) * (16.61 - 13.37) + 13.37
    lat = (y - 32_000) / (194_000 - 32_000) * (46.88 - 45.42) + 45.42
    return lat, lon


def upsert_batch(conn, rows: list[dict]) -> int:
    if not rows:
        return 0

    columns = [
        "eid_stavba", "elevation_m", "slope_avg_deg", "slope_max_deg",
        "aspect_dominant", "aspect_degrees", "tpi_score", "wetness_index",
        "relative_elevation_100m", "relative_elevation_500m",
        "depression_score", "flood_risk_score",
        "building_height_m", "building_height_mean_m", "roof_type", "floor_height_m",
        "solar_radiation_annual_kwh_m2", "solar_radiation_summer_kwh_m2",
        "solar_radiation_winter_kwh_m2", "sun_hours_summer_solstice",
        "sun_hours_winter_solstice", "sky_view_factor",
        "shadow_morning_score", "shadow_afternoon_score",
        "viewshed_score_360", "viewshed_n", "viewshed_ne", "viewshed_e",
        "viewshed_se", "viewshed_s", "viewshed_sw", "viewshed_w", "viewshed_nw",
        "horizon_distance_avg_m", "mountain_visibility_bool",
        "mountain_visibility_distance_m", "water_visibility_bool",
        "water_visibility_distance_m", "green_visibility_pct", "openness_index",
        "canopy_cover_50m_pct", "canopy_cover_200m_pct", "canopy_cover_500m_pct",
        "tree_height_avg_m", "tree_height_max_m", "green_space_area_200m_m2",
        "building_proximity_avg_m", "overlooked_score", "privacy_score",
        "road_exposure_score", "building_density_200m",
        "avg_building_height_200m_m", "open_space_ratio_200m",
        "viewshed_per_floor",
        "ceiling_height_source",
        "pipeline_version", "dmr_tile_ids", "dmp_tile_ids", "quality_flag",
    ]

    values = []
    for row in rows:
        values.append(tuple(row.get(col) for col in columns))

    col_str = ", ".join(columns)
    update_str = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in columns if c != "eid_stavba"
    )

    cur = conn.cursor()
    psycopg2.extras.execute_values(
        cur,
        f"""
        INSERT INTO lidar_building_features ({col_str})
        VALUES %s
        ON CONFLICT (eid_stavba) DO UPDATE SET {update_str},
            computed_at = NOW()
        """,
        values,
    )
    conn.commit()
    return len(values)


# ─────────────────────────────────────────────
# MAIN PROCESSING
# ─────────────────────────────────────────────

def process_bbox(
    bbox: tuple[float, float, float, float],
    resume: bool = False,
    test_limit: Optional[int] = None,
) -> int:
    """Process all buildings in a bbox cell. Returns count processed."""
    xmin, ymin, xmax, ymax = bbox
    batch_id = f"bbox_{int(xmin)}_{int(ymin)}"

    conn = psycopg2.connect(DB_URL)

    # Check/update progress log
    cur = conn.cursor()
    if resume:
        cur.execute(
            "SELECT status FROM lidar_processing_log WHERE batch_id = %s",
            (batch_id,)
        )
        row = cur.fetchone()
        if row and row[0] == "done":
            log.info(f"[{batch_id}] already done, skipping")
            conn.close()
            return 0

    cur.execute("""
        INSERT INTO lidar_processing_log (batch_id, bbox_xmin, bbox_ymin, bbox_xmax, bbox_ymax,
                                          status, started_at)
        VALUES (%s, %s, %s, %s, %s, 'processing', NOW())
        ON CONFLICT (batch_id) DO UPDATE SET
            status = 'processing', started_at = NOW(), retry_count = lidar_processing_log.retry_count + 1
    """, (batch_id, int(xmin), int(ymin), int(xmax), int(ymax)))
    conn.commit()

    # Fetch buildings
    buildings = get_buildings_for_bbox(conn, xmin, ymin, xmax, ymax)
    if test_limit:
        buildings = buildings[:test_limit]

    if not buildings:
        cur.execute(
            "UPDATE lidar_processing_log SET status='done', completed_at=NOW(), buildings_total=0 WHERE batch_id=%s",
            (batch_id,)
        )
        conn.commit()
        conn.close()
        return 0

    cur.execute(
        "UPDATE lidar_processing_log SET buildings_total=%s WHERE batch_id=%s",
        (len(buildings), batch_id)
    )
    conn.commit()

    log.info(f"[{batch_id}] Processing {len(buildings)} buildings")

    # Prepare rasters
    buffer_m = VIEWSHED_RADIUS_M + 100
    dmr_tiles = get_tiles_for_bbox(xmin, ymin, xmax, ymax, "dmr", buffer_m)
    dmp_tiles = get_tiles_for_bbox(xmin, ymin, xmax, ymax, "dmp", buffer_m)

    log.info(f"[{batch_id}] {len(dmr_tiles)} DMR tiles, {len(dmp_tiles)} DMP tiles")

    # Convert LAZ → GeoTIFF
    dmr_tifs = []
    for t in dmr_tiles:
        tif = get_or_create_geotiff(t, "dmr")
        if tif:
            dmr_tifs.append(tif)

    dmp_tifs = []
    for t in dmp_tiles:
        tif = get_or_create_geotiff(t, "dmp")
        if tif:
            dmp_tifs.append(tif)

    # Merge rasters
    dmr_arr, dmr_transform = merge_rasters(dmr_tifs) if dmr_tifs else (None, None)
    dmp_arr, dmp_transform = merge_rasters(dmp_tifs) if dmp_tifs else (None, None)

    if dmr_arr is None:
        log.warning(f"[{batch_id}] No DMR data, skipping")
        cur.execute(
            "UPDATE lidar_processing_log SET status='failed', error_msg='no DMR data' WHERE batch_id=%s",
            (batch_id,)
        )
        conn.commit()
        conn.close()
        return 0

    dmr_tile_ids = [t.stem for t in dmr_tiles]
    dmp_tile_ids = [t.stem for t in dmp_tiles]

    # Process buildings
    batch_rows = []
    processed = 0
    errors = 0

    for building in buildings:
        try:
            centroid = get_centroid(building)
            if centroid is None:
                errors += 1
                continue

            cx, cy = centroid
            eid = building["eid_stavba"]

            if resume:
                cur.execute(
                    "SELECT 1 FROM lidar_building_features WHERE eid_stavba = %s",
                    (eid,)
                )
                if cur.fetchone():
                    processed += 1
                    continue

            row: dict = {"eid_stavba": eid}

            # Terrain
            terrain = compute_terrain_features(dmr_arr, dmr_transform, cx, cy)
            row.update(terrain)

            # Building height (LiDAR)
            if dmp_arr is not None:
                height = compute_building_height(
                    dmr_arr, dmr_transform,
                    dmp_arr, dmp_transform,
                    cx, cy,
                    building.get("stevilo_etaz"),
                )
                row.update(height)

            # GURS override: use declared visina_etaze if available
            # (more accurate than LiDAR-derived ceiling height)
            gurs_floors = get_gurs_floor_heights(conn, eid)
            if gurs_floors and gurs_floors.get("avg_floor_height"):
                avg_h = float(gurs_floors["avg_floor_height"])
                row["floor_height_m"] = round(avg_h, 2)
                row["ceiling_height_source"] = "gurs_declared"
                # Ground elevation from GURS if LiDAR missed it
                if row.get("elevation_m") is None and gurs_floors.get("ground_elevation_m"):
                    row["elevation_m"] = round(float(gurs_floors["ground_elevation_m"]), 1)
            else:
                row.setdefault("ceiling_height_source", "lidar_corrected")

            # Solar
            lat, lon = epsg3794_to_wgs84(cx, cy)
            solar = compute_solar_features(dmr_arr, dmr_transform, cx, cy, lat, lon)
            row.update(solar)

            # Viewshed
            building_h = row.get("building_height_m") or 3.0
            stevilo_etaz = building.get("stevilo_etaz") or 1
            stevilo_stanovanj = building.get("stevilo_stanovanj") or 0

            # Top floor viewshed (vse stavbe)
            viewshed = compute_viewshed_features(
                dmr_arr, dmr_transform, cx, cy,
                observer_height_m=max(3.0, float(building_h)),
            )
            row.update(viewshed)

            # Per-etaža viewshed samo za večstanovanjske (stevilo_stanovanj > 1)
            if stevilo_stanovanj and stevilo_stanovanj > 1 and stevilo_etaz and stevilo_etaz > 1:
                per_floor = []
                floor_h = float(building_h) / int(stevilo_etaz)
                for floor_num in range(1, int(stevilo_etaz) + 1):
                    observer_h_floor = floor_h * floor_num
                    vs_floor = compute_viewshed_features(
                        dmr_arr, dmr_transform, cx, cy,
                        observer_height_m=max(1.5, observer_h_floor),
                    )
                    per_floor.append({
                        "floor": floor_num,
                        "score_360": vs_floor.get("viewshed_score_360"),
                        "n": vs_floor.get("viewshed_n"),
                        "ne": vs_floor.get("viewshed_ne"),
                        "e": vs_floor.get("viewshed_e"),
                        "se": vs_floor.get("viewshed_se"),
                        "s": vs_floor.get("viewshed_s"),
                        "sw": vs_floor.get("viewshed_sw"),
                        "w": vs_floor.get("viewshed_w"),
                        "nw": vs_floor.get("viewshed_nw"),
                        "mountain": vs_floor.get("mountain_visibility_bool"),
                        "horizon_m": vs_floor.get("horizon_distance_avg_m"),
                    })
                row["viewshed_per_floor"] = json.dumps(per_floor)
            else:
                row["viewshed_per_floor"] = None

            # Vegetation
            if dmp_arr is not None:
                veg = compute_vegetation_features(
                    dmr_arr, dmr_transform, dmp_arr, dmp_transform, cx, cy
                )
                row.update(veg)

            # Privacy/morphology (simplified — no neighbor lookup for now)
            priv = compute_privacy_morphology(cx, cy, [])
            row.update(priv)

            # Meta
            row["pipeline_version"] = PIPELINE_VERSION
            row["dmr_tile_ids"] = dmr_tile_ids
            row["dmp_tile_ids"] = dmp_tile_ids
            row.setdefault("quality_flag", 0)

            batch_rows.append(row)
            processed += 1

            if len(batch_rows) >= CHECKPOINT_EVERY:
                upsert_batch(conn, batch_rows)
                batch_rows = []
                cur.execute(
                    "UPDATE lidar_processing_log SET buildings_processed=%s WHERE batch_id=%s",
                    (processed, batch_id)
                )
                conn.commit()
                log.info(f"[{batch_id}] Checkpoint: {processed}/{len(buildings)}")

        except Exception as e:
            errors += 1
            log.error(f"[{batch_id}] Error on eid_stavba={building.get('eid_stavba')}: {e}")
            continue

    # Final flush
    if batch_rows:
        upsert_batch(conn, batch_rows)

    cur.execute("""
        UPDATE lidar_processing_log
        SET status='done', completed_at=NOW(),
            buildings_processed=%s, error_msg=%s
        WHERE batch_id=%s
    """, (processed, f"{errors} errors" if errors else None, batch_id))
    conn.commit()

    # Free memory
    del dmr_arr, dmp_arr

    log.info(f"[{batch_id}] Done: {processed} processed, {errors} errors")
    conn.close()
    return processed


def generate_bbox_grid() -> list[tuple[float, float, float, float]]:
    """Generate 10km x 10km bbox cells covering Slovenia."""
    cells = []
    x = SLO_XMIN
    while x < SLO_XMAX:
        y = SLO_YMIN
        while y < SLO_YMAX:
            cells.append((x, y, x + BBOX_GRID_SIZE, y + BBOX_GRID_SIZE))
            y += BBOX_GRID_SIZE
        x += BBOX_GRID_SIZE
    return cells


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="LiDAR processing pipeline — RealEstateRadar")
    parser.add_argument(
        "--bbox", type=str,
        help="Bbox v EPSG:3794: 'xmin,ymin,xmax,ymax' (npr. '460000,100000,470000,110000')"
    )
    parser.add_argument("--all", action="store_true", help="Procesira celotno SLO")
    parser.add_argument("--resume", action="store_true", help="Preskoči že processed stavbe/bbox")
    parser.add_argument("--workers", type=int, default=1, help="Število paralelnih procesov (default 1)")
    parser.add_argument("--test", action="store_true", help="Test: 10 stavb iz prve bbox celice")
    parser.add_argument("--floor", type=int, default=None, help="Katera etaža za viewshed (default: top)")
    args = parser.parse_args()

    if not HAS_RASTERIO:
        print("ERROR: rasterio is required. Install: pip install rasterio pdal richdem pvlib psycopg2-binary shapely")
        sys.exit(1)

    # Apply schema first
    conn = psycopg2.connect(DB_URL)
    schema_path = Path(__file__).parent / "lidar-schema.sql"
    if schema_path.exists():
        with open(schema_path) as f:
            sql = f.read()
        conn.cursor().execute(sql)
        conn.commit()
        log.info("Schema applied")
    conn.close()

    if args.test:
        cells = generate_bbox_grid()[:1]
        log.info(f"TEST MODE: Processing 10 buildings from bbox {cells[0]}")
        process_bbox(cells[0], resume=False, test_limit=10)
        return

    if args.bbox:
        parts = [float(x) for x in args.bbox.split(",")]
        bbox = (parts[0], parts[1], parts[2], parts[3])
        process_bbox(bbox, resume=args.resume)
        return

    if args.all:
        cells = generate_bbox_grid()
        log.info(f"Processing {len(cells)} bbox cells ({BBOX_GRID_SIZE/1000:.0f}km grid) across SLO")

        if args.workers > 1:
            with ProcessPoolExecutor(max_workers=args.workers) as executor:
                futures = {
                    executor.submit(process_bbox, cell, args.resume): cell
                    for cell in cells
                }
                for future in as_completed(futures):
                    cell = futures[future]
                    try:
                        n = future.result()
                        log.info(f"Cell {cell} done: {n} buildings")
                    except Exception as e:
                        log.error(f"Cell {cell} failed: {e}")
        else:
            for cell in cells:
                try:
                    process_bbox(cell, resume=args.resume)
                except Exception as e:
                    log.error(f"Cell {cell} failed: {e}")
        return

    parser.print_help()


if __name__ == "__main__":
    main()
