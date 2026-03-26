import numpy as np
from scipy.spatial import cKDTree
from psycopg2.extras import execute_values
import psycopg2, multiprocessing as mp, time

DB = 'postgresql://postgres:BXevJxzMDrFQUvjwDkZunQdpNHSJgdTz@switchback.proxy.rlwy.net:31940/railway'
N_WORKERS = 12

all_e = np.load('/tmp/rer_surface/all_e.npy')
all_n = np.load('/tmp/rer_surface/all_n.npy')
all_v = np.load('/tmp/rer_surface/all_v.npy')
all_w = np.load('/tmp/rer_surface/all_w.npy')
_tree = None

def init_worker():
    global _tree
    _tree = cKDTree(np.column_stack([all_e, all_n]))

def compute_batch(pts):
    results = []
    for e, n in pts:
        for r in [50,100,250,500,1000,2000,5000,10000,25000]:
            idx = _tree.query_ball_point([e,n], r=r)
            if len(idx) >= 8: break
        if len(idx) < 8: continue
        cv=all_v[idx]; ce=all_e[idx]; cn=all_n[idx]; cw=all_w[idx]
        d=np.sqrt((ce-e)**2+(cn-n)**2)
        sw=np.exp(-d**2/(2*(r/2)**2)); tw=sw*cw; tw/=tw.sum()
        price=np.exp((cv*tw).sum())
        boot=np.array([np.exp(cv[np.random.choice(len(idx),len(idx),p=tw)].mean()) for _ in range(50)])
        results.append((e,n,round(price),round(np.percentile(boot,10)),round(np.percentile(boot,90)),int(r),len(idx)))
    return results

if __name__ == '__main__':
    ZONES=[
        (455000,467000,97000,107000,50,"Ljubljana"),
        (535000,547000,117000,127000,50,"Maribor"),
        (393000,405000,40000,51000,50,"Koper"),
        (433000,442000,127000,135000,50,"Kranj"),
        (516000,527000,114000,123000,50,"Celje"),
        (508000,519000,71000,80000,50,"NM"),
        (385000,396000,92000,100000,50,"N.Gorica"),
        (374000,624000,33000,194000,500,"Ruralno"),
    ]
    seen=set(); grid=[]
    for e0,e1,n0,n1,step,name in ZONES:
        cnt=0
        for e in range(e0,e1,step):
            for n in range(n0,n1,step):
                if (e,n) not in seen:
                    seen.add((e,n)); grid.append((e,n)); cnt+=1
        print(f"  {name}: {cnt:,} tock ({step}m)", flush=True)
    print(f"Skupaj: {len(grid):,} | {N_WORKERS} workers\n", flush=True)

    BATCH=2000
    batches=[grid[i:i+BATCH] for i in range(0,len(grid),BATCH)]
    t0=time.time(); all_results=[]
    with mp.Pool(N_WORKERS, initializer=init_worker) as pool:
        for i,res in enumerate(pool.imap_unordered(compute_batch, batches)):
            all_results.extend(res)
            if i%20==0:
                done=min((i+1)*BATCH,len(grid))
                rate=done/(time.time()-t0)
                eta=(len(grid)-done)/rate if rate>0 else 0
                print(f"  {done:,}/{len(grid):,} | {len(all_results):,} valid | {rate:.0f} pt/s | ETA {eta:.0f}s", flush=True)

    print(f"\nVeljavnih: {len(all_results):,} — uploading...", flush=True)
    conn=psycopg2.connect(DB)
    cur=conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS continuous_price_surface (
        e INT,n INT,price_eur_m2 INT,ci_lo INT,ci_hi INT,
        bandwidth_m INT,n_comps INT,
        computed_at DATE DEFAULT CURRENT_DATE,PRIMARY KEY(e,n))""")
    cur.execute("TRUNCATE continuous_price_surface")
    execute_values(cur,"INSERT INTO continuous_price_surface (e,n,price_eur_m2,ci_lo,ci_hi,bandwidth_m,n_comps) VALUES %s",all_results,page_size=5000)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cps_en ON continuous_price_surface(e,n)")
    conn.commit()
    print(f"OK {len(all_results):,} celic | {(time.time()-t0)/60:.1f} min", flush=True)
    for name,e,n in [("Gallusovo",461500,100900),("Koper",398500,44600),("Maribor",540400,121400)]:
        cur.execute("SELECT price_eur_m2,bandwidth_m,n_comps FROM continuous_price_surface ORDER BY (e-%s)^2+(n-%s)^2 LIMIT 1",(e,n))
        r=cur.fetchone()
        print(f"  {name}: {r[0]:,} EUR/m2 bw={r[1]}m n={r[2]}")
    conn.close()
