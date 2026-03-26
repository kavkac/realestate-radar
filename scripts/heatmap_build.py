import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
import warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'

print("=== HEATMAP BUILD ===")
conn = psycopg2.connect(DB)

# --- ETN prodaje ---
print("1. ETN prodaje...")
d = pd.read_sql('SELECT id_posla, prodana_povrsina, e_centroid, n_centroid, obcina FROM etn_delistavb', conn)
p = pd.read_sql('SELECT id_posla, pogodbena_cena_odskodnina, trznost_posla, datum_sklenitve_pogodbe FROM etn_posli', conn)
enote = d.groupby('id_posla').size()
d = d[d['id_posla'].isin(enote[enote==1].index)]
df_s = d.merge(p, on='id_posla')
df_s['cena'] = pd.to_numeric(df_s['pogodbena_cena_odskodnina'], errors='coerce')
df_s['pov']  = pd.to_numeric(df_s['prodana_povrsina'], errors='coerce')
df_s['e']    = pd.to_numeric(df_s['e_centroid'], errors='coerce')
df_s['n']    = pd.to_numeric(df_s['n_centroid'], errors='coerce')
df_s['leto'] = pd.to_numeric(df_s['datum_sklenitve_pogodbe'].str[-4:], errors='coerce')
df_s = df_s[(df_s['trznost_posla']=='1') & df_s['cena'].between(20000,5000000) & df_s['pov'].between(15,300) & df_s['e'].notna()].copy()
df_s['eur_m2'] = df_s['cena'] / df_s['pov']
df_s['age']  = 2025 - df_s['leto'].fillna(2020)
df_s['tw']   = np.exp(-np.log(2)/2 * df_s['age'])
df_s['source'] = 'prodaja'
print(f"   {len(df_s):,} transakcij")

# --- ETN najemi → implied vrednost ---
print("2. ETN najemi → implied vrednosti...")
print("2a. Yield surface (inline)...")
rent_tmp = pd.read_sql('''
    SELECT d."POVRSINA_ODDANIH_PROSTOROV" as pov,
           d."E_CENTROID" as e, d."N_CENTROID" as n,
           p."POGODBENA_NAJEMNINA" as najemnina, p."LETO" as leto
    FROM etn_np_delistavb d
    JOIN etn_np_posli p ON d."ID_POSLA" = p."ID_POSLA"
    WHERE d."E_CENTROID" IS NOT NULL
      AND d."POVRSINA_ODDANIH_PROSTOROV" IS NOT NULL
      AND p."POGODBENA_NAJEMNINA" IS NOT NULL
      AND d."VRSTA_ODDANIH_PROSTOROV" = '2'
''', conn)
rent_tmp['pov'] = pd.to_numeric(rent_tmp['pov'], errors='coerce')
rent_tmp['e'] = pd.to_numeric(rent_tmp['e'], errors='coerce')
rent_tmp['n'] = pd.to_numeric(rent_tmp['n'], errors='coerce')
rent_tmp['najemnina'] = pd.to_numeric(rent_tmp['najemnina'], errors='coerce')
rent_tmp['leto'] = pd.to_numeric(rent_tmp['leto'], errors='coerce')
rent_tmp = rent_tmp[rent_tmp['najemnina'].between(50,5000) & rent_tmp['pov'].between(15,300) & rent_tmp['e'].notna()].copy()
rent_tmp['rent_m2_mes'] = rent_tmp['najemnina'] / rent_tmp['pov']
rent_tmp['age'] = 2025 - rent_tmp['leto'].fillna(2020)
rent_tmp['tw'] = np.exp(-np.log(2)/2 * rent_tmp['age'])
r_pts = rent_tmp[['e','n']].values
r_tree = cKDTree(r_pts)
yields_list = []
for i in range(len(df_s)):
    e_v, n_v = df_s['e'].iloc[i], df_s['n'].iloc[i]
    idx_r = r_tree.query_ball_point([e_v, n_v], r=2000)
    if len(idx_r) >= 5:
        rt = rent_tmp.iloc[idx_r]
        rent_m2 = (rt['rent_m2_mes'] * rt['tw']).sum() / rt['tw'].sum()
        gross_yield = (rent_m2 * 1.35 * 12) / df_s['eur_m2'].iloc[i]
        yields_list.append({'e':e_v,'n':n_v,'yield':gross_yield})
    else:
        yields_list.append({'e':e_v,'n':n_v,'yield':np.nan})
yield_df = pd.DataFrame(yields_list)
yield_df = yield_df[yield_df['yield'].between(0.02, 0.15)].reset_index(drop=True)
yield_pts_arr = yield_df[['e','n']].values
yield_tree = cKDTree(yield_pts_arr)
print(f"   Yield surface: {len(yield_df)} parov, median yield={yield_df['yield'].median():.1%}")
# KD-tree za yield lookup

rent_d = pd.read_sql('''
    SELECT d."POVRSINA_ODDANIH_PROSTOROV" as pov,
           d."E_CENTROID" as e, d."N_CENTROID" as n,
           d."OBCINA" as obcina,
           p."POGODBENA_NAJEMNINA" as najemnina,
           p."LETO" as leto
    FROM etn_np_delistavb d
    JOIN etn_np_posli p ON d."ID_POSLA" = p."ID_POSLA"
    WHERE d."E_CENTROID" IS NOT NULL
      AND d."POVRSINA_ODDANIH_PROSTOROV" IS NOT NULL
      AND p."POGODBENA_NAJEMNINA" IS NOT NULL
      AND d."VRSTA_ODDANIH_PROSTOROV" = \'2\'
''', conn)
conn.close()

rent_d['pov']      = pd.to_numeric(rent_d['pov'], errors='coerce')
rent_d['e']        = pd.to_numeric(rent_d['e'], errors='coerce')
rent_d['n']        = pd.to_numeric(rent_d['n'], errors='coerce')
rent_d['najemnina']= pd.to_numeric(rent_d['najemnina'], errors='coerce')
rent_d['leto']     = pd.to_numeric(rent_d['leto'], errors='coerce')
rent_d = rent_d[rent_d['najemnina'].between(50,5000) & rent_d['pov'].between(15,300) & rent_d['e'].notna()].copy()
rent_d['rent_m2_mes'] = rent_d['najemnina'] / rent_d['pov']
rent_d['age'] = 2025 - rent_d['leto'].fillna(2020)
rent_d['tw']  = np.exp(-np.log(2)/2 * rent_d['age'])

# Za vsak najem: poiščemo lokalni yield → implied prodajna cena
print("   Računam implied vrednosti...")
rent_e = rent_d['e'].values
rent_n = rent_d['n'].values
dists, idxs = yield_tree.query(np.column_stack([rent_e, rent_n]), k=1)

local_yield = yield_df['yield'].values[idxs]
# Korigiraj socialne najeme: +35% na tržno vrednost
rent_d['rent_m2_market'] = rent_d['rent_m2_mes'] * 1.35
rent_d['implied_eur_m2'] = (rent_d['rent_m2_market'] * 12) / local_yield
rent_d['source'] = 'najem_implied'

# Filtriraj absurdne implied vrednosti
rent_d = rent_d[rent_d['implied_eur_m2'].between(500, 8000)].copy()
rent_d['eur_m2'] = rent_d['implied_eur_m2']
print(f"   {len(rent_d):,} veljavnih implied vrednosti")
print(f"   Implied median: {rent_d['eur_m2'].median():.0f} €/m²")

# --- Združi vse točke ---
print("3. Združujem točke...")
all_pts = pd.concat([
    df_s[['e','n','eur_m2','tw','source']],
    rent_d[['e','n','eur_m2','tw','source']],
], ignore_index=True)
print(f"   Skupaj: {len(all_pts):,} točk")
print(f"   Prodaje: {(all_pts['source']=='prodaja').sum():,}")
print(f"   Implied: {(all_pts['source']=='najem_implied').sum():,}")

# --- Adaptive GP heatmap ---
print("4. Adaptive heatmap compute...")

pts = all_pts[['e','n']].values
vals = np.log(all_pts['eur_m2'].values)  # log-space za log-normalne cene
weights = all_pts['tw'].values
tree = cKDTree(pts)

# Grid za celotno Slovenijo (EPSG:3794 bounding box)
# Slovenija: e: 374000-624000, n: 33000-194000
E_MIN, E_MAX = 374000, 624000
N_MIN, N_MAX = 33000, 194000
GRID_STEP = 1000  # 1km grid za initial build

e_grid = np.arange(E_MIN, E_MAX, GRID_STEP)
n_grid = np.arange(N_MIN, N_MAX, GRID_STEP)
print(f"   Grid: {len(e_grid)} × {len(n_grid)} = {len(e_grid)*len(n_grid):,} celic")

results = []
MIN_N = 5
MAX_RADIUS = 25000  # max 25km za ruralno

for e_v in e_grid:
    for n_v in n_grid:
        # Adaptive radius: min radius da dobimo MIN_N točk
        for radius in [500, 1000, 2000, 5000, 10000, 25000]:
            idx = tree.query_ball_point([e_v, n_v], r=radius)
            if len(idx) >= MIN_N:
                break
        if len(idx) < MIN_N:
            continue

        comps = all_pts.iloc[idx]
        comp_vals = np.log(comps['eur_m2'].values)
        
        # Spatial decay weight
        dists_c = np.sqrt((comps['e'].values-e_v)**2 + (comps['n'].values-n_v)**2)
        spatial_w = np.exp(-dists_c / (radius * 0.5))
        
        # Prodaje dobijo 3× večjo težo kot implied najemi
        source_w = np.where(comps['source'].values=='prodaja', 3.0, 1.0)
        
        total_w = spatial_w * comps['tw'].values * source_w
        total_w /= total_w.sum()

        # Weighted mean v log-space → back-transform
        mean_log = (comp_vals * total_w).sum()
        price = np.exp(mean_log)

        # Bootstrap CI (100 iterations za speed)
        boot_means = []
        for _ in range(100):
            bi = np.random.choice(len(idx), size=len(idx), replace=True, p=total_w)
            boot_means.append(comp_vals[bi].mean())
        ci_lo = np.exp(np.percentile(boot_means, 10))
        ci_hi = np.exp(np.percentile(boot_means, 90))
        confidence = min(1.0, len(idx) / 30)

        n_sales = (comps['source']=='prodaja').sum()
        n_implied = (comps['source']=='najem_implied').sum()

        results.append({
            'e': e_v, 'n': n_v,
            'price_eur_m2': round(price),
            'ci_lo': round(ci_lo),
            'ci_hi': round(ci_hi),
            'confidence': round(confidence, 2),
            'bandwidth_m': radius,
            'n_comps': len(idx),
            'n_sales': n_sales,
            'n_implied': n_implied,
        })

heatmap = pd.DataFrame(results)
print(f"\n   Aktivnih celic: {len(heatmap):,}")
print(f"   Median bandwidth: {heatmap['bandwidth_m'].median():.0f}m")
print(f"\n   Distribucija cen:")
print(heatmap['price_eur_m2'].describe(percentiles=[.1,.25,.5,.75,.9]))

# Ljubljana preview
lj = heatmap[(heatmap['e'].between(459000,464000)) & (heatmap['n'].between(99000,103000))]
print(f"\n   Ljubljana center ({len(lj)} celic):")
print(f"   Median: {lj['price_eur_m2'].median():.0f} €/m²")
print(f"   Max: {lj['price_eur_m2'].max():.0f} €/m²")

heatmap.to_parquet('/tmp/heatmap_1km.parquet')
print("\n✅ Heatmap shranjen: /tmp/heatmap_1km.parquet")
