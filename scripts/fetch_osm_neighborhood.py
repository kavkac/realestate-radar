"""
Fetch OSM neighborhood data za Slovenijo + SURS popis 2021
Shrani v DB kot neighborhood_features tabelo
"""
import urllib.request, urllib.parse, json, time
import psycopg2, pandas as pd, numpy as np
from scipy.spatial import cKDTree
from psycopg2.extras import execute_values
from pyproj import Transformer
import warnings; warnings.filterwarnings('ignore')

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
tr = Transformer.from_crs("EPSG:4326","EPSG:3794",always_xy=True)

def overpass_query(q, retries=3):
    url = 'https://overpass-api.de/api/interpreter'
    for i in range(retries):
        try:
            data = urllib.parse.urlencode({'data': q}).encode()
            req = urllib.request.Request(url, data=data)
            r = urllib.request.urlopen(req, timeout=60).read()
            return json.loads(r)['elements']
        except Exception as e:
            print(f"  retry {i+1}: {e}"); time.sleep(5)
    return []

def fetch_points(amenity_filter, name):
    print(f"  Fetcham {name}...")
    q = f'[out:json][timeout:60];area["ISO3166-1"="SI"]->.a;(node{amenity_filter}(area.a);way{amenity_filter}(area.a););out center;'
    els = overpass_query(q)
    pts = []
    for el in els:
        lat = el.get('lat') or (el.get('center') or {}).get('lat')
        lon = el.get('lon') or (el.get('center') or {}).get('lon')
        if lat and lon:
            e,n = tr.transform(float(lon),float(lat))
            pts.append((e,n))
    print(f"    → {len(pts):,} točk")
    return np.array(pts) if pts else np.empty((0,2))

print("=== OSM NEIGHBORHOOD DATA ===\n")

# Fetcham kategorije
restaurants = fetch_points('[amenity~"restaurant|cafe|bar|pub|fast_food|food_court"]', 'restavracije/kavarne/bari')
time.sleep(3)
nightlife   = fetch_points('[amenity~"nightclub|casino|stripclub|adult_gaming_centre"]', 'nočni lokali')
time.sleep(3)
parks       = fetch_points('[leisure~"park|garden|playground"]', 'parki/vrtovi')
time.sleep(3)
nature      = fetch_points('[landuse~"forest|grass|meadow|village_green"]', 'narava/gozd')
time.sleep(3)
schools     = fetch_points('[amenity~"school|kindergarten|university|college"]', 'šole')
time.sleep(3)
healthcare  = fetch_points('[amenity~"hospital|clinic|pharmacy|doctors"]', 'zdravstvo')
time.sleep(3)
supermarket = fetch_points('[shop~"supermarket|convenience|grocery"]', 'trgovine')
time.sleep(3)

print("\nGradim density surfaces...")

# Density score: za vsako lokacijo = KDE score (število točk v radius / area)
def density_score(query_pts, feature_pts, radius=500):
    """Koliko feature točk je v radius metrih od query točke (normalizirano)"""
    if len(feature_pts) == 0:
        return np.zeros(len(query_pts))
    tree = cKDTree(feature_pts)
    counts = np.array([len(tree.query_ball_point(pt, r=radius)) for pt in query_pts])
    # Log normalizacija
    return np.log1p(counts)

# Naloži continuous_price_surface grid kot query točke
conn = psycopg2.connect(DB)
cps = pd.read_sql("SELECT e, n FROM continuous_price_surface", conn)
qpts = cps[['e','n']].values
print(f"Query točke: {len(qpts):,} (continuous_price_surface grid)")

print("Računam density scores (500m radius)...")
t0 = time.time()

scores = {
    'gastro_score':     density_score(qpts, restaurants, 500),
    'nightlife_score':  density_score(qpts, nightlife, 1000),
    'park_score':       density_score(qpts, parks, 500),
    'nature_score':     density_score(qpts, nature, 1000),
    'school_score':     density_score(qpts, schools, 1000),
    'healthcare_score': density_score(qpts, healthcare, 1000),
    'shop_score':       density_score(qpts, supermarket, 500),
}

print(f"  Done v {time.time()-t0:.0f}s")
for k,v in scores.items():
    print(f"  {k:<22}: max={v.max():.2f}, mean={v.mean():.2f}")

# Composite scores
vitality = scores['gastro_score'] + scores['nightlife_score']*0.5
greenery = scores['park_score'] + scores['nature_score']*0.7
amenity  = scores['school_score'] + scores['healthcare_score'] + scores['shop_score']

# Normaliziraj 0-1
def norm01(x): return (x-x.min())/(x.max()-x.min()+1e-9)
vitality_n = norm01(vitality)
greenery_n = norm01(greenery)
amenity_n  = norm01(amenity)

print(f"\n  Vitality (živahnost) max: {vitality_n.max():.2f}")
print(f"  Greenery (zelenost):      {greenery_n.max():.2f}")
print(f"  Amenity (storitve):       {amenity_n.max():.2f}")

# Shrani v DB — doda kolumne na continuous_price_surface
print("\nShranjujem v DB...")
cur = conn.cursor()

# Dodaj kolumne če ne obstajajo
for col in ['vitality_score','greenery_score','amenity_score','nightlife_score']:
    try:
        cur.execute(f"ALTER TABLE continuous_price_surface ADD COLUMN {col} FLOAT")
    except: conn.rollback()

rows = [(float(vitality_n[i]), float(greenery_n[i]), float(amenity_n[i]), float(norm01(scores['nightlife_score'])[i]),
         int(cps['e'].iloc[i]), int(cps['n'].iloc[i]))
        for i in range(len(cps))]

cur.executemany("""
    UPDATE continuous_price_surface
    SET vitality_score=%s, greenery_score=%s, amenity_score=%s, nightlife_score=%s
    WHERE e=%s AND n=%s
""", rows)
conn.commit()
print(f"✅ {len(rows):,} vrstic posodobljenih")

# Spot check — Gallusovo
cur.execute("""
    SELECT price_eur_m2, vitality_score, greenery_score, amenity_score, nightlife_score
    FROM continuous_price_surface
    ORDER BY (e-461500)^2+(n-100900)^2 LIMIT 1
""")
r = cur.fetchone()
print(f"\nGallusovo: {r[0]:,} €/m² | vitality={r[1]:.2f} | green={r[2]:.2f} | amenity={r[3]:.2f} | nightlife={r[4]:.2f}")
conn.close()

# Shrani raw OSM točke za vizualizacijo
import os; os.makedirs('/tmp/osm_cache',exist_ok=True)
np.save('/tmp/osm_cache/restaurants.npy', restaurants)
np.save('/tmp/osm_cache/parks.npy', parks)
np.save('/tmp/osm_cache/schools.npy', schools)
print("✅ OSM točke shranjene")
