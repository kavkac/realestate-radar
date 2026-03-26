"""
RealEstateRadar — Valuation Model v4
H3 heatmap baseline + full feature set:
- ARSO lden (hrup)
- Landmark proximity (1/r² decay)
- Transit quality (places_cache)
- Dvigalo, orientacija
- Razdalja do reke/centra
- Era, višina stropa, energija, renovacija
"""
import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_percentage_error, r2_score
from sklearn.model_selection import train_test_split
from pyproj import Transformer
import joblib, os, warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
conn = psycopg2.connect(DB)
print("=== VALUATION MODEL v4 ===\n")

# --- H3 heatmap (adaptive resolucija) ---
print("1. H3 heatmap...")
hm = pd.read_sql("SELECT e, n, price_eur_m2, h3_res FROM price_heatmap_h3", conn)
hm_tree = cKDTree(hm[['e','n']].values)
print(f"   {len(hm):,} H3 celic (adaptive 66m–1.2km)")

# --- ETN tržne prodaje + REN + energy v enem joinu ---
print("2. ETN prodaje + REN + energy...")
df = pd.read_sql("""
    SELECT
        d.sifra_ko, d.stevilka_stavbe, d.stevilka_dela_stavbe,
        d.prodana_povrsina, d.e_centroid, d.n_centroid,
        p.pogodbena_cena_odskodnina, p.datum_sklenitve_pogodbe,
        s.leto_izg_sta, s.leto_obn_strehe, s.leto_obn_fasade, s.st_etaz,
        ds.st_nadstropja, ds.visina_etaze_net, ds.visina_interpretation,
        ds.povrsina as ren_bruto,
        ds.ima_dvigalo_dn,
        ds.id_lega,
        ec."energyClass" as energy_class
    FROM etn_delistavb d
    JOIN etn_posli p ON d.id_posla = p.id_posla AND p.trznost_posla = '1'
    LEFT JOIN ev_stavba s ON d.stevilka_stavbe::text = s.stev_st::text
                          AND d.sifra_ko::text = s.ko_sifko::text
    LEFT JOIN ev_del_stavbe ds ON s.eid_stavba = ds.eid_stavba
                               AND d.stevilka_dela_stavbe::text = ds.stev_dst::text
    LEFT JOIN (
        SELECT DISTINCT ON ("stStavbe","koId") "stStavbe","koId","energyClass"
        FROM energy_certificates WHERE "energyClass" IS NOT NULL
        ORDER BY "stStavbe","koId","issueDate" DESC
    ) ec ON d.stevilka_stavbe::text = ec."stStavbe"::text
         AND d.sifra_ko::text = ec."koId"::text
    WHERE d.e_centroid IS NOT NULL
""", conn)

for c in ['prodana_povrsina','e_centroid','n_centroid','pogodbena_cena_odskodnina','ren_bruto']:
    df[c] = pd.to_numeric(df[c], errors='coerce')
df['leto_tr'] = pd.to_numeric(df['datum_sklenitve_pogodbe'].str[-4:], errors='coerce')
df = df[df['e_centroid'].between(374000,624000) & df['n_centroid'].between(33000,194000)]
df = df[df['prodana_povrsina'].between(12,300) & df['pogodbena_cena_odskodnina'].between(20000,5e6)]
df['pov_bruto'] = df['ren_bruto'].fillna(df['prodana_povrsina']*1.317).clip(12,500)
df['eur_m2'] = df['pogodbena_cena_odskodnina'] / df['pov_bruto']
df = df[df['eur_m2'].between(200,10000)]
print(f"   {len(df):,} transakcij")

# H3 heatmap lookup
dists, idxs = hm_tree.query(df[['e_centroid','n_centroid']].values, k=1)
df['heatmap_price'] = hm['price_eur_m2'].values[idxs]
df['heatmap_res']   = hm['h3_res'].values[idxs]
df = df[dists < 5000].copy()
df['price_ratio'] = df['eur_m2'] / df['heatmap_price']
print(f"   {len(df):,} v dosegu H3 heatmapa | ratio median={df['price_ratio'].median():.3f}")

# --- ARSO hrup ---
print("3. ARSO lden noise lookup...")
arso = pd.read_sql("""
    SELECT (bbox_xmin+bbox_xmax)/2 as lon, (bbox_ymin+bbox_ymax)/2 as lat, lden
    FROM arso_noise_ldvn WHERE lden IS NOT NULL
""", conn)
# Pretvori ARSO WGS84 → EPSG:3794
tr = Transformer.from_crs("EPSG:4326","EPSG:3794",always_xy=True)
arso_e, arso_n = tr.transform(arso['lon'].values, arso['lat'].values)
arso_tree = cKDTree(np.column_stack([arso_e, arso_n]))
dists_a, idxs_a = arso_tree.query(df[['e_centroid','n_centroid']].values, k=1)
df['lden'] = np.where(dists_a < 500, arso['lden'].values[idxs_a], 40.0)  # fallback: tih 40dB
print(f"   lden pokritost (<500m): {(dists_a<500).mean():.1%} | median={df['lden'].median():.0f} dB")

# --- Landmark proximity (1/r²) ---
print("4. Landmark proximity...")
# Ključni landmarks za Slovenijo (e, n, prestige_weight, name)
LANDMARKS = [
    # Ljubljana
    (461519, 100950, 1.0, "Vodnjak Robba"),
    (461650, 101050, 0.9, "Šuštarski most"),
    (461400, 101200, 0.9, "NUK"),
    (461700, 101300, 1.0, "Tromostovje"),
    (461500, 101500, 0.8, "Kongresni trg"),
    (461800, 102600, 0.9, "Grad Ljubljana"),
    (461600, 101700, 0.7, "Prešernov trg"),
    (461200, 100800, 0.7, "Stari trg"),
    (462700, 103200, 0.6, "BTC"),
    # Maribor
    (540600, 121600, 0.8, "Mariborski grad"),
    (540400, 121400, 0.7, "Maribor Lent"),
    # Koper
    (398500, 44600, 0.9, "Koper Titov trg"),
    # Kranjska Gora
    (414800, 151400, 0.7, "Kranjska Gora center"),
    # Bled
    (427600, 139300, 1.0, "Blejsko jezero"),
    (427400, 139200, 0.9, "Blejski grad"),
    # Portorož
    (393200, 42500, 0.8, "Portorož plaža"),
    # Piran
    (391400, 42900, 0.9, "Piran Tartinijev trg"),
]

landmark_pts = np.array([[l[0],l[1]] for l in LANDMARKS])
landmark_w   = np.array([l[2] for l in LANDMARKS])
HALFLIFE = 400  # 400m halflife za 1/r²

def landmark_score(e, n):
    dists = np.sqrt((landmark_pts[:,0]-e)**2 + (landmark_pts[:,1]-n)**2)
    scores = landmark_w / (1 + (dists/HALFLIFE)**2)
    return scores.sum()

sale_e = df['e_centroid'].values
sale_n = df['n_centroid'].values
df['landmark_score'] = [landmark_score(e,n) for e,n in zip(sale_e,sale_n)]
print(f"   Landmark score: median={df['landmark_score'].median():.3f}, max={df['landmark_score'].max():.3f}")

# --- Transit quality (places_cache) ---
print("5. Transit quality...")
places = pd.read_sql("""
    SELECT lat_grid as lat, lng_grid as lon, data->>'transit' as transit_json
    FROM places_cache WHERE data->>'transit' IS NOT NULL
""", conn)
tr2 = Transformer.from_crs("EPSG:4326","EPSG:3794",always_xy=True)
pl_e, pl_n = tr2.transform(places['lon'].astype(float).values, places['lat'].astype(float).values)
places_tree = cKDTree(np.column_stack([pl_e, pl_n]))
import json
def transit_score(transit_json):
    try:
        t = json.loads(transit_json) if isinstance(transit_json,str) else transit_json
        q = t.get('kvaliteta','slaba')
        return {'odlicna':4,'dobra':3,'srednja':2,'slaba':1}.get(q,1)
    except: return 1
places['transit_score'] = places['transit_json'].apply(transit_score)
dists_p, idxs_p = places_tree.query(df[['e_centroid','n_centroid']].values, k=1)
df['transit_score'] = np.where(dists_p<2000, places['transit_score'].values[idxs_p], 1.0)
print(f"   Transit pokritost: {(dists_p<2000).mean():.1%} | median score={df['transit_score'].median():.0f}")

conn.close()

# --- Razdalja do reke (Ljubljanica, Sava, Drava, Soča) ---
print("6. Razdalja do rek...")
RIVERS = [
    # Ljubljanica skozi LJ (approx točke)
    (461200,100800),(461400,100850),(461600,100900),(461800,100950),
    (462000,101000),(462200,101100),(462400,101200),
    # Sava (LJ)
    (456000,103000),(458000,103500),(460000,104000),(462000,104500),
    # Drava (MB)
    (536000,120000),(538000,120500),(540000,121000),(542000,121500),
    # Soča (Nova Gorica)
    (385000,94000),(387000,93000),(389000,92000),
]
river_tree = cKDTree(np.array(RIVERS))
dists_r, _ = river_tree.query(df[['e_centroid','n_centroid']].values, k=1)
df['dist_river_m'] = dists_r
df['river_score'] = 1/(1+(dists_r/200)**2)  # 1/r², halflife 200m
print(f"   Median razdalja do reke: {np.median(dists_r):.0f}m")

# --- Feature engineering ---
print("7. Feature engineering...")
def era(yr):
    if pd.isna(yr): return 3
    yr=float(yr)
    for cutoff,code in [(1918,0),(1945,1),(1960,2),(1980,3),(2000,4),(2015,5)]:
        if yr<cutoff: return code
    return 6

df['visina_net'] = pd.to_numeric(df['visina_etaze_net'], errors='coerce')
df['st_nads']    = pd.to_numeric(df['st_nadstropja'], errors='coerce')
df['st_etaz_r']  = pd.to_numeric(df['st_etaz'], errors='coerce')
df['leto_izg']   = pd.to_numeric(df['leto_izg_sta'], errors='coerce')
df['era']        = df['leto_izg'].apply(era)
df['floor_ratio']= (df['st_nads'].clip(0,20)/df['st_etaz_r'].clip(1,20)).clip(0,1)
df['ceil_h']     = df['visina_net'].clip(2.0,4.5).fillna(2.6)
df['ceil_unc']   = df['visina_interpretation'].isin(['uncertain','unknown']).astype(float)
energy_map = {'A+':7,'A':6,'B':5,'C':4,'D':3,'E':2,'F':1,'G':0}
df['energy'] = df['energy_class'].str.strip().map(energy_map).fillna(3.0)
df['sqrt_bruto'] = np.sqrt(df['pov_bruto'])
yr_now = 2025
df['lo'] = pd.to_numeric(df['leto_obn_strehe'], errors='coerce')
df['lf'] = pd.to_numeric(df['leto_obn_fasade'], errors='coerce')
df['renov'] = (np.where(df['lo'].notna(),np.exp(-(yr_now-df['lo'].fillna(1900))/15),0)+
               np.where(df['lf'].notna(),np.exp(-(yr_now-df['lf'].fillna(1900))/15),0))/2
df['dvigalo'] = (df['ima_dvigalo_dn']=='D').astype(float)
# Orientacija: jug=1 (premium), sever=0
df['jug_exp'] = df['id_lega'].isin(['J','JV','JZ']).astype(float)
# Hrup: višji lden = slabše (normaliziran 0-1, obrnjeno)
df['hrup_score'] = 1 - (df['lden'].clip(30,80)-30)/50

FEATURES = [
    'heatmap_price',    # H3 bazna cena
    'pov_bruto',        # bruto površina
    'sqrt_bruto',       # nelinearni efekt
    'era',              # obdobje gradnje
    'floor_ratio',      # relativna etaža
    'ceil_h',           # višina stropa
    'ceil_unc',         # zanesljivost višine
    'energy',           # energetski razred
    'renov',            # renovacija
    'dvigalo',          # dvigalo
    'jug_exp',          # južna orientacija
    'hrup_score',       # ARSO hrup (obrnjeno)
    'landmark_score',   # landmark proximity 1/r²
    'transit_score',    # transit kakovost
    'river_score',      # bližina reke 1/r²
]

df_c = df.dropna(subset=['price_ratio','heatmap_price','pov_bruto'])
print(f"\n   Clean za model: {len(df_c):,}")
print(f"\n   Feature pokritost:")
for f in FEATURES:
    print(f"   {f:<20}: {df_c[f].notna().mean()*100:.0f}%")

X = df_c[FEATURES].fillna(df_c[FEATURES].median())
y = np.log(df_c['price_ratio'].clip(0.3,3.0))

X_tr,X_te,y_tr,y_te = train_test_split(X,y,test_size=0.2,random_state=42)
model = GradientBoostingRegressor(n_estimators=400,max_depth=4,learning_rate=0.04,random_state=42)
model.fit(X_tr,y_tr)
y_pred = model.predict(X_te)

pred_all = np.exp(model.predict(X)) * df_c['heatmap_price'].values
mape_hm    = mean_absolute_percentage_error(df_c['eur_m2'], df_c['heatmap_price'])
mape_final = mean_absolute_percentage_error(df_c['eur_m2'], pred_all)
r2 = r2_score(y_te, model.predict(X_te))
print(f"\n   R²: {r2:.3f}")
print(f"   MAPE samo H3 heatmap:   {mape_hm:.1%}")
print(f"   MAPE H3 + model v4:     {mape_final:.1%}")

fi = pd.Series(model.feature_importances_, index=FEATURES).sort_values(ascending=False)
print("\n   Feature importance:")
for f,v in fi.items(): print(f"   {f:<22}: {v:.3f}")

# --- TEST: Gallusovo nabrežje 7, Enota 4 ---
print("\n=== TEST: Gallusovo nabrežje 7, Enota 4 ===")
e_g,n_g = 461500,100900
_,ig = hm_tree.query([[e_g,n_g]],k=1)
hmp = hm['price_eur_m2'].values[ig[0]]
lm_score = landmark_score(e_g,n_g)
river_sc = 1/(1+(180/200)**2)  # 180m do Ljubljanice

test = pd.DataFrame([{
    'heatmap_price': hmp,
    'pov_bruto': 79.1,
    'sqrt_bruto': np.sqrt(79.1),
    'era': 0,          # pre-1918
    'floor_ratio': 4/6,
    'ceil_h': 3.25,
    'ceil_unc': 0,
    'energy': 2,       # E razred
    'renov': 0.1,
    'dvigalo': 0.0,    # stara stavba, brez dvigala
    'jug_exp': 0.0,    # orientacija ni połudna
    'hrup_score': 0.65, # LJ center ~45dB → score=(1-(45-30)/50)=0.70
    'landmark_score': lm_score,
    'transit_score': 4.0,  # odlična (LJ center)
    'river_score': river_sc,
}])
adj = np.exp(model.predict(test)[0])
eur_m2 = hmp * adj
total = eur_m2 * 79.1
print(f"   H3 heatmap (66m hex): {hmp:,} €/m²")
print(f"   Landmark score:       {lm_score:.3f}")
print(f"   River score:          {river_sc:.3f}")
print(f"   Adjustment factor:    ×{adj:.3f}")
print(f"   Končna ocena:         {eur_m2:,.0f} €/m² → {total:,.0f}€")
print(f"   Oče ocena:            450,000–600,000€")

os.makedirs('/tmp/rer_model',exist_ok=True)
joblib.dump(model,'/tmp/rer_model/adjustment_model_v4.pkl')
print("\n✅ Model v4 shranjen")
