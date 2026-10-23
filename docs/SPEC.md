# Topocide SPEC

This document specifies the data model, algorithm definitions, module layering,
and visual state machine of the Topocide POC.
**The code is authoritative** — this document describes the actual behavior of
`engine.js` / `index.html`.

## Numbering convention (read this first)

- **Algorithms**: always anchored by **§ number** (§4–§10, §15); the block comments in `engine.js` likewise lead with `§N —`, for two-way traceability.
- **UI tabs**: `C1–C10`, purely the naming of the 10 tabs in `index.html`, **used for the screen only**.

In other words `Cx` always means a UI tab; algorithms no longer use C (an older
version once prefixed `engine.js` with `Cx`, but because it shared letters with
the UI tabs and was confusing, it has been removed). The two are **not** one-to-one:
e.g. "Failure simulation" is UI tab C5 but its core algorithm is in §6.
The mapping of UI tabs to their backing § / functions is consolidated in §12.

---

## §1 Data Model

> **Note**: this section defines the **data schema (model)**, not any specific
> dataset. The built-in topology / traffic / RTT are replaceable synthetic
> samples produced by the generator; only the field structure is the stable contract.

### §1.1 Topology Schema

`topology.js` exposes a single global variable `topology`, structured as:

```js
const topology = {
  nodes: [...],       // Router + Pseudo-node
  edges: [...],       // p2p / transit edges
  externals: [...],   // LSA5 (optional)
  positions: { ... }, // Cytoscape default coordinates (optional)
};
```

> **Note (edit.html internal state)**: `topology.js` and `engine.js` use only the top-level `externals` array. Inside edit.html, externals are held per-node as `node.externals = [{subnet, metric, metric_type}]` (`advertising_router` is implied by the owning node); export flattens them back to the top-level array and restores `advertising_router` from the node id.

### §1.2 Node

```ts
type Node =
  | {
      id: string;            // unique id; PoP short code (TPE / TYO …) or, for OSPF imports, a safe token (city code + index / R_<rid> / PN_*)
      label: string;         // graph display text, supports \n line breaks
      type: 'router';
      rid?: string;          // OSPF Router-ID (set by the OSPF importer; hostname, if present, feeds `label`)
      country?: string;      // ISO country code (for UI grouping / coloring)
      city?: string;         // city code (anchor for RTT city-pair lookup)
      area: string;          // OSPF area (currently only '0' supported)
      stubs?: string[];      // LSA3 equivalent: prefixes (CIDR) advertised by this router
      isASBR?: boolean;      // whether it is an ASBR (injects LSA5 externally)
      isABR?: boolean;       // whether it is an ABR (inter-area computation not yet enabled)
    }
  | {
      id: string;            // must start with 'PN' (LSA2 abstraction); engine.js detects pseudo-nodes by this id prefix
      label: string;
      type: 'pseudonode';
      subnet: string;        // the CIDR of this transit LAN
    };
```

> **Id constraint**: router ids must **not** start with `PN` — `buildAdjacency` and
> `stripPseudo` decide "pseudo-node" by the `PN` id prefix, not by `type`
> (`engine.js` §3 / §4.3). Known issue: the OSPF importer maps hostname prefix `CB`
> to city code `PNH`, producing router ids `PNH1`, `PNH2`, … that are misread as
> pseudo-nodes.

### §1.3 Edge

```ts
type Edge =
  | {
      id: string;
      source: string;
      target: string;
      cost: number;          // forward cost (source → target)
      costRev?: number;      // reverse cost (p2p only; if omitted equals cost, i.e. symmetric)
      capacity?: number;     // link capacity (Gbps), for utilization (C4, C5, C9 overflow, C10 optimizer, §4.6)
      type: 'p2p';
      net?: string;          // OSPF import only: source transit network (e.g. a /30)
    }
  | {
      id: string;
      source: string;        // one end is a Router, the other a Pseudo-node
      target: string;
      cost: number;          // Router → Pseudo cost
      capacity?: number;
      type: 'transit';       // Pseudo → Router fixed at 0 (LSA2 semantics)
    };
```

### §1.4 External (LSA5)

```ts
type External = {
  advertising_router: string;   // which ASBR injects it
  subnet: string;               // e.g. '0.0.0.0/0'
  metric: number;
  metric_type: 'E1' | 'E2';
};
```

### §1.5 Companion data files (optional)

| File | Global / export | Which UI tab | Behavior when missing |
|------|-----------------|--------------|-----------------------|
| `demand.js` | global `const demand` (+ `module.exports = { demand }` when `module` exists) | profile dropdown, C3 demand-weighted ranking, C4 edge traffic, C5 before/after traffic, C9 capacity overflow, C10 optimizer | **Currently fatal**: index.html reads `demand.profiles` unguarded at module top level, so a missing file stops the page. Per-tab fallbacks exist (C4 message, C3 weighted toggle disabled, C10 optimizer message) but are unreachable until that guard is added |
| `rtt.js` | global `const rtt` (+ `module.exports = { rtt }` when `module` exists) | C2 RTT/SLO matrix mode (§4.5), C10 cost reference (also reads `fiberRttPerKm`) | C2 falls back to cost-only; C10 reference column stays visible, p2p rows show "no reference" with an amber warning bar |
| `srlg.js` | global `srlg` (no exports) | C5 failure-sim SRLG dropdown | C5 dropdown offers only single-router failures |
| `draft.js` | `window.Draft` | index.html + edit.html localStorage persistence | — |

`draft.js` is a shared localStorage persistence module. It exposes
`window.Draft = { KEY, MAX_AGE, read(), write(data), clear() }` with a **single**
key `blastradius-draft` and a 2-hour expiry (`_savedAt` stamp). Both pages pass a
topo key (`Draft.read(topoKey)`, `Draft.write(data, topoKey)`), but `draft.js`
ignores it — see §2.1 Known issues.

`demand.js` provides **5 scenario profiles** — `avg` / `max` / `asia_busy` / `amer_busy` / `eu_busy` — switched via `demand.active`; `engine.js` only reads `demand.matrix` / `demand.default` (profile switching is transparent to the algorithms). Values are Gbps numbers: gen.mjs emits 1 decimal place and companions.mjs 3 (the committed `demand.js` comes from an earlier generator and holds integers). `rtt.js` = `{ unit, note, fiberRttPerKm, timestamp, matrix, edges }`, where `matrix` is city×city RTT and `edges[]` is `{ a, b, rtt, src }` (PoP node-pair RTT, `src` ∈ `measured` / `city-ref` / `model`). gen.mjs and the edit.html export no longer emit `cityRef` (a mirror of `city_rtt.csv`); the committed `rtt.js` predates this and still contains a legacy `cityRef` that nothing reads.

**OSPF-imported datasets**: `topology.imported.js` (+ companions
`demand/srlg/rtt.imported.js`) are produced by the import pipeline from real
`show ip ospf database router/network` output and are written to `../output/`
next to the demo `*.js` (they do not overwrite). They are not committed to this
repo, and the pipeline's `../output/` path does not exist in this checkout. The LSDB parser is the shared pure module
`ospf-import.js` (imported by both the data editor and
`pipeline/ospf_to_topology.mjs`); imported router nodes carry `rid` (§1.2) and a
safe-token `id`. `OSPF_CITY` values in `ospf-import.js` are plain city code strings;
country is derived from `CITY_GEO` in `gravity.js` (the SSOT for city geography).
See CLAUDE.md for the toolchain and fixed generation order.

---

## §2 Module Layering

```
┌────────────────────────────────────────────────────────┐
│ Module A: Topology Data    (topology.js / demand.js …)  │
├────────────────────────────────────────────────────────┤
│ Module B: Graph Builder    (§3)                         │
│   - buildAdjacency(edges, failedEdges, failedNodes)     │
│   - buildPrefixIndex(topo)                              │
├────────────────────────────────────────────────────────┤
│ Module C: Algorithm Engine (§4–§10)                     │
│   §4   SPT + ECMP                                       │
│   §5   Backup Path                                      │
│   §6   Failure Sim + Load                               │
│   §7   ECMP Check                                       │
│   §8   Asymmetric                                       │
│   §9   Prefix Heatmap                                   │
│   §10  N-1 Worst-case                                   │
│   §15  Weight Optimization                              │
├────────────────────────────────────────────────────────┤
│ Module D: State Machine    (§11)                        │
│   edgeStates / nodeStates  (op + role)                  │
│   failedEdges / failedNodes facade                      │
├────────────────────────────────────────────────────────┤
│ Module E: UI Layer         (Cytoscape + 10 Tab handlers)│
└────────────────────────────────────────────────────────┘
```

The call direction is "downward dependency" only — UI calls Engine and also calls
the Builder directly (`buildAdjacency`, `buildPrefixIndex`; both are pure exports of
`engine.js`), Engine calls Builder, Builder reads Topology. The State Machine is the bridge
between UI and Engine: UI manipulates persistent state via `setEdgeOp / setNodeOp`,
and the Engine reads it through the `failedEdges / failedNodes` facade.

### §2.1 Persistence & sync (edit.html ↔ index.html)

```
user action (Inspector / cy interaction)
            ↓
    cy (canvas, Cytoscape.js)
            ↕  _skipCySync prevents feedback loops
nodes / edges / positions Maps (topology SSOT; node.externals folded in)
            ↕
D / S / R (demand / srlg / rtt objects, edited by each tab)
            ↓
markDirty (1.5 s debounce)
    → Draft.write → localStorage (draft.js, 2 h expiry)
    + edit.html posts 'topo-update' on BroadcastChannel 'topocide'
      (nodes / edges / positions only) → index.html merges it into its draft and reloads
    + CF Workers + R2 (edit.html only): manual push via the sync button;
      automatic pull on load when there is no local draft
```

**Write paths** (edit.html): Inspector fields and stub chips write the Maps first,
then sync cy with `_skipCySync`; cy drag events write back to the Maps (ghost
elements filtered by `isGhost()`); D/S/R tabs mutate their objects and call
`markDirty()` at the end of render; `renameEle` updates cy + D/S/R together.
`hydrateAll` (draft / remote restore) sets `_hydrating` only around its final
`select(null); refresh()`, so that refresh does not re-mark dirty; loading the
bundled `.js` files does call `markDirty()` (and so writes a draft).

**Load priority**
- edit.html: local draft > remote (R2) > bundled `.js`
- index.html: broadcast > local draft > bundled `.js` (the remote loader is a
  commented-out stub, not implemented)
- `?topo=<key>` is carried between the two pages; the R2 key falls back to a
  per-browser client id when absent.

**Decided against**: an EventBus / Proxy layer that fans out every Map write.
`_skipCySync` already breaks the Inspector → Maps → cy loop, manual `markDirty()`
covers D/S/R deep mutation, and pub/sub complexity (missed topics, source flags,
debounce layers) outweighs the gain at this scale.

**Known issues**
- `draft.js` `read()` / `write()` ignore the topo key callers pass in, so every
  `?topo=` shares one localStorage draft (`blastradius-draft`).
- index.html takes only nodes / edges / positions from a draft or broadcast;
  demand / srlg / rtt always come from the bundled files (no cloud loader either).
- External (LSA5) edits made in edit.html do not reach index.html: the draft
  carries `node.externals`, but index.html and `buildPrefixIndex` read only the
  top-level `topology.externals`.
- D/S/R deep mutation is not auto-detected (mitigated by `markDirty()` at render end).
- With `RTT_OK=false` the optimizer has no RTT floor; p2p fields show an amber warning.

---

## §3 Graph Builder

### §3.1 Adjacency (`buildAdjacency`)

Converts `topology.edges` into the adjacency list `adj[u] = [[v, cost, edgeId], ...]`
used by Dijkstra (`edgeId` keeps parallel links distinct). Three rules:

**Rule 1 — p2p edge**

```
add(source, target, cost)
add(target, source, costRev ?? cost)
```

**Rule 2 — transit edge (LSA2 semantics)**

```
add(router, pseudo, cost)   // Router → Pseudo: has cost
add(pseudo, router, 0)      // Pseudo → Router: fixed 0
```

The pseudo end is the endpoint whose id starts with `PN` (either orientation is
accepted).

**Rule 3 — failure filtering**

- `failedEdges.has(e.id)` → skip the whole edge
- `failedNodes.has(u) || failedNodes.has(v)` → skip that direction

### §3.2 Prefix Index (`buildPrefixIndex`)

`prefix → Set<advertising_router_id>`; a set of size ≥2 is considered
backed-up. Sources:

| Rule | Source | Behavior |
|------|--------|----------|
| Rule 3 | `node.stubs` | that router is an advertiser |
| Rule 5 | LSA2 transit | all attached routers "own" that pseudo-node's subnet |
| Rule 4 | `externals` | the `advertising_router` in an LSA5 is an advertiser |

---

## §4 SPT + ECMP

### §4.1 Algorithm

Dijkstra + equal-cost relaxation expansion. `dijkstraSource(adj, src)` returns
`{ dist, preds }`; `preds[v]` is an **array of `{ u, id }`** (predecessor node +
edge id), allowing multiple predecessors:

```
for each neighbor (v, c, id) of u:
  nd = dist[u] + c
  if nd < dist[v]:
    dist[v] = nd
    preds[v] = [{ u, id }]
  elif nd == dist[v]:
    preds[v].push({ u, id })   // no dedup: parallel equal-cost links stay separate
```

Equal-distance nodes pop from the heap in insertion order (`[dist, seq]` tie-break).

### §4.2 ECMP path enumeration

`enumeratePaths(dist, preds, src, dst)` expands `preds` recursively from `dst`
and returns `{ cost, paths, edgePaths }`, one entry per **edge-distinct** path
(parallel links give the same node sequence with different `edgePaths`). An
unreachable `dst` returns `{ cost: Infinity, paths: [], edgePaths: [] }`.
`dijkstraECMP(adj, src, dst)` = `dijkstraSource` + `enumeratePaths`.

### §4.3 Pseudo-node post-processing

`stripPseudo(path)` filters out nodes whose id starts with `PN`, presenting a
"router-level" view.

### §4.4 IP / Network resolution

`resolveLPM(prefixIndex, target)`: currently implemented as "exact match +
default-route (`0.0.0.0/0`) fallback". Full LPM is on the Roadmap.

### §4.5 Matrix modes: RTT / SLO + Path Diversity (C2 presentation)

C2 has four view modes (**default RTT / SLO**): Cost, RTT / SLO, Path Diversity,
and Bandwidth-survival (§4.6). Rows are the routers reachable from the first
router under the current failures, ordered by `dijkstraDist` from it; each cell is
a per-pair `dijkstraECMP(adj, a, b)`.

**Cost** shows the §4 shortest-path cost.

**RTT / SLO** sums each edge's RTT along the shortest path and shades each cell
against an SLO target (default ≤150 ms). Per-edge RTT: `rtt.edges` keyed by node
pair (either orientation), else `rtt.matrix[cityA][cityB]` then
`rtt.matrix[cityB][cityA]`; an edge with **no RTT data counts as 0 ms** (known
issue — transit edges have no RTT, so paths through pseudo-nodes are
under-counted). ECMP → min over paths. Coverage = pairs within target ÷ all
displayed off-diagonal pairs, where unreachable (∞) cells and cells without an RTT
value count as over target. This is a presentation layer in `index.html` (no
engine § block) — the path itself is still §4's cost-based SPT. Needs `rtt.js`;
without it the mode falls back to cost.

**Path Diversity** — `pairwiseEdgeConnectivity(edges, routerIds)` (engine block
`§4.5 — PATH DIVERSITY`): the number of edge-disjoint paths per pair, computed by
Edmonds-Karp max-flow with capacity 1 per edge per direction (parallel edges count
separately). The UI passes the live edges including transit (pseudo-nodes act as
relays) with right-click failures removed. Cell tiers: k = 0 red, 1 orange,
2 yellow, ≥ 3 green.

### §4.6 Matrix bandwidth-survival mode (C2 presentation)

`n1BandwidthSurvivability(edges, routerIds)` answers, per node pair: *after the
single worst single-link failure along the OSPF path, what percentage of the
primary path's bandwidth still survives?* Cell colour tiers: **0** red
(disconnected after N-1), **1–49** orange (severely degraded), **50–99** yellow
(partial protection), **≥100** green (fully backed — or better). The rate **can
exceed 100 %** (see below).

It is **OSPF cost-based**: bandwidth is measured along the paths traffic
actually takes (§4 cost-based SPT / ECMP), not along an idealised
capacity-maximising path. Built on `buildAdjacency` + `dijkstraSource` (§3.1,
§4.1); **every** edge with `capacity > 0` contributes bandwidth, p2p or transit
(edges without capacity are ignored when taking the minimum). Computed on the
intact topology: right-click failures are not applied; only row / column
membership and ∞ cells reflect live failures.

**Model:**

1. **Primary** — the OSPF shortest-path **DAG** for the pair (all equal-cost
   ECMP paths). `spDagEdges` walks `preds` to collect every edge on that DAG
   (the ECMP edge union, without enumerating paths). Denominator =
   `minCapOf(primary edges)`, the narrowest capacity on the DAG.
2. **N-1** — fail **each edge on the primary DAG** in turn, transit edges
   included (`buildAdjacency(edges, {eid})`), recompute the OSPF DAG, and take the
   narrowest capacity over its edge union. Unreachable after failure → 0; a
   surviving DAG with no capacity data → 0. `worstCase = min` across all these
   scenarios.
3. `rate = ceil(worstCase / denominator × 100)` — **not capped**.
4. If the primary is unreachable or its DAG has no capacity data, the result is
   `{ primary: 0, worstCase: 0, rate: 0 }` and the UI shows "—".
5. Only `routerIds[i] → routerIds[j]` with `i < j` is computed and mirrored; with
   asymmetric costs both cells reflect that direction (the UI passes routers in
   distance order from the first router), not the src of the clicked cell. Each
   pair reruns `dijkstraSource`.

**Why it can exceed 100 %.** When the OSPF primary is a thin low-cost path and a
single failure reroutes traffic onto a higher-cost but fatter detour, the
surviving bandwidth is larger than the primary's — e.g. primary 30 G, post-
failure 100 G → 334 %. A widest-path proxy could never show this (its backup is
always ≤ primary); the OSPF view reflects the real "thin primary, fat backup"
case.

**Scope:** single-link failures over the primary-DAG edges only — no N-2
combinations, and edges off the OSPF path are never failed (failing them cannot
reduce the surviving bandwidth below the intact primary). ECMP paths are
**unioned**, so the value is the narrowest edge anywhere in the surviving
forwarding. Presentation layer in `index.html`; requires edge `capacity`.

---

## §5 Backup Path

### §5.1 Cut-edge recompute

`backupPath(topo, src, dst, removedEdges)` builds adjacency from the intact
topology minus `removedEdges` only (`failedEdges = new Set(removedEdges)`; live
failures and failed nodes are not included), then runs `dijkstraECMP`.

> Numbering: there is no §5.2 / §5.3; §5.4 keeps its number so existing
> references (engine.js `§5.4`, §10.4) stay valid.

### §5.4 Unprotected Segment Scan

`unbackupSegmentScan(topo, src, dst)` — for each edge in the union of **all**
primary ECMP `edgePaths` (transit edges included), try removing it; if the
post-removal cost = ∞, mark the edge as unbacked. It always uses the intact
topology (even though C1's displayed primary respects live failures):

```
primary  = dijkstraECMP(buildAdjacency(topo.edges), src, dst)
for each edge e in union(primary.edgePaths):
  if backupPath(topo, src, dst, [e]).cost == ∞:
    unbacked.push(e)
return { primaryEdges, unbacked }   // unreachable primary → both empty
```

Semantics: **the moment this edge breaks, src → dst is severed with no backup path available.**

---

## §6 Failure Simulation + Load

### §6.1 Connectivity

`connectedComponents(adj, routerIds)`: iterative DFS (stack) over **all** nodes —
pseudo-nodes are traversed, which is what connects routers sharing a LAN — and
the resulting components list routers only.

### §6.2 Traffic redistribution (equal-weight edge load)

`allPairsLoad(topo, failedEdges, failedNodes)`:

```
load[edge] = Σ over all (a→b) pairs: 1 / r.paths.length
```

ECMP equal-weight; each path adds to every edge it traverses. This is exactly
**edge betweenness centrality (Edge BC)**.

There is no engine function for the before/after diff: tab **C5** computes it
inline. It loads the whole network twice (`before` = no failure, `after` = the
selected element / SRLG failed) with `allPairsTraffic` (§6.2b) when demand.js is
loaded, otherwise `allPairsLoad`. Per edge: failed edges become rows of class
`down` with `changePct = -100` (0 if `before = 0`); otherwise
`direction ∈ {inc, dec, none}`, `changePct = (after − before) / before × 100`
(`Infinity` when `before = 0` and `after > 0`); `none` edges are dropped; `inc` rows
are class `up`, `dec` rows class `dec`. Sort: down → up by |Δ%| → dec.

### §6.2b Traffic-weighted edge load (`allPairsTraffic`)

`allPairsTraffic(topo, demand, failedEdges, failedNodes)` — the same
single-source enumeration scheme as §6.2 (`dijkstraSource` + `enumeratePaths`,
its own all-pairs pass), but each path's accumulation weight changes from "1"
to "`demand[a][b]`" (consuming the `demand.js` traffic matrix). Returns
`{ traffic, trafficFwd, trafficRev, totalPairs, reachablePairs, lostPairs,
totalDemand, servedDemand, lostDemand, lostDemandPairs }`.

**Full-duplex / unidirectional capacity**: circuits are full-duplex by default
and `capacity` is a **unidirectional** value. So accumulation is split by actual
direction of travel into **forward (`trafficFwd`) / reverse (`trafficRev`)**
(direction judged from the path's node sequence: `np[i]===e.source` means
"forward"), and the returned `traffic[edge] = max(fwd, rev)` takes the **busier
direction**. Combined with `edge.capacity` this yields
**utilization = max(fwd, rev) / capacity** (i.e. "is the busier direction
overloaded"), avoiding the ~2× overestimate from summing both directions and
dividing by a unidirectional capacity.

- transit likewise: `fwd` = ingress (`router→PN`, controllable via interface cost), `rev` = egress (`PN→router`, fixed 0 for Type-2) — this holds because the data stores transit edges with `source = router` (as in the bundled data); `buildAdjacency` accepts either orientation.
- when `demand.js` is missing, the caller must guard against this (the C4 tab shows a "not loaded" notice).
- C4 edge traffic, C5 failure sim, §15 `evalCongestion` (MLU), and C9 N-1 overflow **all read the same `traffic[edge]`** (peak), so the direction fix takes effect in one place and downstream needs zero changes. `allPairsLoad` (§6.2, edge betweenness) is a capacity-free centrality, direction-agnostic, and unaffected.

### §6.3 Node Betweenness Centrality

`computeNodeBC(topo, failedEdges, failedNodes)`: classic Freeman BC, meaning
"how much transit SPT traffic each router carries on average".

```
BC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
          σ(s, t | v) / σ(s, t)
```

Implementation details:

- ECMP equal-weight over **node-distinct** paths: `w = 1 / (node-distinct path count)`. Parallel equal-cost links (two cables, identical node sequence) collapse to one path and do **not** inflate the node's centrality — link-level parallelism is a capacity matter (handled per-edge by §6.2b), not node betweenness.
- `stripPseudo(path)` filters pseudo-nodes first, keeping only the router-level view
- exclude endpoints: loop `for i in [1, stripped.length - 1)`, head and tail don't count as "transit"
- uses the same single-source enumeration scheme as §6.2 `allPairsLoad` (Edge BC; separate pass), but accumulates onto the intermediate node instead of the edge
- **shared core**: §6.3 and §6.3b both run through one `computeNodeLoad(topo, demand, …)` (`demand=null` → unit/structural; `demand` given → Gbps), via the `nodeDistinctPaths` / `accNodeBetweenness` helpers with single-source reuse. The two exported names are thin wrappers.

> **UI mapping**: tab **C3 Centrality** presents both §6.2's **Edge BC** (per link)
> and this section's **Node BC** (per router); each does a 4-tier classification
> (`hub > 0.4·max / normal > 0.1·max / rare > 0 / idle = 0`; thresholds in
> `THRESHOLDS` in index.html), mapping to recommendations (i18n `c3.*.act.*`):
> - links: hub "Expand & dual-home" / normal "Maintain" / rare "Bandwidth-downsize candidate" / idle "Removal candidate"
> - routers: hub "Dual-box dual-path" / normal "Maintain" / rare "Can downsize" / idle "No transit traffic"

### §6.3b Demand-weighted Node Betweenness

`computeNodeTraffic(topo, demand, failedEdges, failedNodes)`: the same node
accumulation as §6.3 (strip pseudo + exclude endpoints), but each `(a, b)`
pair's weight changes from "1" to `demand[a][b]` (consuming the same gravity-model
traffic matrix as §6.2b). Its meaning is "how many **Gbps** of transit traffic
each router forwards on average" — i.e. demand-weighted node betweenness.

```
WBC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
           demand[s][t] · σ(s, t | v) / σ(s, t)
```

Implementation details:

- ECMP equal-weight over **node-distinct** paths: `w = demand[a][b] / (node-distinct path count)` (consistent with §6.3; parallel links collapse, **not** edgePaths)
- single-source reuse (`dijkstraSource` once per source, then `enumeratePaths` per dst) — same as the rest of the all-pairs family
- aligned with §6.2b `allPairsTraffic`: iterate all routers (do not exclude failed nodes); demand into / out of failed nodes counts as `lostDemand`
- returns Gbps accounting (`totalDemand / servedDemand / lostDemand / lostDemandPairs`), reused by the C3 reachability banner
- when `demand.js` is missing, returns an empty result; the UI toggle auto-disables and falls back to §6.3 unit mode

> **UI mapping**: the C3 node-centrality ranking adds a "transit count ⇄ traffic-weighted"
> toggle; `demand` mode uses this section, with classification thresholds and
> 4-tier copy inherited from §6.3. **§6.3 = structural fragility (who is the
> topological hub)**; **§6.3b = traffic heat (who actually carries the most
> Gbps)** — where the two disagree is exactly the procurement signal for
> "structurally unimportant but crushed by traffic", or the reverse.

---

## §7 ECMP Backup Check

`ecmpBackupCheck` / `ecmpBackupScanAll` — for each (src, dst):

1. compute primary; if fewer than 2 edge-distinct paths (`edgePaths.length < 2`) → `reason: 'no-ecmp'` (`status: n/a`)
2. collect `ecmpEdgeIds` = the set of each path's first **edge id**; if fewer than 2 distinct → `reason: 'single-first-hop'` (`status: n/a`). Two parallel links to the same neighbour count as 2 first hops.
3. for each `eid ∈ ecmpEdgeIds`, remove it and recompute; **return on the first failing member** (the rest are not evaluated):
   - if unreachable → `status: 'failed', reason: 'remove-unreachable', eid`
   - if the new path's first-hop is not in `ecmpEdgeIds \ {eid}` → `status: 'failed', reason: 'backup-non-ecmp', eid, bid`
4. all pass → `status: 'passed'`

`ecmpBackupScanAll(topo)` runs this on the intact topology for all ordered pairs
and returns `[{ src, dst, status, reason?, eid?, bid? }]`.

> **reason contract**: `reason` is always a **stable code** (kebab) plus structured
> params (`eid` / `bid`); the engine emits **no prose strings**. Display text is the
> UI's job, via the i18n keys `c6.reason.<code>` (`t('c6.reason.' + r.reason, r)`).

**Semantics**: in an ideal ECMP group, after any member fails, traffic should be
taken over by the other members of the group and should not escape the group.

---

## §8 Asymmetric Path Detection

`detectAsymmetric` — for each unordered pair (a, b):

```
fwd = SPT(a → b)
rev = SPT(b → a)
fwdSig = set of stripPseudo(p).join('>')
revSig = set of stripPseudo(p).reverse().join('>')
```

If `fwd.cost ≠ rev.cost` or `fwdSig ≠ revSig` (set comparison) → add to the
asymmetric list. Pairs unreachable in either direction are skipped silently.
Returns `[{ a, b, fwdCost, revCost, fwdPaths, revPaths }]` (`revPaths` already
reversed).

---

## §9 Prefix Advertisement-Redundancy Heatmap

`computeHeatmap(topo, prefixIndex)` — per router, count `single-advertised /
total` and return `{ notbackuped, total, ratio, prefixes }`; Ratio maps to color
(thresholds hard-coded in C8, not in `THRESHOLDS`):

| Ratio | Color | Meaning |
|-------|-------|---------|
| 0 | Green | all prefixes have redundant advertisement |
| (0, 0.33] | Yellow | a few prefixes are singly advertised |
| (0.33, 0.66] | Orange | about half the prefixes have no redundant advertisement |
| > 0.66 | Red | most prefixes are singly advertised |

A router with no prefixes gets ratio 0 and shows green.

---

## §10 N-1 Worst-case Ranking

### §10.1 Enumeration

`computeN1WorstCase(topo)`:

```
scenarios =
  { kind:'edge', id, edge } for each p2p edge ∪
  { kind:'node', id }       for each router
```

Transit edges are not counted as physical failure scenarios (they are an LSA2
internal abstraction). **SRLG groups are not part of the §10 scan**: SRLG group
failure is available only in C5 (§6), where the UI's `expandSRLG` expands a group
into edges / nodes. Pairs whose baseline is ∞, or that have a failed endpoint, are
skipped.

### §10.2 Dual-perspective accumulation

For each scenario, recompute SPT over the whole network for all (a, b) pairs,
accumulating two kinds of stats simultaneously:

**Per-pair**

```
pairWorst[a>b] = {
  base:      baseline cost (no failure),
  worstCost: the worst cost across all scenarios,
  culprits:  the scenario list that produced the worst result,
}
```

`culprits` collects **all** scenarios that reach the worst cost — including every
single-point failure that makes the pair unreachable (∞), not just the first one.

**Per-failure**

```
failStats[scenario] = {
  unreachable: how many pairs this failure makes unreachable,
  degraded:    how many pairs still connect but get slower,
  totalDelta:  Σ (this scenario's cost − baseCost) over pairs that got slower,
  maxRatio:    max (cost / baseCost) over degraded pairs (starts at 1; unreachable
               pairs never set it, so it is never ∞),
  affected:    the affected pairs,
}
```

Returns `{ pairRows, failureRows, baseCost }`. `pairRows` keeps only pairs whose
`worstCost ≠ base`; `failureRows` keeps only scenarios with `unreachable > 0` or
`degraded > 0`. (Known issue: the C9 UI has a `maxRatio === Infinity` branch that
can never fire.)

### §10.3 Sorting

- **Pair**: `ratio = worstCost / baseCost` descending, unreachable (∞) first
- **Failure**: unreachable count descending → `totalDelta` descending

### §10.4 Relationship to §5.4 (Unbackup)

| Dimension | §5.4 Unbackup | §10 N-1 |
|-----------|---------------|---------|
| Focus | a single (src, dst) pair | all pairs network-wide |
| Failure scope | only edges on the primary path | all p2p edges + all routers (no SRLG) |
| Decision | binary (reachable / not) | continuous (ratio + unreachable count) |
| Use | "is this path safe?" | "where is the network most fragile?" |

§5.4 is a binary subset of §10.

---

## §11 Visual State Machine

### §11.1 Two orthogonal dimensions

Each entity holds two independent states:

| Dimension | Source | Cross-tab behavior | Edge values | Node values |
|-----------|--------|--------------------|-------------|-------------|
| **op** | persistent user action (right-click failure) | not cleared | `healthy` / `failed` | `up` / `down` |
| **role** | transient annotation from analysis results | auto-cleared on tab switch | `none` / `spt` / `backup` / `unbacked` / `load-inc` / `load-dec` / `simulated-fail` / `bc-{hub/normal/rare/idle}` / `traffic-{overflow/high/mid/low/idle}` | `none` / `endpoint` / `highlight` / `asym-mark` / `heat-{green/yellow/orange/red}` / `failed-node` / `bc-{hub/normal/rare/idle}` |

### §11.2 Render rules

```
op takes priority:
  edge.op = failed, or edge role = simulated-fail
                           → render as failed (red dotted, semi-transparent)
  node.op = down           → render as failed-node
  edge endpoint node.op = down → derived as failed (not written back to edge.op, keeping a single data source)
otherwise role maps directly to the corresponding CSS class.
```

### §11.3 Facade

`failedEdges` and `failedNodes` are Set-like wrappers over the state machine
(`has / add / delete / clear / size / iterator`), provided to the existing
algorithms as parameters — so the algorithm layer need not know the state-machine details.

### §11.4 Invariants

1. all Cytoscape `addClass / removeClass` must go through `setEdgeOp / setEdgeRole / setNodeOp / setNodeRole`; direct manipulation of element classes is forbidden
2. on tab switch, call `clearAllRoles()` — clears role only, leaves op untouched
3. the "Reset view" button (C1) = `C1_Path.reset()` → `clearAllRoles()` + clear the C1 result panels; "Clear all failures" = `failedEdges.clear() + failedNodes.clear()` followed by an unconditional C1 path re-render (whatever tab is active); the two are semantically separate

---

## §12 UI Tab Matrix (authoritative reference)

`index.html` has **10 tabs** in three groups. The table below is the
authoritative mapping of UI tab → backing § / function. Switching tabs calls
`TABS[tab].activate()` when the module defines it. C numbers follow the module
names (`C1_Path` … `C10_Edges`); on screen the audit group is ordered Failure,
N-1, ECMP, Asymmetric, Prefix.

### Live-status group (consumes right-click failure markers)

| UI tab | UI No. | Backing § / function | Auto-run on switch |
|--------|--------|----------------------|--------------------|
| Path | C1 | §4 `dijkstraECMP` + §5.4 `unbackupSegmentScan` | `C1_Path.render(src, dst)` |
| Matrix | C2 | §4 per-pair `dijkstraECMP`; four modes: cost, RTT/SLO (§4.5), Path Diversity `pairwiseEdgeConnectivity` (§4.5), bandwidth-survival `n1BandwidthSurvivability` (§4.6; computed on the intact topology) | `C2_Matrix.render()` |
| Centrality | C3 | §6.2 `allPairsLoad` (Edge BC) + §6.3 `computeNodeBC` (Node BC); node ranking can switch to §6.3b `computeNodeTraffic` (traffic-weighted, needs demand.js) | `C3_AllPairs.render()` |
| Link traffic | C4 | §6.2b `allPairsTraffic` (needs demand.js) | `C4_Traffic.render()` (actual load / utilization) |

### Design-audit group (ignores right-click failures, based on the complete topology)

| UI tab | UI No. | Backing § / function | Auto-run on switch |
|--------|--------|----------------------|--------------------|
| Failure sim | C5 | §6 `connectedComponents` + inline before/after delta of §6.2b / §6.2; SRLG via `expandSRLG` | none — user selects an element / SRLG |
| ECMP | C6 | §7 `ecmpBackupScanAll` | none — `runEcmpCheck` button |
| Asymmetric | C7 | §8 `detectAsymmetric` | none — `runAsymScan` button |
| Prefix | C8 | §9 `computeHeatmap` | none — `runHeatmap` button |
| N-1 | C9 | §10 `computeN1WorstCase` (+ capacity overflow for the top failures via `allPairsTraffic`) | none — `runN1Scan` button |

### Edit group

| UI tab | UI No. | Backing § / function | Auto-run on switch |
|--------|--------|----------------------|--------------------|
| Links | C10 | §1.3 editing (cost edits repaint labels; paths recompute when you switch to a live-group tab and its `activate` runs — `rerenderIfPathActive` is a no-op while C10 is active); includes §15 congestion optimization (`optimizeWeights`, needs demand.js) | `C10_Edges.render()` |

> **Group semantics**: the live-status group reflects the failures manually
> marked on the graph; the design-audit group is always based on the complete
> topology, asking "is the design itself resilient enough" rather than "is it
> reachable right now".

---

## §13 Algorithm Complexity

Let `V = number of routers`, `E = number of edges`. Dijkstra uses a **binary
min-heap** (`heapPush/heapPop`, `[dist,seq,node]`; the `seq` tiebreak makes the
equal-distance pop order match the old stable-sort → byte-identical results), so
a single SPT is `O((V + E) log V)`. **All-pairs computation uses single-source
reuse**: `dijkstraSource` computes from each source to all destinations in one
pass, and `enumeratePaths` then expands per dst, so "all-pairs" is **V
single-source runs**, not V² single-pair runs (the old version reran the source
for every (a,b), wasting V−1 redundant runs).

| Module | Single-run cost | Trigger frequency |
|--------|-----------------|-------------------|
| §4 SPT (single pair) | O((V+E) log V) | user click |
| §6.2 Load / §6.2b Traffic (all pairs) | **V × single-source** = O(V · (V+E) log V) | tab switch |
| §4 Matrix (C2) | **V(V−1) × single-source** (`dijkstraECMP` per pair; reuse not yet applied) | tab switch |
| §6 Failure Sim / Load | 2 × all-pairs | user click |
| §7 ECMP Check | O(V² · k · SPT) | user click, k = ECMP edge count (single-source reuse not yet applied) |
| §8 Asymmetric | **V × single-source** + V² expansion | user click |
| §10 N-1 | O((V + E) · V × single-source) | user click (cost only, no path expansion) |
| §4.6 Bandwidth-survival (all pairs) | O(V² · L · (V+E) log V), L = primary-DAG edge count (`dijkstraSource` rerun per pair) | C2 mode switch |
| §15 Weight optimization | O(maxEvals × all-pairs) (budget cap) | user click |

The built-in synthetic sample is a POC small scale (a handful of routers, dozens
of edges). With the binary heap + single-source reuse, the §15 weight-optimization
worst case measured down from ~5.2s to ~1s (about 5×; a one-off measurement on
one machine and dataset, not a spec value), and the all-pairs Dijkstra
call count dropped ~V×. The scale is set by the generator and can be scaled up;
once into real backbone scale (V in the tens to hundreds, E in the hundreds), a
Web Worker or backend is still needed, plus **incremental SPF** (changing one
weight only recomputes affected paths, listed as a next step in §15.6). The
actual numbers vary with the dataset — this table gives **order-of-magnitude
relationships**, not fixed values for any specific dataset.

---

## §14 Differences from the original OSPF spec

This SPEC corresponds to Topocide POC `v1.x` (after branching off from the
Topolograph naming). Main differences:

- Added §6.2b traffic-weighted edge load (`allPairsTraffic`) + the C4 edge-traffic tab
- Added §10 N-1 Worst-case Ranking (single p2p edges + single routers; SRLG group failure is a separate C5 feature, not part of §10)
- Added §4.6 C2 bandwidth-survival matrix mode (`n1BandwidthSurvivability`; OSPF cost-based ECMP, N-1 worst-case surviving bandwidth, `ceil`-rounded, uncapped — can exceed 100 %)
- §11 visual state machine pulled out into its own chapter (previously scattered across UI handlers)
- §12 changed to an authoritative "UI tab (C1–C10) → backing §/function" mapping; algorithms are anchored solely by §, no longer by C numbers (the old `Cx` prefix in engine.js has been removed)
- Added §6.3b traffic-weighted node centrality (`computeNodeTraffic`) + the C3 transit-count⇄traffic-weighted toggle
- Added §15 OSPF weight optimization (Fortz-Thorup objective + Tabu Search), integrated into C10; the optimizer's bounds are capped by `COST_CLAMP` (`[5,500]`, a single constant exported by the engine), preventing long-link RTT floors from hitting the ceiling and being frozen
- Added §4.5 matrix RTT/SLO mode (C2 defaults to an RTT view scored against an SLO target, with coverage %)
- Added an OSPF LSDB import path: the shared pure module `ospf-import.js` parses `show ip ospf database router/network` into the §1 schema (populating `rid`) and can generate `*.imported.js` datasets (written to `../output/` alongside the demo data; not committed to this repo) — the original spec assumed a hand-authored static topology
- Demand values changed from integer to **float Gbps** (1 d.p. in gen.mjs; 3 d.p. in companions); profile set expanded to 5: `avg` / `max` / `asia_busy` / `amer_busy` / `eu_busy` (companions now matches gen.mjs); RTT CSV files renamed `node_rtt.csv` / `city_rtt.csv`
- `gravity.js` (repo root; the pipeline scripts still import it as `../output/gravity.js`) is now the SSOT for gravity model constants (D0/K/EMIT/FIBER), `CITY_GEO` (100+ cities, lat/lon/country), and `haversineKmCity()`; browser + Node compatible; imported by `gen.mjs`, `companions.mjs`, `ospf-import.js`, and `edit.html` (replaces `working/gravity.mjs`)
- `gen.mjs` no longer emits `rtt.cityRef` (a mirror of `city_rtt.csv`, never consumed by the frontend); the committed `rtt.js` predates this and still contains it until regenerated
- `ospf-import.js` `OSPF_CITY` values simplified from `{ city, country }` objects to plain city code strings; country is derived from `CITY_GEO` in `gravity.js`
- `edit.html` data editor: Equal Earth projection LON0 changed from 140°E to 150°E in both `layoutGeoMap()` and `layoutMetroMap()` (ITU/Telegeography Asia-Pacific convention; seam at −30°W avoids Fortaleza wrapping to the wrong side); new **Metro Map** layout option ("八向化") added — Equal Earth projection → grid quantization → Octilinear Nudge → overlap resolution; parameters in `LAYOUT_PARAMS.metro` (`grid`, `nudgeIter`, `angleTol`, `geoAnchor`, `distPow`); a `directions` 8/16/32 selector exists only in `tools/metro-tune.html`; ~70–80% of edges achieved octilinear angles in a one-off measurement
- **edit.html data architecture**: JS SSOT Maps (nodes/edges/positions) as single source of truth; cy is renderer only. Inspector uses mount/patch pattern — only rebuilds DOM when switching elements, patches field values in-place otherwise. `applyField` writes Maps first, then syncs to Cytoscape (`_skipCySync` flag prevents cy data events from bouncing back to Maps). Inside edit.html, `externals` are held per-node (`node.externals`) and flattened back to the top-level array on export. localStorage drafts via the shared `draft.js` module; cross-tab updates via a `BroadcastChannel('topocide')` opened in each page (see §2.1).
- `metro-tune.html` (now `tools/metro-tune.html`): new standalone interactive parameter tuner for Metro Map layout; features 6 compression modes, live preview with edge coloring (green=octilinear / orange=near / red=non-octilinear), direction selector (8/16/32), and display controls
- `serve.py` (not yet committed to this repo): new dev HTTP server returning `Cache-Control: no-store`; replaces `python -m http.server` which had ~1 min browser-cache delay
- **Planned (not implemented)**: explicit-path steering **steer** (Tier 0, pull specific traffic off the shortest path) + bandwidth admission **CAC** (Tier 1, "overflow / admission-fail once full"). Design in `docs/design/steering-cac.md`; once implemented, merged into a new §.

The top-level block comments in `engine.js` (`§4 — SPT` …) correspond two-way with
the § numbers in this document, including the §15.x sub-blocks (tagged by topic:
§15.1 objective — `ftLinkPenalty` / `evalCongestion`, §15.2 hard constraints —
`buildWeightBounds`, §15.3 Tabu driver, §15.5 functions — `applyWeights`).
§5.1 / §6.1 / §6.2 / §10.x have no engine block tag. UI tab numbers are separately in §12.

---

## §15 OSPF Weight Optimization (Fortz-Thorup objective + Tabu Search)

Given demand and capacity, automatically search for a set of OSPF weights that
**lowers congestion**. Congestion evaluation reuses §6.2b `allPairsTraffic`
(ECMP equal-split), so this section is "a search layer wrapped around the
existing load engine" — it does not touch SPT/ECMP.

### §15.1 Objective function (lexicographic two-level)

```
minimize ( MLU , S )
  MLU = max_e u_e            primary: max link utilization u_e = traffic_e / cap_e
  S   = Σ_e (scale see below) secondary: tie-break (among equal-MLU solutions, pick the lower total congestion)
```

`S` auto-switches by regime (`tieBreak='auto'`):

| Regime | S | Motivation |
|--------|---|------------|
| Feasible (MLU<1) | `Σ u_e²` (balance) | the primary objective already kills the peak; the secondary smooths the remaining load |
| Overloaded (MLU≥1) | `Σ cap_e · ψ(u_e)` (FT convex) | when you can't get under 100%, pick the least-bad solution with **fewest links deep in the red** |

`ψ` = Fortz-Thorup piecewise-convex (slopes 1→3→10→70→500→5000, knees
1/3·2/3·9/10·1·11/10), cap-weighted so overload on a big pipe carries higher
weight. Comparison uses an ε-band: the primary objective only decides when the
MLU difference exceeds ε, otherwise compare S.

**MLU = max edge utilization**, where utilization uses §6.2b's **busier-direction
value** (`max(fwd, rev)/capacity`, unidirectional capacity), counting "all edges
that have capacity" (p2p + transit) (Option A, the same edge set as C4 edge
traffic → consistent definition across the two views). Rationale: congestion on
a transit segment (the Router→Pseudo of a shared LAN) is real; excluding it would
let the optimizer lower p2p while being blind to a worse LAN segment, **overstating
its score**. The optimizer **only adjusts p2p weights by default** (using p2p
reroutes to redistribute the LAN ingress across the multiple attached routers);
it can also optionally **adjust transit ingress cost as well** (Option B,
`includeTransit`, see §15.6).

> **Impact of the direction fix**: after switching to unidirectional peak, the
> earlier "sum both directions / divide by unidirectional capacity" ~2×
> overestimate disappears. In a one-off measurement on the dataset of the time
> (not a spec value), the `max` scenario MLU was corrected from
> 202% (inflated) to **101%** (70% after optimization, **feasible**) — the
> original "infeasible" verdict was a counting artifact; capacity is in fact
> sufficient. transit's `fwd`/`rev` are already separated (§6.2b), so Option B's
> directional information is **ready** and is no longer a blocker for B.

### §15.2 Hard constraints (rigid pruning, not scoring)

Each p2p edge gets an integer weight bound `D_e = [lo_e, hi_e]`; when Tabu
generates neighbors it only proposes within bounds:

```
lo_e = max( 5, ⌈rttFloor_e⌉, protected_e ? current : 5 )
hi_e = min( 500, vip_e ? current : 500 )
```

| Red line | Effect | Meaning |
|----------|--------|---------|
| RTT floor (`rttFloor`) | `lo ≥ impliedCost(rtt)` | cost must not fall below the physical latency limit |
| VIP / main artery (`vip`) | `hi = current` | seal off raising → keep attractiveness, traffic is not driven away |
| Failure-prone / standby (`protected`) | `lo = current` | seal off lowering → normally isolate ordinary traffic |
| Global clamp | `COST_CLAMP` default `[5, 500]` | output is a positive OSPF integer, directly configurable; the 500 ceiling avoids long-link RTT floors hitting the ceiling and being frozen |

`lo>hi` (red-line contradiction) → clamp to `current` and mark `conflict`;
`lo≥hi` → `frozen` (not entered into the neighborhood). `vip` / `protected` are
**reserved interfaces**: the engine takes `Set` parameters, and until the source
(policy file / UI checkbox) is settled they default to empty sets, so the only
constraints actually in effect are the RTT floor + `COST_CLAMP` (`[5,500]`).

### §15.3 Tabu Search

| Aspect | Design |
|--------|--------|
| Start | `warm` (project current-network cost into bounds, minimal perturbation) or `invcap` (`round(maxCap/cap)`) |
| Neighborhood | single-edge move, candidates `cur±{1,2,4} ∪ {lo,hi}` (`steps` default `[1,2,4]`) clamped to `D_e`; frozen edges skipped (pruning) |
| Evaluation | each candidate `applyWeights → evalCongestion` (= one all-pairs traffic round) |
| Selection | best non-tabu neighbor; **aspiration**: a tabu move that breaks the global best is unbanned |
| Tabu list | records the reverse move `(edge,oldW)`, tenure = `tabuTenure` or `max(5, round(√movable))` |
| Diversification | `stallK` (default 8) consecutive non-improving rounds → randomly reset `divM` edges (seeded PRNG) |
| Termination | `MLU ≤ target` (default 0.75) / cap `maxIters` (default 300) / global best not improved for `stopAfter` iterations (default `max(15, stallK + 12)`) / no movable neighbors → return the global best |
| Budget | `maxEvals` (default 6000; deterministic primary limiter, counts neighborhood evaluations, checked once per iteration so a run can overshoot by up to one neighborhood; diversification and `binding` evaluations are not counted) caps runtime; `timeBudgetMs` (default 15000) is only a runaway safety (large enough not to trigger at normal scale); `seed` default 1 |
| Reproducibility | `mulberry32(seed)` + `maxEvals` (not wall-clock) → same input same output → stable export |

### §15.4 Infeasibility handling (first-class output)

- `MLU ≤ target` → `targetMet`
- `target < MLU < 1` → `feasible` but below target
- `MLU ≥ 1` → **no solution within constraints**: return `bottleneck` (the edges at MLU) and `binding` — relax each out-of-bound by one step (trials stay inside `COST_CLAMP`) and recompute, ranking "which red line, when loosened, lowers MLU most" by MLU gain; the top 5 are returned, each `{ edgeId, dir: 'fwd' | 'rev', relaxTo, mluAfter, gain }`, for a human to decide on loosening.

### §15.5 Functions (engine.js, pure)

```
ftLinkPenalty(load, cap)                         → cap·ψ(load/cap)
evalCongestion(topoW, demand, fE, fN)            → { mlu, sumU2, sumPhi, util, lostDemand }
applyWeights(topo, weights)                      → shallow copy of topo; weight keys are "weight variables" (eid=forward/symmetric, eid|rev=reverse), no mutation
buildWeightBounds(topo, { rttFloor, vip, protectedSet, clamp, includeTransit, asymmetric })
                                                 → Map<varKey,{lo,hi,frozen,conflict,current}>  (varKey = eid / eid|rev)
optimizeWeights(topo, demand, bounds, opts)      → { weights, mlu, sumU2, sumPhi, util, feasible,
                                                     targetMet, target, bottleneck, binding, frozen,
                                                     history, iterations, elapsedMs }
```

### §15.6 Known limitations

- **Only optimizes the no-failure state**: no guarantee of being better for N-1 (§10); robust TE (optimizing for the worst failure) is on the Roadmap.
- **Weight variables**: each p2p edge has one variable per direction — forward `eid`, reverse `eid|rev`. Conditions for opening the reverse variable:
  - **Default (`asymmetric:false`)**: only edges that are "inherently asymmetric in the data" (`costRev != null && != cost`) open a reverse variable; symmetric edges have a single variable (cost=costRev=w), **behavior identical to the old version**.
  - **Opt-in (`asymmetric:true`, the UI "allow asymmetric weights" checkbox)**: **all p2p edges** open a reverse variable (forward/reverse independent, current value `costRev ?? cost`), allowing symmetric edges to also be optimized into asymmetric ones.
  - FT is inherently a directed problem; symmetry is just a compute-saving convention (see §14); **under symmetric demand, asymmetry gives no gain** (so even when checked on the current network it takes the baseline). Red lines (RTT/VIP/protected) share one set of bounds for both directions.
- **transit ingress cost is also optionally adjustable** (Option B, `buildWeightBounds({ includeTransit:true })`, the UI "also adjust transit" checkbox): only moves `e.cost` (ingress), does not apply the RTT floor, bounds `COST_CLAMP` (`[5,500]`); egress (`PN→router`) is hard-wired 0 by `buildAdjacency`, so B inherently does not violate Type-2 semantics.
- **"Never worse" guarantee (UI layer, generalized)**: C10 always runs the **baseline** (default configuration, `init: 'warm'`) first; if any advanced option (InvCap start / asymmetric / transit) is checked, it additionally runs the **chosen configuration** and keeps it only if its MLU is strictly lower than the baseline's (`rSel.mlu < rBase.mlu − 1e-9`; MLU only, not the lexicographic (MLU, S) objective). Rationale: advanced options enlarge the search space and, under a fixed evaluation budget, may fall into a **worse local optimum** (one-off single-seed measurement: transit 73.8% vs baseline 67.2%); this guarantee ensures the result does not regress. Note: the gap is seed-sensitive (multi-start can catch up), not inherent to the option being worse.
- **Consumes the active demand profile**: optimizing `avg` vs `max` yields different weights; operationally one usually optimizes `max`.
- **Weights protect a link's attractiveness, not a specific flow's path**: OSPF is destination-oriented + ECMP-split, so it cannot hard-guarantee that a specific flow takes a specific path; hard guarantees need SR / policy routing, out of scope here.
- Scale per §13: each evaluation is one all-pairs round. To preserve **determinism**, the runtime primary limiter is `maxEvals` (evaluation count) rather than wall-clock; same seed/same graph → same result, runtime varies with the machine but is bounded. `timeBudgetMs` is only a runaway safety, not triggered at normal POC scale (so it doesn't break determinism); for real backbone scale switch to Web Worker + incremental SPF (this version recomputes in full). The UI-side search is synchronous, painting "computing" first then yielding one macrotask so the spinner paints.

> **UI mapping**: the "congestion optimization" block within tab **C10 Link**;
> results are written back to `edge.cost` / `edge.costRev` by `applyOptimize`
> (symmetric edges drop `costRev`; then `paintEdgeLabels` + `render()` +
> `rerenderIfPathActive()`, the same repaint / recompute steps as
> `applyEdgeChange`, which it does not call), then carried away by the existing
> "export topology.js". The optimizer is the
> **third weight source**, after manual and RTT.

---

## §16 Internationalization (i18n)

The UI is fully bilingual (zh / en) via a single dictionary + `t()` lookup;
`engine.js` plays no part in display (it emits codes only — see the §7 reason contract).

### §16.1 Dictionary and lookup

- `index.html` `§0.5 I18N` defines `const I18N = { zh: {...}, en: {...} }`; the two languages' keys **must be symmetric**.
- `t(key, params)`: looks up `I18N[LANG][key]`; returns the value if a string, or `value(params)` if a function; **a missing key returns the key itself** (so gaps are visible on screen).
- Strings with variables use function values: `'c2.failStatus': (p) => \`Current failures: ${p.e} link(s) / ${p.n} node(s)\``.
- Labels that vary by language but live in object constants (tier `label` / `action`) use a **getter** → `t()`, so they resolve at render time and switch instantly.

### §16.2 Static HTML injection (`applyStaticI18n`)

Four attributes, chosen by injection target:

| Attribute | Injects | For |
|-----------|---------|-----|
| `data-i18n` | `textContent` | plain-text elements |
| `data-i18n-html` | `innerHTML` | copy containing `<b>` / `<span>` markup |
| `data-i18n-title` | `el.title` | the `title` tooltip attribute |
| `data-i18n-optlabel` | `el.label` | `<optgroup>` labels |

The Chinese stays in the HTML as a no-JS fallback; `applyStaticI18n()` overwrites it at startup and on language switch. Spans filled by JS at runtime (e.g. the C10 formula constants) must be re-filled in `render()`, because `data-i18n-html` rebuilds child nodes.

### §16.3 Dynamic render

Each tab's `render()` uses `t(key, params)` throughout; switching tabs / language re-renders, so dynamic strings update with it.
**Note**: if a `render()` declares `const t = …` (e.g. `TIERS[tier]`) it shadows the translation `t()`; within that block only read `t.label` (resolved by the getter) — do not call the translation `t()` there.

### §16.4 Key naming and dedup

- Naming `<scope>.<sub>`: `common.*` (cross-tab shared), `c1.*`–`c10.*` (per tab), `ui.*` (chrome).
- Strings identical across tabs are pulled into `common.*` (e.g. `common.auditBanner` / `scanAllPairs` / `recalc` / `status.*` / `tier.*`).
- Engine code → text uses dynamic key building, e.g. `t('c6.reason.' + code, row)` (the alignment check will show "defined > literal references", which is expected). `c5.optType.*` / `c5.srlgType.*` are resolved through literal lookup tables instead.

### §16.5 Language state and switching

- Default language: `localStorage['br-lang']` > browser language (`zh*` → zh, otherwise → en).
- `setLang(lang)`: persists to localStorage + `applyStaticI18n()` + updates the toggle-button label + re-renders the active tab.
- `#langToggle` in the left "Controls" panel (`data-action="toggleLang"`) shows "the language to switch to".

### §16.6 Not translated

- Identifiers in generated data: node codes (`TPE\nTW`), prefixes, subnets, `§` / `Cx` anchors, CSS classes, role/op names.
- Intentionally-retained technical English (some headers Node/Total, Connected/DISCONNECTED, etc.).

> **Contract with the engine**: anything the engine returns to the UI as a "reason / status / category" is always a stable code + structured params (§7); display text is the job of `t()` in this section. The engine must contain no user-facing prose strings (only comments may be in Chinese).
