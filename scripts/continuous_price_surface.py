"""
Continuous Price Surface — RealEstateRadar
Zvezen model: za vsak (e,n) vrne price_eur_m2 + CI
Brez diskretizacije — query na točnih koordinatah
"""
import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
import warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
conn = psycopg2.connect(DB)

print("=== CONTINUOUS PRICE SURFACE ===\n")

# Vse ETN transakcije (trznost 1+2+5) — čiščene
print("1. Nalagam transakcije...")
d = pd.read_sql("""
    SELECT d.e_centroid, d.n_centroid, d.prodana_povrsina,
           p.pogodbena_cena_odskodnina, p.trznost_posla, p.datum_sklenitve_pogodbe
    FROM etn_delistavb d
    JOIN etn_posli p ON d.id_posla = p.id_posla
    WHERE p.trznost_posla IN ('1','2','5') AND d.e_centroid IS NOT NULL
""", conn)
d['cena']=pd.to_numeric(d['pogodbena_cena_odskodnina'],errors='coerce')
d['pov'] =pd.to_numeric(d['prodana_povrsina'],errors='coerce')
d['e']   =pd.to_numeric(d['e_centroid'],errors='coerce')
d['n']   =pd.to_numeric(d['n_centroid'],errors='coerce')
d['leto']=pd.to_numeric(d['datum_sklenitve_pogodbe'].str[-4:],errors='coerce')
d=d[d['e'].between(374000,624000)&d['n'].between(33000,194000)]
d=d[d['pov'].between(12,300)&d['cena'].between(5000,5_000_000)]
d['eur_m2_raw']=d['cena']/d['pov']
d=d[d['eur_m2_raw'].between(200,12000)]
disc={'1':1.00,'2':1.59,'5':1.22}
tw_map={'1':1.0,'2':0.5,'5':0.6}
d['eur_m2']=d['eur_m2_raw']*d['trznost_posla'].map(disc)
d['age']=2025-d['leto'].fillna(2020)
d['tw']=np.exp(-np.log(2)/2*d['age'])*d['trznost_posla'].map(tw_map)
d['log_price']=np.log(d['eur_m2'])
print(f"   {len(d):,} transakcij")

# Nalagam ETN najeme + implied vrednosti
print("2. Nalagam najeme...")
rent = pd.read_sql('''
    SELECT d."E_CENTROID" as e, d."N_CENTROID" as n,
           d."POVRSINA_ODDANIH_PROSTOROV" as pov,
           p."POGODBENA_NAJEMNINA" as najemnina,
           p."TRZNOST_POSLA" as trznost, p."LETO" as leto
    FROM etn_np_delistavb d
    JOIN etn_np_posli p ON d."ID_POSLA"=p."ID_POSLA"
    WHERE d."E_CENTROID" IS NOT NULL AND d."VRSTA_ODDANIH_PROSTOROV"=\'2\'
      AND p."TRZNOST_POSLA" IN (\'1\',\'4\')
''', conn)
conn.close()
for c in ['e','n','pov','najemnina','leto']: rent[c]=pd.to_numeric(rent[c],errors='coerce')
rent=rent[rent['e'].between(374000,624000)&rent['pov'].between(12,300)&rent['najemnina'].between(80,4000)]
rent['rent_m2']=rent['najemnina']/rent['pov']
rent=rent[rent['rent_m2'].between(2,25)]
rent['rent_m2_market']=np.where(rent['trznost']=='4',rent['rent_m2']*2.20,rent['rent_m2'])
rent['age']=2025-rent['leto'].fillna(2020)
rent['tw']=np.exp(-np.log(2)/2*rent['age'])

# Yield surface za implied vrednosti
r_pts=rent[['e','n']].values; r_tree=cKDTree(r_pts)
s_pts=d[['e','n']].values
yields=[]
for i in range(len(d)):
    idx=r_tree.query_ball_point(s_pts[i],r=3000)
    if len(idx)>=5:
        rt=rent.iloc[idx]; w=rt['tw'].values
        rm2=(rt['rent_m2_market'].values*w).sum()/w.sum()
        yields.append({'e':s_pts[i][0],'n':s_pts[i][1],'yield':(rm2*12)/d['eur_m2'].values[i]})
    else: yields.append({'e':s_pts[i][0],'n':s_pts[i][1],'yield':np.nan})
ydf=pd.DataFrame(yields); valid=ydf['yield'].between(0.01,0.15)
yt=cKDTree(ydf[valid][['e','n']].values); yv=ydf[valid]['yield'].values
dy,iy=yt.query(r_pts,k=1)
rent['implied']=( rent['rent_m2_market']*12)/yv[iy]
rent_ok=rent[rent['implied'].between(500,10000)].copy()
rent_ok['eur_m2']=rent_ok['implied']
rent_ok['tw']=rent_ok['tw']*0.5  # Implied ima polovično težo vs prave prodaje
rent_ok['log_price']=np.log(rent_ok['eur_m2'])
print(f"   {len(rent_ok):,} implied točk")

# Združi
all_pts = pd.concat([
    d[['e','n','log_price','tw']],
    rent_ok[['e','n','log_price','tw']]
], ignore_index=True)
all_e = all_pts['e'].values
all_n = all_pts['n'].values
all_v = all_pts['log_price'].values
all_w = all_pts['tw'].values
main_tree = cKDTree(np.column_stack([all_e, all_n]))
print(f"   Skupaj: {len(all_pts):,} točk")

def query_surface(e, n, min_n=8, max_radius=25000, n_boot=200):
    """
    Zvezna price surface: za vsak (e,n) vrne smooth estimate.
    
    Adaptive bandwidth: najmanjši radius ki vsebuje min_n točk.
    Gaussian spatial kernel: w_spatial = exp(-d²/2σ²) kjer σ=radius/2
    Temporal weight: že vgrajen v all_w
    
    Vrne: (price_eur_m2, ci_lo, ci_hi, bandwidth_m, n_comps)
    """
    for radius in [100,250,500,1000,2000,5000,10000,25000]:
        idx = main_tree.query_ball_point([e,n], r=radius)
        if len(idx) >= min_n:
            break
    if len(idx) < min_n:
        return None, None, None, None, 0

    comp_v = all_v[idx]
    comp_e = all_e[idx]
    comp_n = all_n[idx]
    comp_w = all_w[idx]

    # Gaussian kernel (ne hard cutoff!)
    dists = np.sqrt((comp_e-e)**2 + (comp_n-n)**2)
    sigma = radius / 2.0
    spatial_w = np.exp(-dists**2 / (2*sigma**2))

    total_w = spatial_w * comp_w
    total_w /= total_w.sum()

    mean_log = (comp_v * total_w).sum()
    price = np.exp(mean_log)

    # Bootstrap CI
    boot = [np.exp(comp_v[np.random.choice(len(idx),len(idx),p=total_w)].mean())
            for _ in range(n_boot)]
    ci_lo = np.percentile(boot, 10)
    ci_hi = np.percentile(boot, 90)

    return price, ci_lo, ci_hi, radius, len(idx)

print("\n3. Testiranje zvezne površine na ključnih lokacijah:")
print(f"{'Lokacija':<35} {'€/m²':>7} {'CI':>16} {'BW':>7} {'N':>5}")
print("-"*75)

locations = [
    ("Gallusovo nabrežje 7", 461500, 100900),
    ("Prešernov trg LJ", 461620, 101680),
    ("LJ Bežigrad", 462000, 102000),
    ("LJ Fužine", 464000, 101000),
    ("LJ Šiška", 458000, 103000),
    ("LJ Vič", 457500, 100000),
    ("Maribor center", 540400, 121400),
    ("Koper center", 398500, 44600),
    ("Kranjska Gora", 414800, 151400),
    ("Bled", 427600, 139300),
    ("Portorož", 393200, 42500),
    ("Murska Sobota", 579000, 160000),
    ("Celje center", 521000, 119000),
    ("Novo Mesto", 513000, 75000),
]

for name, e, n in locations:
    p, lo, hi, bw, nc = query_surface(e, n)
    if p:
        print(f"{name:<35} {p:>7,.0f} {lo:>7,.0f}–{hi:<7,.0f} {bw:>6}m {nc:>5}")
    else:
        print(f"{name:<35} {'N/A':>7}")

# Gallusovo detajl
print("\n--- Gallusovo nabrežje 7 detajl ---")
p, lo, hi, bw, nc = query_surface(461500, 100900, n_boot=500)
print(f"Cena:     {p:,.0f} €/m²")
print(f"CI 80%:   {lo:,.0f} – {hi:,.0f} €/m²")
print(f"Bandwidth: {bw}m | Comps: {nc}")
print(f"79.1m² bruto → {p*79.1:,.0f}€  (CI: {lo*79.1:,.0f}–{hi*79.1:,.0f}€)")
print(f"Oče ocena: 450,000–600,000€")

# Shrani query funkcijo in podatke
import joblib, os
os.makedirs('/tmp/rer_surface',exist_ok=True)
np.save('/tmp/rer_surface/all_e.npy', all_e)
np.save('/tmp/rer_surface/all_n.npy', all_n)
np.save('/tmp/rer_surface/all_v.npy', all_v)
np.save('/tmp/rer_surface/all_w.npy', all_w)
print("\n✅ Continuous surface data shranjena")
