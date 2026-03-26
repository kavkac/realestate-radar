import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
import warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
conn = psycopg2.connect(DB)

print("=== HEATMAP v4 — WIDE INPUT ===\n")

# ETN prodaje — trznost 1, 2, 5
print("1. ETN prodaje (trznost 1+2+5)...")
d = pd.read_sql("""
    SELECT d.id_posla, d.prodana_povrsina, d.e_centroid, d.n_centroid,
           p.pogodbena_cena_odskodnina, p.trznost_posla, p.datum_sklenitve_pogodbe
    FROM etn_delistavb d
    JOIN etn_posli p ON d.id_posla = p.id_posla
    WHERE p.trznost_posla IN ('1','2','5')
""", conn)

d['cena'] = pd.to_numeric(d['pogodbena_cena_odskodnina'], errors='coerce')
d['pov']  = pd.to_numeric(d['prodana_povrsina'], errors='coerce')
d['e']    = pd.to_numeric(d['e_centroid'], errors='coerce')
d['n']    = pd.to_numeric(d['n_centroid'], errors='coerce')
d['leto'] = pd.to_numeric(d['datum_sklenitve_pogodbe'].str[-4:], errors='coerce')

# Ena enota/posel
enote = d.groupby('id_posla').size()
d = d[d['id_posla'].isin(enote[enote==1].index)]

# Hard filters
d = d[d['e'].between(374000,624000) & d['n'].between(33000,194000)]
d = d[d['pov'].between(12,500)]
d = d[d['cena'].between(5000,5_000_000)]
d['eur_m2_raw'] = d['cena'] / d['pov']
d = d[d['eur_m2_raw'].between(200,12000)]

# Trznost discount → prilagodi na tržno vrednost
# trznost=1: 1.0×, trznost=2: 1.59× (median razmerje), trznost=5: 1.22×
discount = {'1': 1.00, '2': 1.59, '5': 1.22}
d['trznost_weight'] = d['trznost_posla'].map({'1': 1.0, '2': 0.5, '5': 0.6})
d['eur_m2'] = d['eur_m2_raw'] * d['trznost_posla'].map(discount)
d = d[d['eur_m2'].between(300,12000)]

# Lokalni IQR (samo na trznost=1 za kalibracijo, ostale preskočimo za hitrost)
# Za trznost=2,5 zaupamo diskontu
pts_all = d[['e','n']].values
tree_all = cKDTree(pts_all)
is_out = np.zeros(len(d), dtype=bool)
for i in range(len(d)):
    _, idx = tree_all.query(pts_all[i], k=min(31,len(d)))
    neigh = d['eur_m2'].values[idx[1:]]
    q1,q3 = np.percentile(neigh,[25,75])
    iqr = q3-q1
    v = d['eur_m2'].values[i]
    if v < q1-3*iqr or v > q3+3*iqr:
        is_out[i] = True
d = d[~is_out]

d['age'] = 2025 - d['leto'].fillna(2020)
d['tw']  = np.exp(-np.log(2)/2 * d['age']) * d['trznost_weight']
d['source'] = 'prodaja'

print(f"   Čistih prodaj: {len(d):,}")
print(f"   trznost=1: {(d['trznost_posla']=='1').sum():,}")
print(f"   trznost=2: {(d['trznost_posla']=='2').sum():,}")
print(f"   trznost=5: {(d['trznost_posla']=='5').sum():,}")
print(f"   Median: {d['eur_m2'].median():.0f} €/m²")

# ETN najemi
print("\n2. ETN najemi (118k čistih)...")
rent = pd.read_sql('''
    SELECT d."POVRSINA_ODDANIH_PROSTOROV" as pov,
           d."E_CENTROID" as e, d."N_CENTROID" as n,
           d."VRSTA_ODDANIH_PROSTOROV" as vrsta,
           p."POGODBENA_NAJEMNINA" as najemnina,
           p."TRZNOST_POSLA" as trznost, p."LETO" as leto
    FROM etn_np_delistavb d
    JOIN etn_np_posli p ON d."ID_POSLA" = p."ID_POSLA"
    WHERE d."E_CENTROID" IS NOT NULL
      AND d."VRSTA_ODDANIH_PROSTOROV" = \'2\'
      AND p."TRZNOST_POSLA" IN (\'1\',\'4\')
''', conn)
conn.close()

for c in ['pov','e','n','najemnina','leto']:
    rent[c] = pd.to_numeric(rent[c], errors='coerce')
rent = rent[rent['e'].between(374000,624000) & rent['n'].between(33000,194000)]
rent = rent[rent['pov'].between(12,500) & rent['najemnina'].between(80,4000)]
rent['rent_m2'] = rent['najemnina'] / rent['pov']
rent = rent[rent['rent_m2'].between(2,25)]
# Social discount: ×2.20
rent['rent_m2_market'] = np.where(rent['trznost']=='4', rent['rent_m2']*2.20, rent['rent_m2'])
rent['age'] = 2025 - rent['leto'].fillna(2020)
rent['tw']  = np.exp(-np.log(2)/2 * rent['age'])
print(f"   {len(rent):,} najemov")

# Yield surface
print("\n3. Yield surface...")
rent_pts = rent[['e','n']].values
rent_tree = cKDTree(rent_pts)
sale_pts = d[['e','n']].values
yields = []
for i in range(len(d)):
    idx = rent_tree.query_ball_point(sale_pts[i], r=3000)
    if len(idx) >= 5:
        rt = rent.iloc[idx]
        w = rt['tw'].values
        rm2 = (rt['rent_m2_market'].values * w).sum() / w.sum()
        gy = (rm2 * 12) / d['eur_m2'].values[i]
        yields.append({'e':sale_pts[i][0],'n':sale_pts[i][1],'yield':gy})
    else:
        yields.append({'e':sale_pts[i][0],'n':sale_pts[i][1],'yield':np.nan})
ydf = pd.DataFrame(yields)
valid = ydf['yield'].between(0.01,0.15)
print(f"   Veljavni yield pari: {valid.sum()} | median yield: {ydf[valid]['yield'].median():.1%}")
y_tree = cKDTree(ydf[valid][['e','n']].values)
y_vals = ydf[valid]['yield'].values

# Implied vrednosti
dists_y, idxs_y = y_tree.query(rent_pts, k=1)
local_y = y_vals[idxs_y]
rent['implied_eur_m2'] = (rent['rent_m2_market'] * 12) / local_y
rent = rent[rent['implied_eur_m2'].between(500,10000)]
rent['eur_m2'] = rent['implied_eur_m2']
rent['source'] = 'najem_implied'
print(f"   Implied vrednosti: {len(rent):,} | median: {rent['eur_m2'].median():.0f} €/m²")

# Združi
all_pts = pd.concat([d[['e','n','eur_m2','tw','source']], rent[['e','n','eur_m2','tw','source']]], ignore_index=True)
print(f"\n4. Skupaj točk: {len(all_pts):,}")

# Heatmap grid
a_e = all_pts['e'].values; a_n = all_pts['n'].values
a_v = np.log(all_pts['eur_m2'].values); a_w = all_pts['tw'].values
a_s = all_pts['source'].values
main_tree = cKDTree(np.column_stack([a_e,a_n]))

e_grid = np.arange(374000,624000,1000)
n_grid = np.arange(33000,194000,1000)
print(f"   Grid: {len(e_grid)}×{len(n_grid)} = {len(e_grid)*len(n_grid):,} celic")

results = []
for e_v in e_grid:
    for n_v in n_grid:
        for radius in [500,1000,2000,5000,10000,25000]:
            idx = main_tree.query_ball_point([e_v,n_v], r=radius)
            if len(idx) >= 5: break
        if len(idx) < 5: continue
        comp_v = a_v[idx]; comp_s = a_s[idx]
        dists_c = np.sqrt((a_e[idx]-e_v)**2+(a_n[idx]-n_v)**2)
        sw = np.exp(-dists_c/(radius*0.5))
        srcw = np.where(comp_s=='prodaja', 5.0, 1.0)
        tw = sw * a_w[idx] * srcw; tw /= tw.sum()
        price = np.exp((comp_v*tw).sum())
        boot = [np.exp(comp_v[np.random.choice(len(idx),len(idx),p=tw)].mean()) for _ in range(50)]
        n_s = int((comp_s=='prodaja').sum())
        results.append({'e':e_v,'n':n_v,'price_eur_m2':round(price),
            'ci_lo':round(np.percentile(boot,10)),'ci_hi':round(np.percentile(boot,90)),
            'confidence':round(min(1.0,n_s/10+len(idx)/50*0.3),2),
            'bandwidth_m':radius,'n_comps':len(idx),'n_sales':n_s,'n_implied':len(idx)-n_s})

heatmap = pd.DataFrame(results)
print(f"\n✅ Aktivnih celic: {len(heatmap):,}")
print(heatmap['price_eur_m2'].describe(percentiles=[.1,.25,.5,.75,.9]))

for name,e,n in [("Gallusovo",461500,100900),("LJ Bežigrad",462000,102000),("Koper",398000,44000),("Maribor",540000,121000),("Kranjska Gora",414000,150000)]:
    c = heatmap.iloc[((heatmap['e']-e)**2+(heatmap['n']-n)**2).idxmin()]
    print(f"   {name:<20} {c['price_eur_m2']:>6,} €/m² | sales={c['n_sales']} impl={c['n_implied']} bw={c['bandwidth_m']}m")

heatmap.to_parquet('/tmp/heatmap_final.parquet')
print("\n✅ Heatmap shranjen: /tmp/heatmap_final.parquet")
