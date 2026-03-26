import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
from psycopg2.extras import execute_values
import warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'

print("=== HEATMAP BUILD (with categories) ===")
conn = psycopg2.connect(DB)

# --- Category classifier ---
def classify_raba(raba):
    if raba is None: return "residential"
    r = str(raba).lower()
    if "stanovan" in r: return "residential"
    if "poslovn" in r or "pisarn" in r or "trgovin" in r: return "commercial"
    if "garaž" in r or "parkirn" in r or "garaz" in r: return "garage"
    if "klet" in r: return "storage"
    if "kmetij" in r or "pridelk" in r: return "agricultural"
    return "other"

# --- ETN prodaje ---
print("1. ETN prodaje...")
d = pd.read_sql("""
    SELECT id_posla, prodana_povrsina, e_centroid, n_centroid, obcina,
           dejanska_raba_dela_stavbe as raba
    FROM etn_delistavb
""", conn)
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
df_s['category'] = df_s['raba'].apply(classify_raba)
print(f"   {len(df_s):,} transakcij")
print(f"   Categories: {df_s['category'].value_counts().to_dict()}")

# --- ETN najemi -> implied vrednost ---
print("2. ETN najemi -> implied vrednosti...")
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

rent_d['pov']      = pd.to_numeric(rent_d['pov'], errors='coerce')
rent_d['e']        = pd.to_numeric(rent_d['e'], errors='coerce')
rent_d['n']        = pd.to_numeric(rent_d['n'], errors='coerce')
rent_d['najemnina']= pd.to_numeric(rent_d['najemnina'], errors='coerce')
rent_d['leto']     = pd.to_numeric(rent_d['leto'], errors='coerce')
rent_d = rent_d[rent_d['najemnina'].between(50,5000) & rent_d['pov'].between(15,300) & rent_d['e'].notna()].copy()
rent_d['rent_m2_mes'] = rent_d['najemnina'] / rent_d['pov']
rent_d['age'] = 2025 - rent_d['leto'].fillna(2020)
rent_d['tw']  = np.exp(-np.log(2)/2 * rent_d['age'])

# Za vsak najem: lokalni yield -> implied prodajna cena
print("   Racunam implied vrednosti...")
rent_e = rent_d['e'].values
rent_n = rent_d['n'].values
dists, idxs = yield_tree.query(np.column_stack([rent_e, rent_n]), k=1)

local_yield = yield_df['yield'].values[idxs]
rent_d['rent_m2_market'] = rent_d['rent_m2_mes'] * 1.35
rent_d['implied_eur_m2'] = (rent_d['rent_m2_market'] * 12) / local_yield
rent_d['source'] = 'najem_implied'
rent_d['category'] = 'residential'  # rental implied = residential

rent_d = rent_d[rent_d['implied_eur_m2'].between(500, 8000)].copy()
rent_d['eur_m2'] = rent_d['implied_eur_m2']
print(f"   {len(rent_d):,} veljavnih implied vrednosti")
print(f"   Implied median: {rent_d['eur_m2'].median():.0f} EUR/m2")

# --- Zdruzeni vse tocke ---
print("3. Zdruzujem tocke...")
all_pts = pd.concat([
    df_s[['e','n','eur_m2','tw','source','category']],
    rent_d[['e','n','eur_m2','tw','source','category']],
], ignore_index=True)
print(f"   Skupaj: {len(all_pts):,} tock")
print(f"   Prodaje: {(all_pts['source']=='prodaja').sum():,}")
print(f"   Implied: {(all_pts['source']=='najem_implied').sum():,}")
print(f"   By category: {all_pts['category'].value_counts().to_dict()}")

# --- DB migration ---
print("3b. DB migration...")
cur = conn.cursor()
cur.execute("ALTER TABLE continuous_price_surface ADD COLUMN IF NOT EXISTS confidence FLOAT")
cur.execute("ALTER TABLE continuous_price_surface ADD COLUMN IF NOT EXISTS n_sales INT")
cur.execute("ALTER TABLE continuous_price_surface ADD COLUMN IF NOT EXISTS n_implied INT")
cur.execute("ALTER TABLE continuous_price_surface ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'all'")
# Drop old PK/unique on (e,n), create new unique on (e,n,category)
cur.execute("ALTER TABLE continuous_price_surface DROP CONSTRAINT IF EXISTS continuous_price_surface_pkey")
cur.execute("DROP INDEX IF EXISTS idx_cps_en")
cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_cps_en_cat ON continuous_price_surface(e, n, category)")
cur.execute("CREATE INDEX IF NOT EXISTS idx_cps_cat ON continuous_price_surface(category)")
conn.commit()
print("   DB migration done")

# --- Surface computation function ---
E_MIN, E_MAX = 374000, 624000
N_MIN, N_MAX = 33000, 194000
GRID_STEP = 1000
MIN_N = 5

e_grid = np.arange(E_MIN, E_MAX, GRID_STEP)
n_grid = np.arange(N_MIN, N_MAX, GRID_STEP)

def compute_surface(data, category_name):
    print(f"\n4. Adaptive heatmap compute [{category_name}] ({len(data):,} pts)...")
    if len(data) < MIN_N:
        print(f"   SKIP: too few points ({len(data)})")
        return []

    pts = data[['e','n']].values
    vals = np.log(data['eur_m2'].values)
    tree = cKDTree(pts)

    results = []
    for e_v in e_grid:
        for n_v in n_grid:
            for radius in [500, 1000, 2000, 5000, 10000, 25000]:
                idx = tree.query_ball_point([e_v, n_v], r=radius)
                if len(idx) >= MIN_N:
                    break
            if len(idx) < MIN_N:
                continue

            comps = data.iloc[idx]
            comp_vals = np.log(comps['eur_m2'].values)

            dists_c = np.sqrt((comps['e'].values-e_v)**2 + (comps['n'].values-n_v)**2)
            spatial_w = np.exp(-dists_c / (radius * 0.5))
            source_w = np.where(comps['source'].values=='prodaja', 3.0, 1.0)

            total_w = spatial_w * comps['tw'].values * source_w
            total_w /= total_w.sum()

            mean_log = (comp_vals * total_w).sum()
            price = np.exp(mean_log)

            boot_means = []
            for _ in range(100):
                bi = np.random.choice(len(idx), size=len(idx), replace=True, p=total_w)
                boot_means.append(comp_vals[bi].mean())
            ci_lo = np.exp(np.percentile(boot_means, 10))
            ci_hi = np.exp(np.percentile(boot_means, 90))
            confidence = min(1.0, len(idx) / 30)

            n_sales = (comps['source']=='prodaja').sum()
            n_implied = (comps['source']=='najem_implied').sum()

            results.append((
                int(e_v), int(n_v), round(price), round(ci_lo), round(ci_hi),
                round(confidence, 2), int(radius), len(idx), int(n_sales), int(n_implied),
                category_name
            ))

    print(f"   [{category_name}] {len(results):,} active cells")
    return results

# --- Build surfaces per category ---
categories = {
    'all': all_pts,
    'residential': all_pts[all_pts['category'] == 'residential'],
    'commercial': all_pts[all_pts['category'] == 'commercial'],
}

all_results = []
for cat_name, cat_data in categories.items():
    cat_data = cat_data.reset_index(drop=True)
    res = compute_surface(cat_data, cat_name)
    all_results.extend(res)

print(f"\n5. Writing {len(all_results):,} cells to DB...")
# Delete existing rows for categories we're rebuilding
for cat_name in categories:
    cur.execute("DELETE FROM continuous_price_surface WHERE category = %s", (cat_name,))

execute_values(cur, """
    INSERT INTO continuous_price_surface
        (e, n, price_eur_m2, ci_lo, ci_hi, confidence, bandwidth_m, n_comps, n_sales, n_implied, category)
    VALUES %s
    ON CONFLICT (e, n, category) DO UPDATE SET
        price_eur_m2 = EXCLUDED.price_eur_m2,
        ci_lo = EXCLUDED.ci_lo,
        ci_hi = EXCLUDED.ci_hi,
        confidence = EXCLUDED.confidence,
        bandwidth_m = EXCLUDED.bandwidth_m,
        n_comps = EXCLUDED.n_comps,
        n_sales = EXCLUDED.n_sales,
        n_implied = EXCLUDED.n_implied,
        computed_at = CURRENT_DATE
""", all_results, page_size=5000)
conn.commit()
print(f"   Written {len(all_results):,} cells")

# Verify
for cat_name in categories:
    cur.execute("SELECT COUNT(*) FROM continuous_price_surface WHERE category = %s", (cat_name,))
    cnt = cur.fetchone()[0]
    print(f"   {cat_name}: {cnt:,} cells in DB")

# Ljubljana preview
for cat_name in ['all', 'residential', 'commercial']:
    cur.execute("""
        SELECT AVG(price_eur_m2), MAX(price_eur_m2), COUNT(*)
        FROM continuous_price_surface
        WHERE category = %s AND e BETWEEN 459000 AND 464000 AND n BETWEEN 99000 AND 103000
    """, (cat_name,))
    r = cur.fetchone()
    if r[2] > 0:
        print(f"   LJ center [{cat_name}]: avg={r[0]:.0f} max={r[1]:,} EUR/m2 ({r[2]} cells)")

conn.close()
print("\nDone!")
