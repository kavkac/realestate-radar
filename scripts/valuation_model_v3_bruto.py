import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_percentage_error, r2_score
from sklearn.model_selection import train_test_split
import joblib, os, warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
conn = psycopg2.connect(DB)
print("=== VALUATION MODEL v3 (bruto površina) ===")

hm = pd.read_sql("SELECT e, n, price_eur_m2 FROM price_heatmap WHERE n_sales >= 3", conn)
hm_tree = cKDTree(hm[['e','n']].values)
print(f"Heatmap: {len(hm):,} celic")

df = pd.read_sql("""
    SELECT
        d.sifra_ko, d.stevilka_stavbe, d.stevilka_dela_stavbe,
        d.prodana_povrsina, d.e_centroid, d.n_centroid,
        p.pogodbena_cena_odskodnina, p.datum_sklenitve_pogodbe,
        s.leto_izg_sta, s.leto_obn_strehe, s.leto_obn_fasade, s.st_etaz,
        ds.st_nadstropja, ds.visina_etaze_net, ds.visina_interpretation,
        ds.povrsina as ren_bruto, ds.upor_pov as ren_neto,
        ec."energyClass" as energy_class
    FROM etn_delistavb d
    JOIN etn_posli p ON d.id_posla = p.id_posla AND p.trznost_posla = '1'
    LEFT JOIN ev_stavba s ON d.stevilka_stavbe::text = s.stev_st::text
                          AND d.sifra_ko::text = s.ko_sifko::text
    LEFT JOIN ev_del_stavbe ds ON s.eid_stavba = ds.eid_stavba
                               AND d.stevilka_dela_stavbe::text = ds.stev_dst::text
    LEFT JOIN (
        SELECT DISTINCT ON ("stStavbe", "koId") "stStavbe", "koId", "energyClass"
        FROM energy_certificates WHERE "energyClass" IS NOT NULL
        ORDER BY "stStavbe","koId","issueDate" DESC
    ) ec ON d.stevilka_stavbe::text = ec."stStavbe"::text
         AND d.sifra_ko::text = ec."koId"::text
    WHERE d.e_centroid IS NOT NULL
""", conn)
conn.close()

for c in ['prodana_povrsina','e_centroid','n_centroid','pogodbena_cena_odskodnina',
          'ren_bruto','ren_neto']:
    df[c] = pd.to_numeric(df[c], errors='coerce')

df['leto_tr'] = pd.to_numeric(df['datum_sklenitve_pogodbe'].str[-4:], errors='coerce')
df = df[df['e_centroid'].between(374000,624000) & df['n_centroid'].between(33000,194000)]
df = df[df['prodana_povrsina'].between(12,300) & df['pogodbena_cena_odskodnina'].between(20000,5e6)]

# BRUTO površina: REN bruto ako je, sicer ETN * 1.317
df['pov_bruto'] = df['ren_bruto'].fillna(df['prodana_povrsina'] * 1.317).clip(12,500)
# Cena/m² računamo na BRUTO
df['eur_m2'] = df['pogodbena_cena_odskodnina'] / df['pov_bruto']
df = df[df['eur_m2'].between(200,10000)]

# Koliko ima REN bruto
pct_ren = df['ren_bruto'].notna().mean()
print(f"REN bruto pokritost: {pct_ren:.1%} | median bruto: {df['pov_bruto'].median():.0f}m²")

# Heatmap lookup
dists, idxs = hm_tree.query(df[['e_centroid','n_centroid']].values, k=1)
df['heatmap_price'] = hm['price_eur_m2'].values[idxs]
df = df[dists < 3000].copy()
df['price_ratio'] = df['eur_m2'] / df['heatmap_price']
print(f"Training: {len(df):,} | price_ratio median={df['price_ratio'].median():.3f}")

# Features
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
df['renov'] = (np.where(df['lo'].notna(), np.exp(-(yr_now-df['lo'].fillna(1900))/15),0) +
               np.where(df['lf'].notna(), np.exp(-(yr_now-df['lf'].fillna(1900))/15),0))/2

FEATURES = ['heatmap_price','pov_bruto','sqrt_bruto','era',
            'floor_ratio','ceil_h','ceil_unc','energy','renov']

df_c = df.dropna(subset=['price_ratio','heatmap_price','pov_bruto'])
print(f"Clean: {len(df_c):,}")

X = df_c[FEATURES].fillna(df_c[FEATURES].median())
y = np.log(df_c['price_ratio'].clip(0.3,3.0))

X_tr,X_te,y_tr,y_te = train_test_split(X,y,test_size=0.2,random_state=42)
model = GradientBoostingRegressor(n_estimators=300,max_depth=4,learning_rate=0.05,random_state=42)
model.fit(X_tr,y_tr)
y_pred = model.predict(X_te)

pred_all = np.exp(model.predict(X)) * df_c['heatmap_price'].values
mape_hm    = mean_absolute_percentage_error(df_c['eur_m2'], df_c['heatmap_price'])
mape_final = mean_absolute_percentage_error(df_c['eur_m2'], pred_all)
print(f"MAPE heatmap:       {mape_hm:.1%}")
print(f"MAPE heatmap+model: {mape_final:.1%}")

fi = pd.Series(model.feature_importances_, index=FEATURES).sort_values(ascending=False)
print("\nFeature importance:")
for f,v in fi.items(): print(f"  {f:<22}: {v:.3f}")

# Gallusovo: 80m² neto → ~105m² bruto (×1.317)
_,ig = hm_tree.query([[461500,100900]],k=1)
hmp = hm['price_eur_m2'].values[ig[0]]
pov_bruto = 80 * 1.317
test = pd.DataFrame([{'heatmap_price':hmp,'pov_bruto':pov_bruto,'sqrt_bruto':np.sqrt(pov_bruto),
    'era':0,'floor_ratio':4/6,'ceil_h':3.25,'ceil_unc':0,'energy':2,'renov':0.1}])
adj = np.exp(model.predict(test)[0])
eur_m2_bruto = hmp*adj
total = eur_m2_bruto * pov_bruto
print(f"\nGallusovo (80m² neto = {pov_bruto:.0f}m² bruto):")
print(f"  {hmp:,} × {adj:.3f} = {eur_m2_bruto:,.0f} €/m² (bruto)")
print(f"  Skupaj: {total:,.0f}€")
print(f"  Oče ocena: 450k–600k€")

os.makedirs('/tmp/rer_model',exist_ok=True)
joblib.dump(model,'/tmp/rer_model/adjustment_model_v3_bruto.pkl')
print("\n✅ Model shranjen")
