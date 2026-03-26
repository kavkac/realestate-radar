"""
RealEstateRadar — H3 Adaptive Heatmap
Adaptive hexagonalni grid: gostejši tam kjer je več podatkov
"""
import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
import h3
from pyproj import Transformer
import warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'

# H3 resolution → approximate hex diameter
# res 7:  ~1,220m (ruralno)
# res 8:  ~  461m (podeželska mesta)
# res 9:  ~  174m (predmestja)
# res 10: ~   66m (mestno jedro)
MIN_SALES_PER_HEX = 5  # min transakcij za zanesljiv hex

# EPSG:3794 → WGS84 za H3
transformer = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)

def to_wgs84(e, n):
    lon, lat = transformer.transform(e, n)
    return lat, lon

def to_slo(lat, lon):
    rev = Transformer.from_crs("EPSG:4326", "EPSG:3794", always_xy=True)
    e, n = rev.transform(lon, lat)
    return e, n

conn = psycopg2.connect(DB)
print("=== H3 ADAPTIVE HEATMAP ===\n")

print("1. ETN prodaje (trznost 1+2+5)...")
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
disc={'1':1.00,'2':1.59,'5':1.22}; tw_map={'1':1.0,'2':0.5,'5':0.6}
d['eur_m2']=d['eur_m2_raw']*d['trznost_posla'].map(disc)
d['age']=2025-d['leto'].fillna(2020)
d['tw']=np.exp(-np.log(2)/2*d['age'])*d['trznost_posla'].map(tw_map)
d['source']='prodaja'
print(f"   {len(d):,} prodajnih točk")

print("2. ETN najemi + implied vrednosti...")
rent=pd.read_sql('''
    SELECT d."E_CENTROID" as e,d."N_CENTROID" as n,d."POVRSINA_ODDANIH_PROSTOROV" as pov,
           p."POGODBENA_NAJEMNINA" as najemnina,p."TRZNOST_POSLA" as trznost,p."LETO" as leto
    FROM etn_np_delistavb d JOIN etn_np_posli p ON d."ID_POSLA"=p."ID_POSLA"
    WHERE d."E_CENTROID" IS NOT NULL AND d."VRSTA_ODDANIH_PROSTOROV"=\'2\'
      AND p."TRZNOST_POSLA" IN (\'1\',\'4\')
''',conn)
conn.close()
for c in ['e','n','pov','najemnina','leto']: rent[c]=pd.to_numeric(rent[c],errors='coerce')
rent=rent[rent['e'].between(374000,624000)&rent['pov'].between(12,300)&rent['najemnina'].between(80,4000)]
rent['rent_m2']=rent['najemnina']/rent['pov']
rent=rent[rent['rent_m2'].between(2,25)]
rent['rent_m2_market']=np.where(rent['trznost']=='4',rent['rent_m2']*2.20,rent['rent_m2'])
rent['age']=2025-rent['leto'].fillna(2020)
rent['tw']=np.exp(-np.log(2)/2*rent['age'])

# Yield surface
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
dists_y,idxs_y=yt.query(r_pts,k=1)
rent['implied_eur_m2']=(rent['rent_m2_market']*12)/yv[idxs_y]
rent_ok=rent[rent['implied_eur_m2'].between(500,10000)].copy()
rent_ok['eur_m2']=rent_ok['implied_eur_m2']; rent_ok['source']='najem_implied'
print(f"   {len(rent_ok):,} implied točk | yield median: {ydf[valid]['yield'].median():.1%}")

# Združi
all_pts=pd.concat([d[['e','n','eur_m2','tw','source']],rent_ok[['e','n','eur_m2','tw','source']]],ignore_index=True)
print(f"   Skupaj: {len(all_pts):,} točk")

# Pretvori v WGS84 za H3
print("\n3. H3 adaptive resolucija...")
lats,lons=[],[]
for e_v,n_v in zip(all_pts['e'],all_pts['n']):
    lat,lon=to_wgs84(e_v,n_v)
    lats.append(lat); lons.append(lon)
all_pts['lat']=lats; all_pts['lon']=lons

# Določi optimalno resolucijo za vsako točko
# Start: res 10 (66m) in coarsen kjer ni dovolj podatkov
def get_adaptive_res(lat, lon, min_sales=MIN_SALES_PER_HEX):
    for res in [10, 9, 8, 7]:
        h = h3.latlng_to_cell(lat, lon, res)
        # Koliko prodaj (source=prodaja) je v tem hexu?
        return res, h  # bomo filtrirali pozneje
    return 7, h3.latlng_to_cell(lat, lon, 7)

# Izračunaj H3 celice za vsako resolucijo
print("   Računam H3 celice...")
for res in [10,9,8,7]:
    all_pts[f'h3_{res}']=all_pts.apply(lambda r: h3.latlng_to_cell(r['lat'],r['lon'],res), axis=1)

# Adaptive: začni pri res 10, coarsen kjer n_sales < MIN_SALES_PER_HEX
print("   Adaptive coarsening...")
results=[]
processed_cells=set()

for res in [10,9,8,7]:
    col=f'h3_{res}'
    # Grupaj po H3 celici
    grp=all_pts.groupby(col)
    for cell_id, group in grp:
        if cell_id in processed_cells: continue
        n_sales=(group['source']=='prodaja').sum()
        if n_sales>=MIN_SALES_PER_HEX or res==7:
            # Ta celica ima dovolj podatkov ali je max coarse
            vals=np.log(group['eur_m2'].values)
            w=group['tw'].values
            srcw=np.where(group['source'].values=='prodaja',5.0,1.0)
            total_w=w*srcw; total_w/=total_w.sum()
            price=np.exp((vals*total_w).sum())
            boot=[np.exp(vals[np.random.choice(len(group),len(group),p=total_w)].mean()) for _ in range(50)]
            lat_c,lon_c=h3.cell_to_latlng(cell_id)
            e_c,n_c=to_slo(lat_c,lon_c)
            results.append({
                'h3_id':cell_id,'h3_res':res,
                'e':round(e_c),'n':round(n_c),
                'lat':lat_c,'lon':lon_c,
                'price_eur_m2':round(price),
                'ci_lo':round(np.percentile(boot,10)),
                'ci_hi':round(np.percentile(boot,90)),
                'confidence':round(min(1.0,n_sales/10+len(group)/50*0.3),2),
                'n_comps':len(group),
                'n_sales':int(n_sales),
                'n_implied':len(group)-int(n_sales),
            })
            # Označi vse fine celice kot processed
            if res<10:
                for fine_res in range(res+1,11):
                    for child in h3.cell_to_children(cell_id,fine_res):
                        processed_cells.add(child)
            processed_cells.add(cell_id)

hm=pd.DataFrame(results)
hm.to_parquet("/tmp/heatmap_h3.parquet")
print("✅ H3 parquet shranjen")
print(f"\n✅ H3 celic: {len(hm):,}")
print(f"   res 10 (66m):  {(hm['h3_res']==10).sum():,}")
print(f"   res 9  (174m): {(hm['h3_res']==9).sum():,}")
print(f"   res 8  (461m): {(hm['h3_res']==8).sum():,}")
print(f"   res 7 (1.2km): {(hm['h3_res']==7).sum():,}")

print(f"\nCene distribucija:")
print(hm['price_eur_m2'].describe(percentiles=[.1,.25,.5,.75,.9]))

# Spot check Ljubljana
lj=hm[(hm['e'].between(458000,466000))&(hm['n'].between(98000,105000))]
print(f"\nLjubljana ({len(lj)} celic):")
top10=lj.nlargest(10,'price_eur_m2')[['h3_res','e','n','price_eur_m2','n_sales']]
print(top10.to_string(index=False))

# Gallusovo
gal=lj.iloc[((lj['e']-461500)**2+(lj['n']-100900)**2).idxmin()]
print(f"\nGallusovo: res={gal['h3_res']} | {gal['price_eur_m2']:,} €/m² | sales={gal['n_sales']}")
print(f"→ 79.1m²: {gal["price_eur_m2"]*79.1:,.0f}€")

hm.to_parquet('/tmp/heatmap_h3.parquet')
print("\n✅ H3 heatmap shranjen")
