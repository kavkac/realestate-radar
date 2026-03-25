-- LiDAR Building Features Schema
-- Preračunane vrednosti iz DMR + DMP za vsako stavbo v SLO
-- Enkratni izračun, trajno shranjeno. Ne briši brez razloga.
--
-- Pogon: psql $DATABASE_URL -f scripts/lidar-schema.sql

-- ─────────────────────────────────────────────
-- ENUM types
-- ─────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE aspect_dir AS ENUM ('N','NE','E','SE','S','SW','W','NW','flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE roof_kind AS ENUM ('flat','pitched','complex','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- MAIN TABLE: lidar_building_features
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lidar_building_features (

    -- Identity
    eid_stavba              BIGINT          PRIMARY KEY
                                            REFERENCES gurs_kn_stavbe(eid_stavba)
                                            ON DELETE CASCADE,

    -- ── TERRAIN (iz DMR) ───────────────────────
    elevation_m             NUMERIC(7,2),   -- nadmorska višina centroida
    slope_avg_deg           NUMERIC(5,2),   -- povprečni nagib parcele
    slope_max_deg           NUMERIC(5,2),   -- max nagib
    aspect_dominant         aspect_dir,     -- pretežna orientacija nagiba
    aspect_degrees          NUMERIC(5,1),   -- eksaktna orientacija 0-360
    tpi_score               NUMERIC(6,3),   -- Topographic Position Index (greben/dolina)
    wetness_index           NUMERIC(6,3),   -- Compound TWI
    relative_elevation_100m NUMERIC(6,2),   -- višina vs povprečje okolice r=100m
    relative_elevation_500m NUMERIC(6,2),   -- višina vs povprečje okolice r=500m
    depression_score        NUMERIC(4,3),   -- 0-1, ali je v kotanji (poplave!)
    flood_risk_score        NUMERIC(4,3),   -- 0-1 composite (depression + flow acc)

    -- ── BUILDING HEIGHT (DMP - DMR) ────────────
    building_height_m       NUMERIC(5,2),   -- max(DMP) - min(DMR) v footprintu
    building_height_mean_m  NUMERIC(5,2),   -- mean(DMP) - mean(DMR)
    roof_type               roof_kind       DEFAULT 'unknown',
    building_height_usable_m NUMERIC(5,2),  -- korigirana bivalna višina (brez strehe + plošč)
    floor_height_m          NUMERIC(4,2),   -- višina etaže: GURS visina_etaze ali LiDAR korigirano
    mansarda_detected       BOOLEAN DEFAULT FALSE,
    mansarda_floor_num      INT,            -- katera etaža je mansarda
    mansarda_avg_height_m   NUMERIC(4,2),  -- povprečna svetla višina mansarde
    mansarda_usable_pct     NUMERIC(5,1),  -- % tlorisne površine z višino ≥ 2.2m

    -- ── SOLAR & LIGHT ──────────────────────────
    solar_radiation_annual_kwh_m2   NUMERIC(7,1),   -- letna sončna energija
    solar_radiation_summer_kwh_m2   NUMERIC(6,1),   -- junij-avgust
    solar_radiation_winter_kwh_m2   NUMERIC(6,1),   -- december-februar
    sun_hours_summer_solstice        NUMERIC(4,1),   -- ure direktnega sonca 21.6.
    sun_hours_winter_solstice        NUMERIC(4,1),   -- ure direktnega sonca 21.12.
    sky_view_factor                  NUMERIC(4,3),   -- 0-1, % vidnega neba
    shadow_morning_score             NUMERIC(4,3),   -- 0-1 zasenčenost zjutraj (9:00)
    shadow_afternoon_score           NUMERIC(4,3),   -- 0-1 zasenčenost popoldne (15:00)

    -- ── VIEWSHED ────────────────────────────────
    --
    -- Hiše (stevilo_stanovanj <= 1): samo top floor
    -- Večstanovanjski (stevilo_stanovanj > 1): per etaža kot JSONB
    --
    -- Top floor viewshed (vse stavbe):
    viewshed_score_360      NUMERIC(5,1),   -- povprečje vseh smeri, top floor
    viewshed_n              NUMERIC(5,1),
    viewshed_ne             NUMERIC(5,1),
    viewshed_e              NUMERIC(5,1),
    viewshed_se             NUMERIC(5,1),
    viewshed_s              NUMERIC(5,1),
    viewshed_sw             NUMERIC(5,1),
    viewshed_w              NUMERIC(5,1),
    viewshed_nw             NUMERIC(5,1),
    horizon_distance_avg_m  NUMERIC(7,1),
    mountain_visibility_bool         BOOLEAN,
    mountain_visibility_distance_m   NUMERIC(7,1),
    water_visibility_bool            BOOLEAN,
    water_visibility_distance_m      NUMERIC(7,1),
    green_visibility_pct             NUMERIC(5,1),
    openness_index                   NUMERIC(4,3),

    -- Per-etaža viewshed (samo večstanovanjski, stevilo_stanovanj > 1):
    -- Format: [{"floor": 1, "score_360": 45.2, "n": 30.1, "ne": ..., "mountain": false}, ...]
    viewshed_per_floor      JSONB,          -- NULL za hiše

    -- ── VEGETATION ─────────────────────────────
    canopy_cover_50m_pct    NUMERIC(5,1),   -- % drevesne krošnje r=50m
    canopy_cover_200m_pct   NUMERIC(5,1),
    canopy_cover_500m_pct   NUMERIC(5,1),
    tree_height_avg_m       NUMERIC(5,2),
    tree_height_max_m       NUMERIC(5,2),
    green_space_area_200m_m2 NUMERIC(10,1),

    -- ── PRIVACY & NOISE PROXY ──────────────────
    building_proximity_avg_m NUMERIC(7,1),  -- povprečna razdalja do sosednjih stavb
    overlooked_score        NUMERIC(4,3),   -- 0-1, koliko sosednjih oken "gleda" noter
    privacy_score           NUMERIC(4,3),   -- 0-1 composite
    road_exposure_score     NUMERIC(4,3),   -- 0-1 izpostavljenost cesti

    -- ── URBAN MORPHOLOGY ───────────────────────
    building_density_200m   NUMERIC(7,1),   -- stavb/km² v r=200m
    avg_building_height_200m_m NUMERIC(5,2),
    open_space_ratio_200m   NUMERIC(4,3),   -- 0-1, % nepozidanega prostora

    -- ── META ───────────────────────────────────
    computed_at             TIMESTAMPTZ     DEFAULT NOW(),
    pipeline_version        TEXT,           -- za recompute tracking
    dmr_tile_ids            TEXT[],         -- kateri DMR tile-i so bili uporabljeni
    dmp_tile_ids            TEXT[],
    quality_flag            SMALLINT        DEFAULT 0
        -- 0=ok, 1=edge_tile, 2=missing_data, 3=failed
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lbf_viewshed_360
    ON lidar_building_features (viewshed_score_360 DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_lbf_mountain
    ON lidar_building_features (mountain_visibility_bool)
    WHERE mountain_visibility_bool = true;

CREATE INDEX IF NOT EXISTS idx_lbf_solar
    ON lidar_building_features (solar_radiation_annual_kwh_m2 DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_lbf_flood
    ON lidar_building_features (flood_risk_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_lbf_quality
    ON lidar_building_features (quality_flag);

CREATE INDEX IF NOT EXISTS idx_lbf_computed_at
    ON lidar_building_features (computed_at DESC);

-- ─────────────────────────────────────────────
-- PROGRESS TRACKING
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lidar_processing_log (
    batch_id            TEXT            PRIMARY KEY,
    -- Format: 'bbox_{xmin}_{ymin}' v EPSG:3794 (10km grid)
    bbox_xmin           INTEGER,
    bbox_ymin           INTEGER,
    bbox_xmax           INTEGER,
    bbox_ymax           INTEGER,
    status              TEXT            DEFAULT 'pending'
        CHECK (status IN ('pending','processing','done','failed')),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    buildings_total     INTEGER,
    buildings_processed INTEGER         DEFAULT 0,
    error_msg           TEXT,
    retry_count         INTEGER         DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lpl_status
    ON lidar_processing_log (status);
