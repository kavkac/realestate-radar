import psycopg2, pandas as pd, numpy as np
import warnings, json
warnings.filterwarnings('ignore')
from scipy.spatial import cKDTree
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import cross_val_score, KFold
from sklearn.impute import SimpleImputer
from pyproj import Transformer

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
# WGS84 → EPSG:3794 transformer
wgs2slo = Transformer.from_crs("EPSG:4326", "EPSG:3794", always_xy=True)

conn = psycopg2.connect(DB)

print("ETN...")
d = pd.read_sql("SELECT * FROM etn_delistavb", conn)
p = pd.read_sql("SELECT id_posla, pogodbena_cena_odskodnina, datum_sklenitve_pogodbe, trznost_posla FROM etn_posli", conn)

print("ev_stavba...")
stavbe = pd.read_sql("SELECT eid_stavba, leto_izg_sta, leto_obn_strehe, leto_obn_fasade, id_tip_stavbe, st_etaz, e, n FROM ev_stavba", conn)

print("visine stropov...")
visine = pd.read_sql("SELECT eid_stavba, AVG(visina_etaze_net) as avg_visina_net FROM ev_del_stavbe WHERE visina_etaze_net IS NOT NULL GROUP BY eid_stavba", conn)

print("energy certs...")
energy = pd.read_sql('SELECT "koId"::text as ko_id, "stStavbe"::text as st_stavbe, "energyClass" as energy_class FROM energy_certificates WHERE "energyClass" IS NOT NULL', conn)

print("places_cache...")
places_raw = pd.read_parquet('/tmp/places_features.parquet')
# Convert WGS84 → EPSG:3794
px, py = wgs2slo.transform(places_raw['lng'].values, places_raw['lat'].values)
places_raw['e_slo'] = px
places_raw['n_slo'] = py

conn.close()

# ─── Clean ETN ───
enote = d.groupby('id_posla').size()
d_clean = d[d['id_posla'].isin(enote[enote==1].index)].copy()
df = d_clean.merge(p, on='id_posla')

df['cena'] = pd.to_numeric(df['pogodbena_cena_odskodnina'], errors='coerce')
df['pov']  = pd.to_numeric(df['prodana_povrsina'], errors='coerce')
df['e']    = pd.to_numeric(df['e_centroid'], errors='coerce')
df['n']    = pd.to_numeric(df['n_centroid'], errors='coerce')
df['leto_izg'] = pd.to_numeric(df['leto_izgradnje_dela_stavbe'], errors='coerce')
df['nadstropje'] = pd.to_numeric(df['nadstropje_dela_stavbe'], errors='coerce').fillna(0)
df['sobe'] = pd.to_numeric(df['stevilo_sob'], errors='coerce').fillna(0)

df = df[
    (df['trznost_posla']=='1') &
    df['cena'].between(20000,5000000) &
    df['pov'].between(15,300) &
    df['e'].notna() & df['n'].notna()
].copy()

df['eur_m2'] = df['cena'] / df['pov']
df['log_eur_m2'] = np.log(df['eur_m2'])
df['log_pov'] = np.log(df['pov'])
df['leto_posla'] = pd.to_numeric(df['datum_sklenitve_pogodbe'].str[-4:], errors='coerce').fillna(2020)

def era(y):
    if pd.isna(y): return 3
    if y<1918: return 0
    if y<1945: return 1
    if y<1960: return 2
    if y<1980: return 3
    if y<2000: return 4
    if y<2015: return 5
    return 6
df['era'] = df['leto_izg'].apply(era)

# Distance features
CENTRI = {'lj':(461500,100900),'mb':(539500,120500),'ce':(521500,118500),'kp':(398000,44000),'kr':(438500,131000)}
for ime,(ex,nx) in CENTRI.items():
    df[f'dist_{ime}'] = np.sqrt((df['e']-ex)**2+(df['n']-nx)**2)/1000
df['dist_min'] = df[[f'dist_{k}' for k in CENTRI]].min(axis=1)

df['novogradnja'] = (df['novogradnja']=='1').astype(int)

# Relative floor (nadstropje / st_etaz)
stavbe['e_s'] = pd.to_numeric(stavbe['e'], errors='coerce')
stavbe['n_s'] = pd.to_numeric(stavbe['n'], errors='coerce')
stavbe['st_etaz_n'] = pd.to_numeric(stavbe['st_etaz'], errors='coerce')
stavbe['leto_obn_strehe_n'] = pd.to_numeric(stavbe['leto_obn_strehe'], errors='coerce')
stavbe['leto_obn_fasade_n'] = pd.to_numeric(stavbe['leto_obn_fasade'], errors='coerce')

stavbe_coord = stavbe[stavbe['e_s'].notna() & stavbe['n_s'].notna()].copy()
stavbe_coord['eid_stavba'] = stavbe_coord['eid_stavba'].astype(str)
visine['eid_stavba'] = visine['eid_stavba'].astype(str)
stavbe_coord = stavbe_coord.merge(visine, on='eid_stavba', how='left')

# KD-tree for stavbe
stav_pts = stavbe_coord[['e_s','n_s']].values
stav_tree = cKDTree(stav_pts)

q_pts = np.column_stack([df['e'].values, df['n'].values])
dists, idxs = stav_tree.query(q_pts, k=1)
matched = stavbe_coord.iloc[idxs].reset_index(drop=True)

df['st_etaz_total'] = matched['st_etaz_n'].values
df['rel_floor'] = np.where(df['st_etaz_total']>0, df['nadstropje']/df['st_etaz_total'], np.nan)
df['leto_obn_strehe'] = matched['leto_obn_strehe_n'].values
df['leto_obn_fasade'] = matched['leto_obn_fasade_n'].values
df['obnova_recency'] = np.nanmax([
    np.where(df['leto_obn_strehe'].notna(), 2025-df['leto_obn_strehe'], np.nan),
    np.where(df['leto_obn_fasade'].notna(), 2025-df['leto_obn_fasade'], np.nan)
], axis=0)
df['visina_stropa'] = matched['avg_visina_net'].values

# Energy cert
energy_map = energy.drop_duplicates(['ko_id','st_stavbe']).set_index(['ko_id','st_stavbe'])['energy_class'].to_dict()
ORDER = {'A+':1,'A':2,'B1':3,'B2':4,'C':5,'D':6,'E':7,'F':8,'G':9}
def escore(row):
    key=(str(row['sifra_ko']),str(row['stevilka_stavbe']))
    return ORDER.get(str(energy_map.get(key,'')).upper().strip(), np.nan)
print("Energy certs...")
df['energy_score'] = df.apply(escore, axis=1)

# Places features via KD-tree (EPSG:3794)
print("Places mikrolokacija...")
pl_pts = places_raw[['e_slo','n_slo']].values
pl_tree = cKDTree(pl_pts)
pl_dists, pl_idxs = pl_tree.query(q_pts, k=1)
matched_pl = places_raw.iloc[pl_idxs].reset_index(drop=True)

df['nearest_bus_m']   = matched_pl['nearest_bus_m'].values
df['transit_quality'] = matched_pl["transit_quality"].map({"slaba":1,"srednja":2,"dobra":3,"odlicna":4}).fillna(1).values
df['bus_stops']  = matched_pl['bus_stops'].values
df['tram_stops'] = matched_pl['tram_stops'].values
df['schools_500m']    = matched_pl['schools_500m'].values
df['parks_500m']      = matched_pl['parks_500m'].values

# Street-level premium: median eur_m2 per street (from ETN itself)
print("Street premium...")
df['ulica_clean'] = df['ulica'].str.strip().str.upper().fillna('UNKNOWN')
street_median = df.groupby('ulica_clean')['eur_m2'].median()
df['street_median_eur_m2'] = df['ulica_clean'].map(street_median)
# Smoothed: ulica with <3 transactions → use občina median
obcina_median = df.groupby('obcina')['eur_m2'].median()
street_cnt = df.groupby('ulica_clean')['eur_m2'].count()
df['street_count'] = df['ulica_clean'].map(street_cnt)
df['street_premium'] = np.where(
    df['street_count'] >= 3,
    df['street_median_eur_m2'],
    df['obcina'].map(obcina_median)
)

print(f"\nTraining set: {len(df)} transakcij")

# Coverage report
features = [
    'dist_min','dist_lj','dist_kp','dist_mb',
    'log_pov','sobe','nadstropje','rel_floor','era','novogradnja','leto_posla',
    'visina_stropa','energy_score','obnova_recency',
    'nearest_bus_m','transit_quality','bus_stops','tram_stops',
    'schools_500m','parks_500m',
    'street_premium',
]
print("\nFeature coverage:")
for f in features:
    if f in df.columns:
        cov = df[f].notna().mean()
        print(f"  {f}: {cov:.1%}")

X = df[features].fillna(0).values
y = df['log_eur_m2'].values

imp = SimpleImputer(strategy='median')
X_i = imp.fit_transform(X)

cv = KFold(n_splits=5, shuffle=True, random_state=42)
gb = GradientBoostingRegressor(n_estimators=400, max_depth=5, learning_rate=0.04,
                                subsample=0.8, min_samples_leaf=5, random_state=42)
scores = cross_val_score(gb, X_i, y, cv=cv, scoring='r2')
rmse   = cross_val_score(gb, X_i, y, cv=cv, scoring='neg_root_mean_squared_error')
print(f"\nGradient Boosting v2:")
print(f"  R² = {scores.mean():.3f} ± {scores.std():.3f}")
print(f"  RMSE log = {(-rmse.mean()):.3f} → ~{(np.exp(-rmse.mean())-1)*100:.0f}% napaka v ceni")

gb.fit(X_i, y)
print("\nFeature importance (top 12):")
for f,imp_v in sorted(zip(features, gb.feature_importances_), key=lambda x:-x[1])[:12]:
    print(f"  {f}: {imp_v:.3f}")

# Gallusovo nabrežje 7 — ulica premium
gallusovo_premium = df[df['ulica_clean'].str.contains('GALLUS',na=False)]['eur_m2'].median()
print(f"\nGallusovo nabrežje ETN median: {gallusovo_premium:.0f} €/m²" if not np.isnan(gallusovo_premium) else "\nGallusovo nabrežje: ni ETN transakcij → občina fallback")

test_vals = {
    'dist_min':0.2,'dist_lj':0.2,'dist_kp':68.0,'dist_mb':82.0,
    'log_pov':np.log(80),'sobe':3,'nadstropje':4,'rel_floor':4/6,'era':0,
    'novogradnja':0,'leto_posla':2024,
    'visina_stropa':3.25,'energy_score':np.nan,'obnova_recency':np.nan,
    'nearest_bus_m':200,'transit_quality':5,'bus_stops':8,
    'tram_stops':2,'schools_500m':2,'parks_500m':3,
    'street_premium': gallusovo_premium if not np.isnan(gallusovo_premium) else 5000,
}
test_arr = imp.transform(np.array([[test_vals.get(f,np.nan) for f in features]]))
pred = np.exp(gb.predict(test_arr)[0])
print(f"\nTestna ocena — Gallusovo nabrežje 7 (80m², h=3.25m, 4/6, 1908):")
print(f"  {pred:,.0f} €/m² → skupaj ~{pred*80:,.0f} €")
print(f"  Ciljna vrednost očeta: 450k–600k€ ({450000/80:.0f}–{600000/80:.0f} €/m²)")
