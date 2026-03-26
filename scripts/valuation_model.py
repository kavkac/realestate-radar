#!/usr/bin/env python3
"""
RealEstateRadar — Valuation Model
Full feature set hedonic + gradient boosting model.
Target: best property valuation in Slovenia.
"""

import psycopg2
import pandas as pd
import numpy as np
import warnings
import json
warnings.filterwarnings('ignore')

DB_URL = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'

def load_training_data():
    conn = psycopg2.connect(DB_URL)

    print("Nalagam ETN transakcije...")
    d = pd.read_sql("""
        SELECT id_posla, obcina, prodana_povrsina, dejanska_raba_dela_stavbe,
               stevilo_sob, leto_izgradnje_dela_stavbe, nadstropje_dela_stavbe,
               e_centroid, n_centroid, novogradnja, lega_dela_stavbe_v_stavbi,
               stevilka_stavbe, sifra_ko
        FROM etn_delistavb
    """, conn)

    p = pd.read_sql("""
        SELECT id_posla, pogodbena_cena_odskodnina, datum_sklenitve_pogodbe, trznost_posla
        FROM etn_posli
    """, conn)

    print("Nalagam ev_stavba (obnove, tip, lift)...")
    stavbe = pd.read_sql("""
        SELECT eid_stavba, leto_izg_sta, leto_obn_strehe, leto_obn_fasade,
               id_tip_stavbe, st_etaz, e, n
        FROM ev_stavba
    """, conn)

    print("Nalagam energy_certificates...")
    energy = pd.read_sql("""
        SELECT "koId"::text as ko_id, "stStavbe"::text as st_stavbe, "energyClass" as energy_class
        FROM energy_certificates
        WHERE "energyClass" IS NOT NULL
    """, conn)

    print("Nalagam ARSO noise...")
    noise = pd.read_sql("""
        SELECT lden, noise_class, bbox_xmin, bbox_ymin, bbox_xmax, bbox_ymax
        FROM arso_noise_ldvn
        WHERE lden IS NOT NULL
        LIMIT 200000
    """, conn)

    print("Nalagam višine stropov (ev_del_stavbe)...")
    visine = pd.read_sql("""
        SELECT eid_stavba, 
               AVG(visina_etaze_net) as avg_visina_net,
               MAX(visina_interpretation) as visina_interp
        FROM ev_del_stavbe
        WHERE visina_etaze_net IS NOT NULL
        GROUP BY eid_stavba
    """, conn)

    conn.close()
    return d, p, stavbe, energy, noise, visine


def enrich_features(df, stavbe, energy, noise, visine):
    """Add all available features to ETN transactions."""

    # 1. Filter: 1 enota/posel, tržni, veljavne površine/cene
    enote = df.groupby('id_posla').size()
    d_clean = df[df['id_posla'].isin(enote[enote==1].index)].copy()

    # 2. Numerične osnove
    d_clean['cena'] = pd.to_numeric(d_clean['pogodbena_cena_odskodnina'], errors='coerce')
    d_clean['pov'] = pd.to_numeric(d_clean['prodana_povrsina'], errors='coerce')
    d_clean['e'] = pd.to_numeric(d_clean['e_centroid'], errors='coerce')
    d_clean['n'] = pd.to_numeric(d_clean['n_centroid'], errors='coerce')
    d_clean['leto_izg'] = pd.to_numeric(d_clean['leto_izgradnje_dela_stavbe'], errors='coerce')
    d_clean['nadstropje'] = pd.to_numeric(d_clean['nadstropje_dela_stavbe'], errors='coerce').fillna(0)
    d_clean['sobe'] = pd.to_numeric(d_clean['stevilo_sob'], errors='coerce').fillna(0)

    mask = (
        (d_clean['trznost_posla'] == '1') &
        d_clean['cena'].between(20000, 5000000) &
        d_clean['pov'].between(15, 300) &
        d_clean['e'].notna() & d_clean['n'].notna()
    )
    df_m = d_clean[mask].copy()
    print(f"Čiste tržne transakcije: {len(df_m)}")

    df_m['eur_m2'] = df_m['cena'] / df_m['pov']
    df_m['log_eur_m2'] = np.log(df_m['eur_m2'])
    df_m['log_pov'] = np.log(df_m['pov'])
    df_m['leto_posla'] = pd.to_numeric(
        df_m['datum_sklenitve_pogodbe'].str[-4:], errors='coerce').fillna(2020)

    # Era encoding
    def era(y):
        if pd.isna(y): return 3
        if y < 1918: return 0
        if y < 1945: return 1
        if y < 1960: return 2
        if y < 1980: return 3
        if y < 2000: return 4
        if y < 2015: return 5
        return 6
    df_m['era'] = df_m['leto_izg'].apply(era)

    # Lokacija: razdalja do centrov
    CENTRI = {
        'lj': (461500, 100900),
        'mb': (539500, 120500),
        'ce': (521500, 118500),
        'kp': (398000, 44000),
        'kr': (438500, 131000),
    }
    for ime, (ex, nx) in CENTRI.items():
        df_m[f'dist_{ime}'] = np.sqrt((df_m['e']-ex)**2 + (df_m['n']-nx)**2) / 1000

    df_m['dist_najblizji_center'] = df_m[[f'dist_{k}' for k in CENTRI]].min(axis=1)

    # Novogradnja flag
    df_m['novogradnja'] = (df_m['novogradnja'] == '1').astype(int)

    # 3. Obnove iz ev_stavba (join po koordinatah ~200m radius — approx)
    stavbe['e_s'] = pd.to_numeric(stavbe['e'], errors='coerce')
    stavbe['n_s'] = pd.to_numeric(stavbe['n'], errors='coerce')
    stavbe['leto_obn_strehe'] = pd.to_numeric(stavbe['leto_obn_strehe'], errors='coerce')
    stavbe['leto_obn_fasade'] = pd.to_numeric(stavbe['leto_obn_fasade'], errors='coerce')

    # Match by sifra_ko + stevilka_stavbe if available
    df_m['sifra_ko_str'] = df_m['sifra_ko'].astype(str)
    df_m['st_stavbe_str'] = df_m['stevilka_stavbe'].astype(str)
    stavbe['ko_str'] = stavbe['eid_stavba'].astype(str).str[:4]

    # 4. Energy certificates join (ko_id + st_stavbe)
    energy_map = energy.drop_duplicates(['ko_id','st_stavbe']).set_index(['ko_id','st_stavbe'])['energy_class'].to_dict()

    def energy_score(row):
        key = (str(row['sifra_ko']), str(row['stevilka_stavbe']))
        cls = energy_map.get(key)
        if cls is None: return np.nan
        order = {'A+':1,'A':2,'B1':3,'B2':4,'C':5,'D':6,'E':7,'F':8,'G':9}
        return order.get(str(cls).upper(), np.nan)

    print("Dodajam energy certificates...")
    df_m['energy_score'] = df_m.apply(energy_score, axis=1)
    ec_coverage = df_m['energy_score'].notna().mean()
    print(f"  Energy cert pokritost: {ec_coverage:.1%}")

    # 5. Noise: point-in-bbox lookup
    print("Dodajam hrupnost...")
    noise['lden_val'] = pd.to_numeric(noise['lden'], errors='coerce')
    noise = noise.dropna(subset=['lden_val','bbox_xmin','bbox_ymin','bbox_xmax','bbox_ymax'])
    noise['bbox_xmin'] = pd.to_numeric(noise['bbox_xmin'], errors='coerce')
    noise['bbox_ymin'] = pd.to_numeric(noise['bbox_ymin'], errors='coerce')
    noise['bbox_xmax'] = pd.to_numeric(noise['bbox_xmax'], errors='coerce')
    noise['bbox_ymax'] = pd.to_numeric(noise['bbox_ymax'], errors='coerce')

    def get_noise(e_val, n_val):
        mask = (
            (noise['bbox_xmin'] <= e_val) & (e_val <= noise['bbox_xmax']) &
            (noise['bbox_ymin'] <= n_val) & (n_val <= noise['bbox_ymax'])
        )
        hits = noise[mask]['lden_val']
        return hits.max() if len(hits) > 0 else np.nan

    # Sample noise for a few points to check
    sample_e = df_m['e'].iloc[0]
    sample_n = df_m['n'].iloc[0]
    test_noise = get_noise(sample_e, sample_n)
    print(f"  Test noise lookup: {test_noise} dB")

    # Vectorized noise lookup (approximate - nearest bbox centroid)
    noise['cx'] = (noise['bbox_xmin'] + noise['bbox_xmax']) / 2
    noise['cy'] = (noise['bbox_ymin'] + noise['bbox_ymax']) / 2
    from scipy.spatial import cKDTree
    noise_pts = noise[['cx','cy','lden_val']].dropna().values

    def batch_lookup_kdtree(e_arr, n_arr, pts, radius=500):
        if len(pts) == 0:
            return [np.nan] * len(e_arr)
        tree = cKDTree(pts[:, :2])
        query_pts = np.column_stack([e_arr, n_arr])
        dists, idxs = tree.query(query_pts, k=1, workers=-1)
        vals = pts[idxs, 2].astype(float)
        vals[dists > radius] = np.nan
        return vals.tolist()

    df_m['noise_lden'] = batch_lookup_kdtree(df_m['e'].values, df_m['n'].values, noise_pts)
    noise_cov = df_m['noise_lden'].notna().mean()
    print(f"  Noise pokritost: {noise_cov:.1%}, mean={df_m['noise_lden'].mean():.1f} dB")

    # 6. Višina stropa (ev_del_stavbe)
    print("Dodajam višine stropov...")
    # Join via approximate coordinate match to ev_stavba → eid_stavba → visine
    stavbe_coord = stavbe[stavbe['e_s'].notna() & stavbe['n_s'].notna()][['eid_stavba','e_s','n_s']].copy()
    stavbe_coord['eid_stavba'] = stavbe_coord['eid_stavba'].astype(str)
    visine['eid_stavba'] = visine['eid_stavba'].astype(str)
    stavbe_coord = stavbe_coord.merge(visine, on='eid_stavba', how='left')
    stavbe_with_height = stavbe_coord[stavbe_coord['avg_visina_net'].notna()]
    print(f"  Stavb z višino stropa: {len(stavbe_with_height):,}")

    height_pts = stavbe_with_height[['e_s','n_s','avg_visina_net']].values
    df_m['visina_stropa'] = batch_lookup_kdtree(df_m['e'].values, df_m['n'].values, height_pts, radius=300)
    h_cov = df_m['visina_stropa'].notna().mean()
    print(f"  Višina stropa pokritost: {h_cov:.1%}, mean={df_m['visina_stropa'].mean():.2f}m")

    return df_m


def train_model(df_m):
    from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import Ridge
    from sklearn.model_selection import cross_val_score, KFold
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    import xgboost as xgb

    features = [
        # Prostorske
        'dist_najblizji_center', 'dist_lj', 'dist_mb', 'dist_kp',
        # Stavba
        'log_pov', 'sobe', 'nadstropje', 'era', 'novogradnja', 'leto_posla',
        # Kvaliteta
        'visina_stropa', 'energy_score', 'noise_lden',
    ]

    # Drop features with <5% coverage
    available = []
    for f in features:
        if f in df_m.columns:
            cov = df_m[f].notna().mean()
            print(f"  {f}: {cov:.1%} coverage")
            available.append(f)

    X = df_m[available].values
    y = df_m['log_eur_m2'].values

    imputer = SimpleImputer(strategy='median')
    X_imp = imputer.fit_transform(X)

    cv = KFold(n_splits=5, shuffle=True, random_state=42)

    print(f"\nTraining na {len(df_m)} transakcijah, {len(available)} features:")

    # Gradient Boosting
    gb = GradientBoostingRegressor(n_estimators=300, max_depth=5,
                                    learning_rate=0.05, subsample=0.8,
                                    random_state=42)
    scores = cross_val_score(gb, X_imp, y, cv=cv, scoring='r2')
    rmse = cross_val_score(gb, X_imp, y, cv=cv, scoring='neg_root_mean_squared_error')
    print(f"\nGradient Boosting:")
    print(f"  R² = {scores.mean():.3f} ± {scores.std():.3f}")
    print(f"  RMSE = {(-rmse.mean()):.3f} → ~{(np.exp(-rmse.mean())-1)*100:.0f}% napaka")

    gb.fit(X_imp, y)
    print(f"\nFeature importance:")
    for f, imp in sorted(zip(available, gb.feature_importances_), key=lambda x: -x[1]):
        if imp > 0.005:
            print(f"  {f}: {imp:.3f}")

    # Testna ocena: Gallusovo nabrežje 7
    # 80m², 3 sobe, 4. nadr, 1908 (era=0), dist_lj=0.2km, visina=3.25m, ni novogradnja
    test_vals = {
        'dist_najblizji_center': 0.2, 'dist_lj': 0.2, 'dist_mb': 80.0, 'dist_kp': 70.0,
        'log_pov': np.log(80), 'sobe': 3, 'nadstropje': 4, 'era': 0,
        'novogradnja': 0, 'leto_posla': 2024,
        'visina_stropa': 3.25, 'energy_score': np.nan, 'noise_lden': 60.0,
    }
    test_arr = np.array([[test_vals.get(f, np.nan) for f in available]])
    test_imp = imputer.transform(test_arr)
    pred = np.exp(gb.predict(test_imp)[0])
    print(f"\nTestna ocena — Gallusovo nabrežje 7 (80m², LJ center, h=3.25m):")
    print(f"  {pred:,.0f} €/m² → skupaj ~{pred*80:,.0f} €")

    return gb, imputer, available


if __name__ == '__main__':
    d, p, stavbe, energy, noise, visine = load_training_data()
    d = d.merge(p, on='id_posla', how='left')
    df_m = enrich_features(d, stavbe, energy, noise, visine)
    model, imputer, features = train_model(df_m)
    print("\nDone.")
