import json, random, collections
random.seed(20260531)
W,H = 23,17
g = [[0]*W for _ in range(H)]
for x in range(W): g[0][x]=1; g[H-1][x]=1
for y in range(H): g[y][0]=1; g[y][W-1]=1
# Buildings: 4x4-ish wall rectangles on a lattice, leaving 2-wide streets between.
buildings=[]
for by in range(2, H-3, 6):
    for bx in range(2, W-3, 6):
        x2=min(bx+3, W-3); y2=min(by+3, H-3)
        for yy in range(by,y2+1):
            for xx in range(bx,x2+1): g[yy][xx]=1
        buildings.append((bx,by,x2,y2))
# Cover (crates/barricades) on street tiles beside buildings.
for (bx,by,x2,y2) in buildings:
    for (cx,cy) in [(bx-1,by-1),(x2+1,y2+1),(bx-1,y2+1),(x2+1,by-1),((bx+x2)//2,by-1),((bx+x2)//2,y2+1)]:
        if 1<=cx<W-1 and 1<=cy<H-1 and g[cy][cx]==0 and random.random()<0.55:
            g[cy][cx]=random.choice([2,2,3])
# Hazard lane (a burning street segment) across one mid street row.
hr=H//2
for x in range(1,W-1):
    if g[hr][x]==0 and random.random()<0.5: g[hr][x]=4
# floor connectivity (floor+hazard walkable)
def walk(x,y): return 0<=x<W and 0<=y<H and g[y][x] in (0,4)
def region(sx,sy):
    seen=set([(sx,sy)]); q=collections.deque([(sx,sy)])
    while q:
        x,y=q.popleft()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx,ny=x+dx,y+dy
            if walk(nx,ny) and (nx,ny) not in seen: seen.add((nx,ny)); q.append((nx,ny))
    return seen
# pick spawn floor tiles from the LARGEST connected region
floors=[(x,y) for y in range(H) for x in range(W) if g[y][x]==0]
best=max((region(x,y) for (x,y) in floors[:1]), key=len) if floors else set()
# ensure we use the region containing a bottom-left floor tile
start=next(((x,y) for (x,y) in floors if y>=H-3), floors[0])
reg=region(*start)
regfloor=[(x,y) for (x,y) in reg if g[y][x]==0]
regfloor.sort(key=lambda p:(p[1],p[0]))
# player units: bottom of region; enemies: top of region
pdefs=[("p_vanguard","Vanguard",120,30,15,4,2,0.8,"#00aaff","vanguard"),
       ("p_sentinel","Sentinel",80,45,8,3,9,0.78,"#ff8800","sentinel"),
       ("p_medic","Medic",70,20,10,3,4,0.72,"#00ff88","medic"),
       ("p_ranger","Ranger",95,38,10,5,3,0.8,"#22d3ee","vanguard"),
       ("p_gren","Grenadier",110,34,12,3,6,0.74,"#a3e635","vanguard")]
edefs=[("drone","Assault Drone",60,25,5,4,3,0.66,"aggressive","#ff3333"),
       ("sniper","Sniper Unit",50,40,3,2,10,0.7,"sniper","#cc0000"),
       ("defender","Defender Bot",95,22,12,2,2,0.62,"defensive","#ff7a3c"),
       ("stalker","Stalker Beast",70,32,6,6,2,0.7,"aggressive","#b86bff")]
players=[]; bottom=regfloor[-1:-40:-1]; used=set()
def take(pool):
    for p in pool:
        if p not in used: used.add(p); return p
    return None
for i,d in enumerate(pdefs):
    c=take(bottom)
    if not c: break
    players.append({"id":d[0],"name":d[1],"x":c[0],"y":c[1],"hp":d[2],"atk":d[3],"def":d[4],"movement":d[5],"range":d[6],"aim":d[7],"tint":d[8],"sprite":d[9]})
enemies=[]; top=regfloor[:60]
ei=0
for k in range(8):
    d=edefs[k%len(edefs)]
    c=take(top)
    if not c: break
    enemies.append({"id":"e_%s_%d"%(d[0],k),"name":d[1],"x":c[0],"y":c[1],"hp":d[2],"atk":d[3],"def":d[4],"movement":d[5],"range":d[6],"aim":d[7],"ai":d[8],"tint":d[9],"sprite":d[0]})
# verify all units reachable from each other
allpos=[(u["x"],u["y"]) for u in players+enemies]
ok = all(p in reg for p in allpos)
mission={"name":"Downtown Insertion","objective":"Eliminate all hostiles","grid":g,"player_units":players,"enemy_units":enemies}
print("size %dx%d players=%d enemies=%d connected=%s region=%d floors=%d"%(W,H,len(players),len(enemies),ok,len(reg),len(floors)))
# inject as FIRST mission in void-skirmish-3d
p="games/void-skirmish-3d/content.json"; c=json.load(open(p))
c["missions"]=[mission]+c.get("missions",[])
json.dump(c,open(p,"w"),indent=1)
print("injected; total missions now", len(c["missions"]))
