"""
Valuation Model v4c — continuous_price_surface kot bazna cena
"""
import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_percentage_error, r2_score
from sklearn.model_selection import train_test_split
from pyproj import Transformer
import json, warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
conn = psycopg2.connect(DB)
print("=== VALUATION MODEL v4c ===\n")

# 1. Continuous surface iz DB
print("1. Nalagam continuous_price_surface...")
cps = pd.read_sql("SELECT e, n, price_eur_m2 FROM continuous_price_surface", conn)
cps_tree = cKDTree(cps[['e','n']].values)
print(f"   {len(cps):,} celic")

# 2. ETN transakcije
print("2. ETN prodaje + REN + energy...")
df = pd.read_sql("""
    SELECT d.e_centroid, d.n_centroid, d.prodana_povrsina,
        p.pogodbena_cena_odskodnina, p.datum_sklenitve_pogodbe,
        s.leto_izg_sta, s.leto_obn_strehe, s.leto_obn_fasade, s.st_etaz,
        ds.st_nadstropja, ds.visina_etaze_net, ds.visina_interpretation,
        ds.povrsina as ren_bruto, ds.ima_dvigalo_dn, ds.id_lega,
        ec."energyClass" as energy_class
    FROM etn_delistavb d
    JOIN etn_posli p ON d.id_posla=p.id_posla AND p.trznost_posla='1'
    LEFT JOIN ev_stavba s ON d.stevilka_stavbe::text=s.stev_st::text AND d.sifra_ko::text=s.ko_sifko::text
    LEFT JOIN ev_del_stavbe ds ON s.eid_stavba=ds.eid_stavba AND d.stevilka_dela_stavbe::text=ds.stev_dst::text
    LEFT JOIN (SELECT DISTINCT ON ("stStavbe","koId") "stStavbe","koId","energyClass"
        FROM energy_certificates WHERE "energyClass" IS NOT NULL ORDER BY "stStavbe","koId","issueDate" DESC
    ) ec ON d.stevilka_stavbe::text=ec."stStavbe"::text AND d.sifra_ko::text=ec."koId"::text
    WHERE d.e_centroid IS NOT NULL
""", conn)

for c in ['prodana_povrsina','e_centroid','n_centroid','pogodbena_cena_odskodnina','ren_bruto']:
    df[c] = pd.to_numeric(df[c], errors='coerce')
df = df[df['e_centroid'].between(374000,624000) & df['n_centroid'].between(33000,194000)]
df = df[df['prodana_povrsina'].between(12,300) & df['pogodbena_cena_odskodnina'].between(20000,5e6)]
df['pov_bruto'] = df['ren_bruto'].fillna(df['prodana_povrsina']*1.317).clip(12,500)
df['eur_m2'] = df['pogodbena_cena_odskodnina'] / df['pov_bruto']
df = df[df['eur_m2'].between(200,10000)].copy()

# Lookup continuous surface
dists, idxs = cps_tree.query(df[['e_centroid','n_centroid']].values, k=1)
df['surface_price'] = cps['price_eur_m2'].values[idxs]
df = df[dists < 1000].copy()  # max 1km od najbližje celice
print(f"   {len(df):,} transakcij z surface lookup")

# 3. ARSO hrup
arso = pd.read_sql("SELECT (bbox_xmin+bbox_xmax)/2 as lon,(bbox_ymin+bbox_ymax)/2 as lat,lden FROM arso_noise_ldvn WHERE lden IS NOT NULL", conn)
tr = Transformer.from_crs("EPSG:4326","EPSG:3794",always_xy=True)
ae,an = tr.transform(arso['lon'].values, arso['lat'].values)
at = cKDTree(np.column_stack([ae,an]))
da,ia = at.query(df[['e_centroid','n_centroid']].values, k=1)
df['lden'] = np.where(da<500, arso['lden'].values[ia], 40.0)

# 4. Transit
places = pd.read_sql("SELECT lat_grid as lat, lng_grid as lon, data->>'transit' as t FROM places_cache WHERE data->>'transit' IS NOT NULL", conn)
conn.close()
pe,pn = tr.transform(places['lon'].astype(float).values, places['lat'].astype(float).values)
pt = cKDTree(np.column_stack([pe,pn]))
def ts(t):
    try: return {'odlicna':4,'dobra':3,'srednja':2,'slaba':1}.get(json.loads(t).get('kvaliteta','slaba'),1)
    except: return 1
places['ts'] = places['t'].apply(ts)
dp,ip = pt.query(df[['e_centroid','n_centroid']].values, k=1)
df['transit_score'] = np.where(dp<2000, places['ts'].values[ip], 1.0)

# 5. Landmarks
LANDMARKS = [
    (461519,100950,1.0),(461650,101050,0.9),(461400,101200,0.9),
    (461700,101300,1.0),(461500,101500,0.8),(461800,102600,0.9),
    (461600,101700,0.7),(461200,100800,0.7),
    (540600,121600,0.8),(540400,121400,0.7),
    (398500,44600,0.9),(427600,139300,1.0),(391400,42900,0.9),
    (393200,42500,0.8),
]
lm_pts=np.array([[l[0],l[1]] for l in LANDMARKS]); lm_w=np.array([l[2] for l in LANDMARKS])
def lm(e,n): return (lm_w/(1+((np.sqrt((lm_pts[:,0]-e)**2+(lm_pts[:,1]-n)**2))/400)**2)).sum()
df['landmark_score'] = [lm(e,n) for e,n in zip(df['e_centroid'],df['n_centroid'])]

# 6. Reka
RIVERS=[(461200,100800),(461400,100850),(461600,100900),(461800,100950),(462000,101000),
        (456000,103000),(458000,103500),(460000,104000),(536000,120000),(540000,121000)]
rt=cKDTree(np.array(RIVERS))
dr,_=rt.query(df[['e_centroid','n_centroid']].values, k=1)
df['river_score']=1/(1+(dr/200)**2)

# 7. Feature engineering
def era(yr):
    if pd.isna(yr): return 3
    for c,v in [(1918,0),(1945,1),(1960,2),(1980,3),(2000,4),(2015,5)]:
        if float(yr)<c: return v
    return 6

df['era']        = pd.to_numeric(df['leto_izg_sta'],errors='coerce').apply(era)
df['st_nads']    = pd.to_numeric(df['st_nadstropja'],errors='coerce')
df['st_etaz_r']  = pd.to_numeric(df['st_etaz'],errors='coerce')
df['floor_ratio']= (df['st_nads'].clip(0,20)/df['st_etaz_r'].clip(1,20)).clip(0,1)
df['ceil_h']     = pd.to_numeric(df['visina_etaze_net'],errors='coerce').clip(2.0,4.5).fillna(2.6)
energy_map={'A+':7,'A':6,'B':5,'C':4,'D':3,'E':2,'F':1,'G':0}
df['energy']     = df['energy_class'].str.strip().map(energy_map).fillna(3.0)
df['sqrt_bruto'] = np.sqrt(df['pov_bruto'])
df['lo']=pd.to_numeric(df['leto_obn_strehe'],errors='coerce')
df['lf']=pd.to_numeric(df['leto_obn_fasade'],errors='coerce')
df['renov']=(np.where(df['lo'].notna(),np.exp(-(2025-df['lo'].fillna(1900))/15),0)+
             np.where(df['lf'].notna(),np.exp(-(2025-df['lf'].fillna(1900))/15),0))/2
df['dvigalo']    = (df['ima_dvigalo_dn']=='D').astype(float)
df['jug_exp']    = df['id_lega'].isin(['J','JV','JZ']).astype(float)
df['hrup_score'] = 1-(df['lden'].clip(30,80)-30)/50
df['log_surface']= np.log(df['surface_price'])

FEATURES = [
    'log_surface',    # ← continuous_price_surface (ne H3!)
    'pov_bruto','sqrt_bruto',
    'era','floor_ratio','ceil_h','energy','renov',
    'dvigalo','jug_exp',
    'hrup_score','landmark_score','transit_score','river_score',
]

df_c = df.dropna(subset=['eur_m2','surface_price','pov_bruto'])
X = df_c[FEATURES].fillna(df_c[FEATURES].median())
y = np.log(df_c['eur_m2'])

X_tr,X_te,y_tr,y_te = train_test_split(X,y,test_size=0.2,random_state=42)
model = GradientBoostingRegressor(n_estimators=400,max_depth=5,learning_rate=0.04,subsample=0.8,random_state=42)
model.fit(X_tr,y_tr)

pred_all = np.exp(model.predict(X))
mape_surf  = mean_absolute_percentage_error(df_c['eur_m2'], df_c['surface_price'])
mape_model = mean_absolute_percentage_error(df_c['eur_m2'], pred_all)
r2 = r2_score(y_te, model.predict(X_te))

print(f"\n   R²:                    {r2:.3f}")
print(f"   MAPE surface only:     {mape_surf:.1%}")
print(f"   MAPE model v4c:        {mape_model:.1%}")

fi=pd.Series(model.feature_importances_,index=FEATURES).sort_values(ascending=False)
print("\n   Feature importance:")
for f,v in fi.items(): print(f"   {f:<22}: {v:.3f}")

# TEST: Gallusovo
print("\n=== TEST: Gallusovo nabrežje 7 ===")
e_g,n_g=461500,100900
_,ig=cps_tree.query([[e_g,n_g]],k=1)
sp=cps['price_eur_m2'].values[ig[0]]
test=pd.DataFrame([{
    'log_surface': np.log(sp),
    'pov_bruto':79.1,'sqrt_bruto':np.sqrt(79.1),
    'era':0,'floor_ratio':4/6,'ceil_h':3.25,'energy':2,'renov':0.1,
    'dvigalo':0.0,'jug_exp':0.0,'hrup_score':0.70,
    'landmark_score':lm(e_g,n_g),'transit_score':4.0,
    'river_score':1/(1+(180/200)**2),
}])
eur_m2=np.exp(model.predict(test.fillna(0))[0])
print(f"   Surface baseline: {sp:,} €/m²")
print(f"   Model v4c ocena:  {eur_m2:,.0f} €/m²")
print(f"   Skupaj (79.1m²):  {eur_m2*79.1:,.0f}€")
print(f"   Oče:              450,000–600,000€")

import joblib, os
os.makedirs('/tmp/rer_model',exist_ok=True)
joblib.dump(model,'/tmp/rer_model/v4c.pkl')
print("\n✅ Model v4c shranjen")
