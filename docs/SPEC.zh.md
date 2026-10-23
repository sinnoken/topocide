# Topocide SPEC

本文件規範 Topocide POC 的資料模型、演算法定義、模組分層與視覺狀態機。
**以程式碼為準** — 本文件描述的是 `engine.js` / `index.html` 的實際行為。

## 編號慣例(務必先讀)

- **演算法**:一律以 **§ 編號**錨定(§4–§10、§15),`engine.js` 區塊註解同樣以 `§N —` 領頭,雙向追溯。
- **UI 分頁**:`C1–C10`,純屬 `index.html` 上 10 個 Tab 的命名,**只用於畫面**。

換言之 `Cx` 一律指 UI 分頁;演算法不再用 C(舊版曾在 engine.js 加 `Cx` 前綴,因與 UI 分頁同字母易混,已移除)。
兩者**不是一對一**:例如「失效模擬」是 UI 分頁 C5,核心演算法卻在 §6。
UI 分頁與其背後 § / 函式的對照集中在 §12。

---

## §1 資料模型

> **注意**:本節定義的是**資料 Schema(模型)**,非任何特定資料集。
> 內建拓樸 / 流量 / RTT 為可替換的合成樣本,由產生器輸出;欄位結構才是穩定契約。

### §1.1 Topology Schema

`topology.js` 暴露單一全域變數 `topology`,結構如下:

```js
const topology = {
  nodes: [...],       // Router + Pseudo-node
  edges: [...],       // p2p / transit 邊
  externals: [...],   // LSA5 (optional)
  positions: { ... }, // Cytoscape 預設座標 (optional)
};
```

> **注意（edit.html 內部狀態）**：`topology.js` 與 `engine.js` 只使用頂層 `externals` 陣列。edit.html 內部以 per-node 方式持有 `node.externals = [{subnet, metric, metric_type}]`（`advertising_router` 由所屬節點隱含）；匯出時攤平回頂層陣列，並以節點 id 補回 `advertising_router`。

### §1.2 Node

```ts
type Node =
  | {
      id: string;            // 唯一識別;PoP 簡稱(TPE / TYO …)或 OSPF 匯入時為安全 token(城市碼+序號 / R_<rid> / PN_*)
      label: string;         // 圖上顯示文字,支援 \n 換行
      type: 'router';
      rid?: string;          // OSPF Router-ID(OSPF 匯入器設定;hostname 若有則餵入 `label`)
      country?: string;      // ISO 國別碼(UI 分群 / 著色用)
      city?: string;         // 城市碼(RTT 城市對查表錨點)
      area: string;          // OSPF area(目前僅支援 '0')
      stubs?: string[];      // LSA3 等價:該 router 宣告的 prefix(CIDR)
      isASBR?: boolean;      // 是否為 ASBR(對外注入 LSA5)
      isABR?: boolean;       // 是否為 ABR(目前未啟用 inter-area 計算)
    }
  | {
      id: string;            // 必須以 'PN' 開頭(LSA2 抽象);engine.js 以此 id 前綴判斷 pseudo-node
      label: string;
      type: 'pseudonode';
      subnet: string;        // 該 transit LAN 的 CIDR
    };
```

> **id 限制**:router id **不可**以 `PN` 開頭 — `buildAdjacency` 與 `stripPseudo`
> 以 `PN` id 前綴判斷 pseudo-node,而非看 `type`(`engine.js` §3 / §4.3)。已知問題:
> OSPF 匯入器把 hostname 前綴 `CB` 對應到城市碼 `PNH`,產生的 router id `PNH1`、`PNH2`…
> 會被誤判為 pseudo-node。

### §1.3 Edge

```ts
type Edge =
  | {
      id: string;
      source: string;
      target: string;
      cost: number;          // 正向 cost(source → target)
      costRev?: number;      // 反向 cost(僅 p2p,省略時等於 cost,即對稱)
      capacity?: number;     // 鏈路容量(Gbps),供利用率計算(C4、C5、C9 超載、C10 優化器、§4.6)
      type: 'p2p';
      net?: string;          // 僅 OSPF 匯入:來源 transit 網段(例如 /30)
    }
  | {
      id: string;
      source: string;        // 一端為 Router、另一端為 Pseudo-node
      target: string;
      cost: number;          // Router → Pseudo 的 cost
      capacity?: number;
      type: 'transit';       // Pseudo → Router 固定為 0(LSA2 語意)
    };
```

### §1.4 External (LSA5)

```ts
type External = {
  advertising_router: string;   // 哪台 ASBR 注入
  subnet: string;               // 例如 '0.0.0.0/0'
  metric: number;
  metric_type: 'E1' | 'E2';
};
```

### §1.5 伴生資料檔(optional)

| 檔案 | 全域 / 匯出 | 供哪個 UI 分頁 | 缺檔時行為 |
|------|-------------|----------------|------------|
| `demand.js` | 全域 `const demand`(有 `module` 時另加 `module.exports = { demand }`) | profile 下拉、C3 流量加權排名、C4 邊流量、C5 前後流量、C9 容量超載、C10 優化器 | **目前會崩潰**:index.html 在 module 頂層未加防護就讀 `demand.profiles`,缺檔時整頁停止。各分頁另有退路(C4 訊息、C3 加權切換停用、C10 優化器訊息),但在補上該防護前都走不到 |
| `rtt.js` | 全域 `const rtt`(有 `module` 時另加 `module.exports = { rtt }`) | C2 RTT/SLO 矩陣模式(§4.5)、C10 成本參考(另讀 `fiberRttPerKm`) | C2 退回純成本;C10 參考欄仍顯示,p2p 列顯示「無參考」與琥珀條警示 |
| `srlg.js` | global `srlg`(無 exports) | C5 失效模擬的 SRLG 下拉 | C5 下拉只剩單一 router 失效選項 |
| `draft.js` | `window.Draft` | index.html + edit.html 的 localStorage 持久化 | — |

`draft.js` 是共用的 localStorage 持久化模組,暴露
`window.Draft = { KEY, MAX_AGE, read(), write(data), clear() }`,只有**單一** key
`blastradius-draft`,有效期 2 小時(`_savedAt` 時間戳)。兩頁都會傳 topo key
(`Draft.read(topoKey)`、`Draft.write(data, topoKey)`),但 `draft.js` 忽略它 — 見 §2.1 已知問題。

`demand.js` 提供 **5 個情境 profile** — `avg` / `max` / `asia_busy` / `amer_busy` / `eu_busy` — 透過 `demand.active` 切換；`engine.js` 只讀 `demand.matrix` / `demand.default`(profile 切換對演算法透明)。值為 Gbps 數值:gen.mjs 輸出 1 位小數、companions.mjs 輸出 3 位(repo 內的 `demand.js` 來自較早的產生器,全為整數)。`rtt.js` = `{ unit, note, fiberRttPerKm, timestamp, matrix, edges }`,`matrix` 為城市×城市 RTT,`edges[]` 為 `{ a, b, rtt, src }`(PoP 節點對 RTT,`src` ∈ `measured` / `city-ref` / `model`)。gen.mjs 與 edit.html 匯出已不再輸出 `cityRef`(`city_rtt.csv` 的鏡像);repo 內的 `rtt.js` 早於此變更,仍含舊的 `cityRef`,但沒有任何程式讀取。

**OSPF 匯入資料集**:`topology.imported.js`(+ companion `demand/srlg/rtt.imported.js`)
由匯入流程從真實 `show ip ospf database router/network` 輸出產生,寫到 `../output/`,
與 demo 的 `*.js` 並存、不互蓋。這些檔案沒有提交到本 repo,而且 pipeline 用的 `../output/`
路徑在本 repo 中不存在。LSDB 解析為共用純模組 `ospf-import.js`(資料編輯器與
`pipeline/ospf_to_topology.mjs` 共 import);匯入的 router 節點帶 `rid`(§1.2)與安全 token 的 `id`。
`ospf-import.js` 的 `OSPF_CITY` 值為純城市碼字串；country 由 `gravity.js` 的 `CITY_GEO` 衍生（城市地理 SSOT）。
工具鏈與固定產生順序見 CLAUDE.md。

---

## §2 模組分層

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

呼叫方向只有「向下依賴」 — UI 呼叫 Engine,也直接呼叫 Builder(`buildAdjacency`、
`buildPrefixIndex`,兩者都是 `engine.js` 的純函式 export),Engine 呼叫 Builder,Builder 讀 Topology。
State Machine 是 UI 跟 Engine 之間的橋:UI 透過 `setEdgeOp / setNodeOp` 操作持久狀態,
Engine 透過 `failedEdges / failedNodes` facade 讀取。

### §2.1 持久化與同步(edit.html ↔ index.html)

```
使用者操作(Inspector / cy 互動)
            ↓
    cy(canvas,Cytoscape.js)
            ↕  _skipCySync 防循環
nodes / edges / positions Maps(拓樸 SSOT;externals 已併入 node.externals)
            ↕
D / S / R(demand / srlg / rtt 物件,各 tab 直接讀寫)
            ↓
markDirty(1.5 秒 debounce)
    → Draft.write → localStorage(draft.js,2 小時有效期)
    + edit.html 在 BroadcastChannel 'topocide' 發送 'topo-update'
      (只含 nodes / edges / positions)→ index.html 併入自己的草稿後 reload
    + CF Workers + R2(僅 edit.html):以同步按鈕手動推送;
      沒有本地草稿時,載入時自動拉取
```

**寫入路徑**(edit.html):Inspector 欄位與 stubs chip 先寫 Maps,再以 `_skipCySync`
同步 cy;cy 拖曳事件回寫 Maps(臨時元素由 `isGhost()` 過濾);D/S/R 各 tab 直接改物件,
render 末端呼叫 `markDirty()`;`renameEle` 同步更新 cy 與 D/S/R。
`hydrateAll`(從草稿 / remote 還原)只在最後的 `select(null); refresh()` 前後設 `_hydrating`,
讓這次 refresh 不會再標記 dirty;載入內建 `.js` 檔時仍會呼叫 `markDirty()`(因此會寫入草稿)。

**載入優先序**
- edit.html:本地草稿 > remote(R2)> 內建 `.js`
- index.html:廣播 > 本地草稿 > 內建 `.js`(remote 載入是註解掉的 stub,未實作)
- `?topo=<key>` 兩頁互傳;沒有時 R2 key 退回每個瀏覽器的 client id。

**評估後不做**:以 EventBus / Proxy 讓所有 Maps 寫入自動 fan-out。`_skipCySync` 已解決
Inspector → Maps → cy 循環,D/S/R 深層 mutation 用 `markDirty()` 補救足夠,
pub/sub 的複雜度(漏訂 topic、source flag、多層 debounce)在這個規模超過收益。

**已知問題**
- `draft.js` 的 `read()` / `write()` 忽略呼叫端傳入的 topo key,所有 `?topo=` 共用同一份
  localStorage 草稿(`blastradius-draft`)。
- index.html 只從草稿或廣播取 nodes / edges / positions;demand / srlg / rtt 永遠來自
  內建檔(也沒有雲端載入)。
- edit.html 編輯的 External(LSA5)不會傳到 index.html:草稿帶的是 `node.externals`,
  但 index.html 與 `buildPrefixIndex` 只讀頂層 `topology.externals`。
- D/S/R 深層 mutation 無法自動偵測(render 末端的 `markDirty()` 補救)。
- `RTT_OK=false` 時優化器沒有 RTT 下限;p2p 欄位顯示琥珀條警示。

---

## §3 Graph Builder

### §3.1 Adjacency (`buildAdjacency`)

把 `topology.edges` 轉成 Dijkstra 用的鄰接表 `adj[u] = [[v, cost, edgeId], ...]`
(`edgeId` 讓平行鏈路保持區分)。三條規則:

**Rule 1 — p2p edge**

```
add(source, target, cost)
add(target, source, costRev ?? cost)
```

**Rule 2 — transit edge (LSA2 語意)**

```
add(router, pseudo, cost)   // Router → Pseudo:有 cost
add(pseudo, router, 0)      // Pseudo → Router:固定 0
```

pseudo 端是 id 以 `PN` 開頭的那一端(兩種方向都接受)。

**Rule 3 — 故障過濾**

- `failedEdges.has(e.id)` → 整條跳過
- `failedNodes.has(u) || failedNodes.has(v)` → 該方向跳過

### §3.2 Prefix Index (`buildPrefixIndex`)

`prefix → Set<advertising_router_id>`,集合大小 ≥2 視為 backed-up。來源:

| Rule | 來源 | 行為 |
|------|------|------|
| Rule 3 | `node.stubs` | 該 router 為 advertiser |
| Rule 5 | LSA2 transit | 所有 attached routers 都「擁有」該 pseudo-node 的 subnet |
| Rule 4 | `externals` | LSA5 中的 `advertising_router` 為 advertiser |

---

## §4 SPT + ECMP

### §4.1 演算法

Dijkstra + 等成本鬆弛擴展。`dijkstraSource(adj, src)` 回傳 `{ dist, preds }`;
`preds[v]` 是 **`{ u, id }` 陣列**(前驅節點 + 邊 id),允許多個前驅:

```
for each neighbor (v, c, id) of u:
  nd = dist[u] + c
  if nd < dist[v]:
    dist[v] = nd
    preds[v] = [{ u, id }]
  elif nd == dist[v]:
    preds[v].push({ u, id })   // 不去重:平行等價鏈路各自保留
```

等距節點依插入順序出 heap(`[dist, seq]` tie-break)。

### §4.2 ECMP 路徑枚舉

`enumeratePaths(dist, preds, src, dst)` 從 `dst` 遞迴展開 `preds`,回傳
`{ cost, paths, edgePaths }`,每條 **edge-distinct** 路徑一筆(平行鏈路的節點序列相同、
`edgePaths` 不同)。不可達的 `dst` 回傳 `{ cost: Infinity, paths: [], edgePaths: [] }`。
`dijkstraECMP(adj, src, dst)` = `dijkstraSource` + `enumeratePaths`。

### §4.3 Pseudo-node 後處理

`stripPseudo(path)` 把路徑中以 `PN` 開頭的節點過濾掉,呈現「router-level」視角。

### §4.4 IP / Network 解析

`resolveLPM(prefixIndex, target)`:目前實作為「精確匹配 + default route(`0.0.0.0/0`)fallback」。完整 LPM 為 Roadmap。

### §4.5 矩陣模式:RTT / SLO + 路徑備援(C2 呈現)

C2 有四種檢視模式(**預設 RTT / SLO**):成本、RTT / SLO、路徑備援(Path Diversity)、
頻寬存活(§4.6)。列為目前故障下從第一台 router 可達的 router,依其 `dijkstraDist` 排序;
每格是一次 per-pair 的 `dijkstraECMP(adj, a, b)`。

**成本**顯示 §4 最短路徑成本。

**RTT / SLO** 沿最短路徑加總各邊 RTT,依 SLO 目標(預設 ≤150 ms)為每格上色。每邊 RTT:
先查以節點對為鍵的 `rtt.edges`(兩種方向),否則查 `rtt.matrix[cityA][cityB]`,再查
`rtt.matrix[cityB][cityA]`;**沒有 RTT 資料的邊算 0 ms**(已知問題 —— transit 邊沒有 RTT,
經過 pseudo-node 的路徑會被少算)。ECMP → 取各路徑最小。覆蓋率 = 達標 pair ÷ 所有顯示的
非對角 pair,不可達(∞)與沒有 RTT 值的格子都算未達標。此為 `index.html` 的呈現層(engine
沒有對應 § 區塊)—— 路徑本身仍是 §4 以成本為準的 SPT。需 `rtt.js`;缺則退回成本模式。

**路徑備援(Path Diversity)** — `pairwiseEdgeConnectivity(edges, routerIds)`(engine 區塊
`§4.5 — PATH DIVERSITY`):每對節點的邊不相交路徑數,以 Edmonds-Karp 最大流計算,每條邊
每方向容量 1(平行邊分別計算)。UI 傳入目前的邊(含 transit,pseudo-node 當中繼),並移除
右鍵故障。格子分級:k = 0 紅、1 橙、2 黃、≥ 3 綠。

### §4.6 矩陣頻寬存活模式(C2 呈現)

`n1BandwidthSurvivability(edges, routerIds)` 回答每個節點對:*沿 OSPF 路徑發生最糟
的單一鏈路失效後,主路的頻寬還剩多少 %?* 格子色階:**0** 紅(N-1 後不可達)、
**1–49** 橙(嚴重縮水)、**50–99** 黃(部分保護)、**≥100** 綠(完整備援、甚至更好)。
存活率**可超過 100 %**(見下)。

這是 **OSPF cost-based** 指標:沿**流量實際會走的**最短路(§4 cost-based SPT / ECMP)
量頻寬,而非理想化的最寬路。以 `buildAdjacency` + `dijkstraSource`(§3.1、§4.1)為基;
**所有** `capacity > 0` 的邊都計入頻寬,p2p 與 transit 皆同(沒有容量的邊取最小值時忽略)。
以完整拓樸計算:不套用右鍵故障;只有列 / 欄成員與 ∞ 格子反映目前的故障。

**模型:**

1. **主路** — 該對節點的 OSPF 最短路 **DAG**(所有等成本 ECMP)。`spDagEdges` 走 `preds`
   收集 DAG 上每條邊(ECMP 邊聯集,免枚舉路徑)。分母 = `minCapOf(主路邊)`,DAG 上最窄的容量。
2. **N-1** — **沿主路 DAG 每條邊**逐一失效,transit 邊也包含在內(`buildAdjacency(edges, {eid})`),
   重算 OSPF DAG,取其邊聯集裡最窄的容量。失效後不可達 → 0;存活 DAG 沒有容量資料 → 0。
   `worstCase = min`(各情境)。
3. `rate = ceil(worstCase / 分母 × 100)` —— **不夾上限**。
4. 主路不可達、或主路 DAG 沒有容量資料時,結果為 `{ primary: 0, worstCase: 0, rate: 0 }`,
   UI 顯示「—」。
5. 只計算 `routerIds[i] → routerIds[j]`(`i < j`)再鏡射;成本不對稱時兩格都反映這個方向
   (UI 依與第一台 router 的距離順序傳入 router),而不是被點那格的 src。每一對都會重跑
   `dijkstraSource`。

**為何可超過 100 %。** 當 OSPF 主路是條細的低成本路,而單一失效把流量繞到較高成本但更肥
的備援時,存活頻寬會比主路還大 —— 例:主路 30 G、失效後 100 G → 334 %。最寬路 proxy 永遠
看不到這個(它的備援一定 ≤ 主路);OSPF 視角如實反映「主路細、備援肥」的真實情況。

**範圍:** 只做主路 DAG 邊的單一失效 —— 不做 N-2 組合,OSPF 路徑以外的邊永不失效(失效它們
不會讓存活頻寬低於完整主路)。ECMP 多路採**聯集**,故值 = 失效後轉送結構裡任何一處最窄的邊。
`index.html` 的呈現層;需邊帶 `capacity`。

---

## §5 Backup Path

### §5.1 砍邊重算

`backupPath(topo, src, dst, removedEdges)` 以完整拓樸只扣掉 `removedEdges` 建鄰接表
(`failedEdges = new Set(removedEdges)`;不包含目前的故障與失效節點),再跑 `dijkstraECMP`。

> 編號:沒有 §5.2 / §5.3;§5.4 保留原編號,讓既有引用(engine.js `§5.4`、§10.4)維持有效。

### §5.4 無保護段掃描 (Unprotected Segment Scan)

`unbackupSegmentScan(topo, src, dst)` — 對**所有** primary ECMP `edgePaths` 的邊聯集
(含 transit 邊)逐一試移除,若移除後 cost = ∞,標記為 unbacked。它永遠使用完整拓樸
(即使 C1 顯示的 primary 有套用目前的故障):

```
primary  = dijkstraECMP(buildAdjacency(topo.edges), src, dst)
for each edge e in union(primary.edgePaths):
  if backupPath(topo, src, dst, [e]).cost == ∞:
    unbacked.push(e)
return { primaryEdges, unbacked }   // primary 不可達 → 兩者皆空
```

語意:**該邊一壞,src → dst 就斷,沒有任何備援可走**。

---

## §6 Failure Simulation + Load

### §6.1 連通性

`connectedComponents(adj, routerIds)`:以迭代 DFS(stack)走**所有**節點 —— 會經過
pseudo-node,共用 LAN 的 router 正是靠它連起來 —— 產出的連通元件只列 router。

### §6.2 流量重分配(等分權重邊負載)

`allPairsLoad(topo, failedEdges, failedNodes)`:

```
load[edge] = Σ over all (a→b) pairs: 1 / r.paths.length
```

ECMP 等分權重,每條 path 對其經過的每條 edge 累加。此即**邊介數中心性(Edge BC)**。

前後差值沒有對應的 engine 函式:由分頁 **C5** inline 計算。它算兩次全網負載(`before` = 無故障、
`after` = 所選元件 / SRLG 失效);有載入 demand.js 時用 `allPairsTraffic`(§6.2b),否則用
`allPairsLoad`。逐邊:失效的邊列為 `down` 類,`changePct = -100`(`before = 0` 時為 0);
其餘取 `direction ∈ {inc, dec, none}`、`changePct = (after − before) / before × 100`
(`before = 0` 且 `after > 0` 時為 `Infinity`);`none` 的邊不列出;`inc` 列為 `up` 類、
`dec` 列為 `dec` 類。排序:down → up(依 |Δ%|)→ dec。

### §6.2b 流量加權邊負載(`allPairsTraffic`)

`allPairsTraffic(topo, demand, failedEdges, failedNodes)` — 與 §6.2 同樣的單源列舉方法
(`dijkstraSource` + `enumeratePaths`,自己跑一輪全對),但每條 path 的累加權重從「1」改為
「`demand[a][b]`」(吃 `demand.js` 流量矩陣)。回傳 `{ traffic, trafficFwd, trafficRev,
totalPairs, reachablePairs, lostPairs, totalDemand, servedDemand, lostDemand, lostDemandPairs }`。

**全雙工 / 單向容量**:電路預設全雙工、`capacity` 為**單向**值。故按實際走向分**去(`trafficFwd`)/
回(`trafficRev`)**兩個方向累計(用 path 的節點序列判向:`np[i]===e.source` 即「去」),
回傳的 `traffic[edge] = max(去, 回)` 取**較忙方向**。配合 `edge.capacity` 即得
**利用率 = max(去,回) / capacity**(即「較忙方向是否超載」),避免把雙向加總除單向容量造成 ~2× 高估。

- transit 同理:`fwd` = ingress(`router→PN`,可由介面成本控制)、`rev` = egress(`PN→router`,Type-2 固定 0)—— 前提是資料把 transit 邊存成 `source = router`(內建資料即如此);`buildAdjacency` 兩種方向都接受。
- 缺 `demand.js` 時呼叫端需自行擋掉(C4 分頁顯示「未載入」提示)。
- C4 邊流量、C5 失效模擬、§15 `evalCongestion`(MLU)、C9 N-1 溢出**皆讀同一個 `traffic[edge]`**(峰值),
  故方向修正一處生效、下游零改動。`allPairsLoad`(§6.2,邊介數)為 capacity-free 中心性,方向無關、不受影響。

### §6.3 節點樞紐度 (Node Betweenness Centrality)

`computeNodeBC(topo, failedEdges, failedNodes)`:Freeman 經典 BC,語意為「每台 router 平均扛多少過路 SPT 流量」。

```
BC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
          σ(s, t | v) / σ(s, t)
```

實作細節:

- ECMP 等分以 **node-distinct 路徑數**為分母:`w = 1 / (node-distinct 路徑數)`。平行等價鏈路(兩條纜、節點序列相同)收斂成一條,**不灌大**該節點中心性 —— 平行是鏈路容量的事(由 §6.2b 在邊層級處理),非節點介數。
- `stripPseudo(path)` 先過濾 pseudo-node,只保留 router-level 視角
- 排除 endpoints:迴圈 `for i in [1, stripped.length - 1)`,首尾不算「過路」
- 與 §6.2 `allPairsLoad`(Edge BC)用同樣的單源列舉方法(各自一輪),但累計目標從 edge 改為中繼 node
- **共用核心**:§6.3 與 §6.3b 都走同一個 `computeNodeLoad(topo, demand, …)`(`demand=null` → 結構;`demand` 給 → Gbps),透過 `nodeDistinctPaths` / `accNodeBetweenness` 工具 + 單源重用。兩個對外函式名只是薄 wrapper。

> **UI 對應**:分頁 **C3 樞紐度** 同時呈現 §6.2 的 **Edge BC**(每條鏈路)與本節的 **Node BC**(每台 router),
> 兩者各做 4 階分類(`hub > 0.4·max / normal > 0.1·max / rare > 0 / idle = 0`;門檻在
> index.html 的 `THRESHOLDS`),對應建議(i18n `c3.*.act.*`):
> - 鏈路:hub「擴容雙保」/ normal「維持」/ rare「降頻寬候選」/ idle「砍掉候選」
> - router:hub「雙機雙路」/ normal「維持」/ rare「可降規」/ idle「無轉送流量」

### §6.3b 流量加權節點樞紐度 (Demand-weighted Node Betweenness)

`computeNodeTraffic(topo, demand, failedEdges, failedNodes)`:與 §6.3 同一套節點累計(strip pseudo + 排除 endpoints),
但每對 `(a, b)` 的權重從「1」改為 `demand[a][b]`(吃 §6.2b 同源的重力模型流量矩陣)。
語意為「每台 router 平均**轉送多少 Gbps** 過路流量」—— 即 demand-weighted node betweenness。

```
WBC(v) = Σ over all (s, t) pairs where s ≠ v ≠ t:
           demand[s][t] · σ(s, t | v) / σ(s, t)
```

實作細節:

- ECMP 等分以 **node-distinct 路徑數**為分母:`w = demand[a][b] / (node-distinct 路徑數)`(與 §6.3 一致;平行鏈路收斂,**非** edgePaths)
- 單源重用(`dijkstraSource` 每來源一次,再對各 dst `enumeratePaths`)—— 與全對家族其餘函式一致
- 與 §6.2b `allPairsTraffic` 對齊:iterate 全部 router(不排除失效節點),demand 到 / 出失效節點計入 `lostDemand`
- 回傳附 Gbps 帳目(`totalDemand / servedDemand / lostDemand / lostDemandPairs`),供 C3 可達性 banner 重用
- 缺 `demand.js` 時回傳空結果;UI 切換鈕自動 disable 並退回 §6.3 unit 模式

> **UI 對應**:C3 節點樞紐度排行加「過路數 ⇄ 流量加權」切換鈕;`demand` 模式改用本節,
> 分類門檻與 4 階文案沿用 §6.3。**§6.3 = 結構脆弱度(誰是拓樸樞紐)**;
> **§6.3b = 流量熱度(誰實際扛最多 Gbps)** —— 兩者高低不一致處,正是「結構不重要但被流量壓垮」或反之的採購訊號。

---

## §7 ECMP Backup Check

`ecmpBackupCheck` / `ecmpBackupScanAll` — 對每對 (src, dst):

1. 計算 primary,edge-distinct 路徑少於 2 條(`edgePaths.length < 2`)→ `reason: 'no-ecmp'`(`status: n/a`)
2. 收集 `ecmpEdgeIds` = 各路徑第一條邊的 **edge id** 集合;不同的少於 2 個 → `reason: 'single-first-hop'`(`status: n/a`)。連到同一鄰居的兩條平行鏈路算 2 個 first hop。
3. 對每條 `eid ∈ ecmpEdgeIds`,移除後重算;**遇到第一個失敗的成員就返回**(其餘不再評估):
   - 若不可達 → `status: 'failed', reason: 'remove-unreachable', eid`
   - 若新路徑 first-hop 不在 `ecmpEdgeIds \ {eid}` → `status: 'failed', reason: 'backup-non-ecmp', eid, bid`
4. 全部通過 → `status: 'passed'`

`ecmpBackupScanAll(topo)` 以完整拓樸對所有有序 pair 執行,回傳
`[{ src, dst, status, reason?, eid?, bid? }]`。

> **reason 合約**:`reason` 一律為**穩定代碼**(kebab),附帶結構化參數(`eid` / `bid`),
> engine **不吐白話字串**;顯示文字由 UI 透過 i18n key `c6.reason.<code>` 負責(`t('c6.reason.' + r.reason, r)`)。

**語意**:理想的 ECMP 群組,任一成員失效後,流量應由群組內其他成員接手,不應該逃出群組。

---

## §8 Asymmetric Path Detection

`detectAsymmetric` — 對每對 unordered (a, b):

```
fwd = SPT(a → b)
rev = SPT(b → a)
fwdSig = set of stripPseudo(p).join('>')
revSig = set of stripPseudo(p).reverse().join('>')
```

若 `fwd.cost ≠ rev.cost` 或 `fwdSig ≠ revSig`(集合比較)→ 列入非對稱清單。任一方向不可達的
pair 直接略過。回傳 `[{ a, b, fwdCost, revCost, fwdPaths, revPaths }]`(`revPaths` 已反轉)。

---

## §9 Prefix 宣告冗餘 Heatmap

`computeHeatmap(topo, prefixIndex)` — 每台 router 統計 `single-advertised / total`,回傳
`{ notbackuped, total, ratio, prefixes }`;Ratio 映射顏色(門檻寫死在 C8,不在 `THRESHOLDS`):

| Ratio | 顏色 | 語意 |
|-------|------|------|
| 0 | 綠 | 所有 prefix 都有備援宣告 |
| (0, 0.33] | 黃 | 少數 prefix 為單一宣告 |
| (0.33, 0.66] | 橘 | 約一半 prefix 無備援宣告 |
| > 0.66 | 紅 | 多數 prefix 為單一宣告 |

沒有任何 prefix 的 router ratio 為 0,顯示綠色。

---

## §10 N-1 Worst-case Ranking

### §10.1 枚舉

`computeN1WorstCase(topo)`:

```
scenarios =
  { kind:'edge', id, edge } for each p2p edge ∪
  { kind:'node', id }       for each router
```

Transit 邊不算實體失效情境(它是 LSA2 內部抽象)。**SRLG 群組不在 §10 掃描內**:SRLG 群組失效
只在 C5(§6)提供,由 UI 的 `expandSRLG` 把群組展開成邊 / 節點。baseline 為 ∞ 或端點已失效的
pair 會略過。

### §10.2 雙視角累計

對每個 scenario,對全網 (a, b) 重算 SPT,同時累計兩種 stats:

**Per-pair**

```
pairWorst[a>b] = {
  base:      baseline cost (無故障),
  worstCost: 所有 scenario 中最差的 cost,
  culprits:  造成最差結果的 scenario list,
}
```

`culprits` 會收齊**所有**達到最差 cost 的情境 —— 包含每一個讓該 pair 不可達(∞)的單點失效,**不只第一個**。

**Per-failure**

```
failStats[scenario] = {
  unreachable: 此失效造成多少 pair 不可達,
  degraded:    多少 pair 還通但變慢,
  totalDelta:  Σ (此情境的 cost − baseCost),只算變慢的 pair,
  maxRatio:    變慢 pair 的最大 cost / baseCost(從 1 起算;不可達 pair 不會設定它,
               所以永遠不會是 ∞),
  affected:    受影響的 pair,
}
```

回傳 `{ pairRows, failureRows, baseCost }`。`pairRows` 只保留 `worstCost ≠ base` 的 pair;
`failureRows` 只保留 `unreachable > 0` 或 `degraded > 0` 的情境。(已知問題:C9 UI 有一個
`maxRatio === Infinity` 的分支,永遠不會進入。)

### §10.3 排序

- **Pair**:`ratio = worstCost / baseCost` 降序,不可達(∞)優先
- **Failure**:不可達數降序 → `totalDelta` 降序

### §10.4 與 §5.4 (Unbackup) 的關係

| 維度 | §5.4 Unbackup | §10 N-1 |
|------|---------------|---------|
| 焦點 | 單一 (src, dst) pair | 全網所有 pair |
| 失效範圍 | 只試 primary 路徑上的邊 | 所有 p2p edge + 所有 router(不含 SRLG) |
| 判定 | 二元(通 / 不通) | 連續(倍率 + 不可達計數) |
| 用途 | 「這條路徑安全嗎?」 | 「全網最脆弱在哪?」 |

§5.4 是 §10 的一個 binary subset。

---

## §11 視覺狀態機

### §11.1 兩個正交維度

每個 entity 持有兩個獨立狀態:

| 維度 | 來源 | 跨 Tab 行為 | Edge 取值 | Node 取值 |
|------|------|-------------|-----------|-----------|
| **op** | 使用者持久操作(右鍵故障) | 不清除 | `healthy` / `failed` | `up` / `down` |
| **role** | 分析結果的瞬時註記 | 切 Tab 自動清掉 | `none` / `spt` / `backup` / `unbacked` / `load-inc` / `load-dec` / `simulated-fail` / `bc-{hub/normal/rare/idle}` / `traffic-{overflow/high/mid/low/idle}` | `none` / `endpoint` / `highlight` / `asym-mark` / `heat-{green/yellow/orange/red}` / `failed-node` / `bc-{hub/normal/rare/idle}` |

### §11.2 渲染規則

```
op 優先:
  edge.op = failed,或 edge role = simulated-fail
                           → 顯示為 failed (紅色點線、半透明)
  node.op = down           → 顯示為 failed-node
  edge 端點 node.op = down → 派生為 failed (不寫回 edge.op,保持單一資料源)
否則 role 直接映射到對應 CSS class。
```

### §11.3 Facade

`failedEdges` 與 `failedNodes` 是對狀態機的 Set-like 包裝(`has / add / delete / clear / size / iterator`),提供給既有演算法當參數 — 避免演算法層需要知道狀態機細節。

### §11.4 不變式

1. 所有 Cytoscape `addClass / removeClass` 必須走 `setEdgeOp / setEdgeRole / setNodeOp / setNodeRole`,不准直接操作元素 class
2. 切 Tab 時呼叫 `clearAllRoles()` — 只清 role,不動 op
3. 「重置畫面」按鈕(C1)= `C1_Path.reset()` → `clearAllRoles()` + 清空 C1 結果面板;「清除所有故障」= `failedEdges.clear() + failedNodes.clear()`,之後不論目前在哪個分頁都會重畫 C1 路徑;兩者語意分離

---

## §12 UI 分頁矩陣(權威對照表)

`index.html` 共 **10 個分頁**,分三組。下表為 UI 分頁 → 背後 § / 函式的權威對應。切換分頁時,
若模組有定義 `activate` 就呼叫 `TABS[tab].activate()`。C 編號依模組名稱(`C1_Path` … `C10_Edges`);
畫面上設計審計組的順序是 失效模擬、N-1、ECMP、非對稱、Prefix。

### 即時狀態組(吃右鍵故障標記)

| UI 分頁 | UI 編號 | 背後 § / 函式 | 切換時自動執行 |
|---------|---------|----------------|----------------|
| 路徑 | C1 | §4 `dijkstraECMP` + §5.4 `unbackupSegmentScan` | `C1_Path.render(src, dst)` |
| 矩陣 | C2 | §4 per-pair `dijkstraECMP`;四種模式:成本、RTT/SLO(§4.5)、路徑備援 `pairwiseEdgeConnectivity`(§4.5)、頻寬存活 `n1BandwidthSurvivability`(§4.6,以完整拓樸計算) | `C2_Matrix.render()` |
| 樞紐度 | C3 | §6.2 `allPairsLoad`(Edge BC)+ §6.3 `computeNodeBC`(Node BC);節點排行可切 §6.3b `computeNodeTraffic`(流量加權,需 demand.js) | `C3_AllPairs.render()` |
| 鏈路流量 | C4 | §6.2b `allPairsTraffic`(需 demand.js) | `C4_Traffic.render()`(實際負載 / 利用率) |

### 設計審計組(忽略右鍵故障,基於完整拓樸)

| UI 分頁 | UI 編號 | 背後 § / 函式 | 切換時自動執行 |
|---------|---------|----------------|----------------|
| 失效模擬 | C5 | §6 `connectedComponents` + §6.2b / §6.2 的 inline 前後差值;SRLG 經 `expandSRLG` | 無 —— 使用者選元件 / SRLG |
| ECMP | C6 | §7 `ecmpBackupScanAll` | 無 —— `runEcmpCheck` 按鈕 |
| 非對稱 | C7 | §8 `detectAsymmetric` | 無 —— `runAsymScan` 按鈕 |
| Prefix | C8 | §9 `computeHeatmap` | 無 —— `runHeatmap` 按鈕 |
| N-1 | C9 | §10 `computeN1WorstCase`(+ 對排名前幾的故障以 `allPairsTraffic` 算容量超載) | 無 —— `runN1Scan` 按鈕 |

### 編輯組

| UI 分頁 | UI 編號 | 背後 § / 函式 | 切換時自動執行 |
|---------|---------|----------------|----------------|
| 鏈路 | C10 | §1.3 編輯(改成本只重畫標籤;切到即時群組分頁、其 `activate` 執行時才重算路徑 —— C10 期間 `rerenderIfPathActive` 不動作);內含 §15 壅塞最佳化(`optimizeWeights`,需 demand.js) | `C10_Edges.render()` |

> **群組語意**:即時狀態組反映圖上手動標記的故障;設計審計組永遠基於完整拓樸,
> 問的是「設計本身夠不夠韌」而非「現在通不通」。

---

## §13 演算法複雜度

設 `V = router 數`, `E = edge 數`。Dijkstra 採**二元最小堆**(`heapPush/heapPop`,`[dist,seq,node]`,
`seq` tiebreak 使等距彈出序與舊版 stable-sort 一致 → 結果 byte-identical),單次 SPT 為 `O((V + E) log V)`。
**全對計算採單源重用**:`dijkstraSource` 從每個來源一次算到所有目的地,`enumeratePaths` 再逐 dst 展開,
所以「全對」是 **V 次單源**而非 V² 次單對(舊版對每個 (a,b) 重跑來源,白做 V−1 次)。

| 模組 | 單次成本 | 觸發頻率 |
|------|----------|----------|
| §4 SPT (single pair) | O((V+E) log V) | 使用者點按 |
| §6.2 Load / §6.2b Traffic (all pairs) | **V × 單源** = O(V · (V+E) log V) | 切分頁 |
| §4 Matrix(C2) | **V(V−1) × 單源**(每對一次 `dijkstraECMP`;尚未套單源重用) | 切分頁 |
| §6 Failure Sim / Load | 2 × all-pairs | 使用者點按 |
| §7 ECMP Check | O(V² · k · SPT) | 使用者點按,k=ECMP 邊數(尚未套單源重用) |
| §8 Asymmetric | **V × 單源** + V² 展開 | 使用者點按 |
| §10 N-1 | O((V + E) · V × 單源) | 使用者點按(只取 cost,免展開路徑) |
| §4.6 頻寬存活(全 pair) | O(V² · L · (V+E) log V),L = 主路 DAG 邊數(每對重跑 `dijkstraSource`) | C2 模式切換 |
| §15 權重優化 | O(maxEvals × all-pairs)(預算上限) | 使用者點按 |

內建合成樣本屬 POC 小規模(數 router、數十 edge)。二元堆 + 單源重用後,§15 權重優化最壞情境
實測由 ~5.2s 降到 ~1s(約 5×;單次在特定機器與資料集上的實測,非規格值),全對計算 Dijkstra 呼叫數降 ~V 倍。
規模由產生器決定、可放大;一旦進入真實骨幹規模(V 達數十至上百、E 達數百),
仍需 Web Worker 或後端化,並可再上**增量 SPF**(改一條權重只重算受影響路徑,§15.6 列為下一步)。
實際數字隨資料集而變 — 本表給的是**量級關係**,非任何特定 dataset 的固定值。

---

## §14 與原始 OSPF spec 的差異

本 SPEC 對應 Topocide POC `v1.x`(從 Topolograph 命名分支出來後)。主要差異:

- 新增 §6.2b 流量加權邊負載(`allPairsTraffic`)+ C4 邊流量分頁
- 新增 §10 N-1 Worst-case Ranking(單一 p2p 邊 + 單一 router;SRLG 群組失效是 C5 的獨立功能,不在 §10 內)
- 新增 §4.6 C2 頻寬存活矩陣模式(`n1BandwidthSurvivability`;OSPF cost-based ECMP、N-1 最壞單邊存活頻寬、`ceil` 進位、不夾上限可 >100 %)
- §11 視覺狀態機獨立成章(原先散落在 UI handler 各處)
- §12 改為「UI 分頁(C1–C10)→ 背後 §/函式」權威對照;演算法一律以 § 錨定,不再用 C 編號(舊版 engine.js 的 `Cx` 前綴已移除)
- 新增 §6.3b 流量加權節點樞紐度(`computeNodeTraffic`)+ C3 過路數⇄流量加權切換
- 新增 §15 OSPF 權重最佳化(Fortz-Thorup 目標 + Tabu Search),整合於 C10;優化器界以 `COST_CLAMP`(`[5,500]`,engine 匯出單一常數)為上限,避免長鏈路 RTT 下限頂到天花板被 frozen
- 新增 §4.5 矩陣 RTT/SLO 模式(C2 預設 RTT 檢視,依 SLO 目標評分並附覆蓋率 %)
- 新增 OSPF LSDB 匯入路徑:共用純模組 `ospf-import.js` 把 `show ip ospf database router/network` 解析成 §1 schema(填入 `rid`),可產生 `*.imported.js` 資料集(寫到 `../output/`、與 demo 資料並存;未提交到本 repo)—— 原 spec 假設拓樸為手寫靜態檔
- Demand 值從整數改為**浮點 Gbps**（gen.mjs 1 位小數；companions 3 位小數）；profile 擴展為 5 個：`avg` / `max` / `asia_busy` / `amer_busy` / `eu_busy`（companions 現與 gen.mjs 對齊）；RTT CSV 檔名改為 `node_rtt.csv` / `city_rtt.csv`
- `gravity.js`（位於 repo 根目錄；pipeline 腳本仍以 `../output/gravity.js` 匯入）為重力模型常數（D0/K/EMIT/FIBER）、`CITY_GEO`（100+ 城市的 lat/lon/country）與 `haversineKmCity()` 的 SSOT；browser + Node 皆可 import；由 `gen.mjs`、`companions.mjs`、`ospf-import.js`、`edit.html` 共 import（取代 `working/gravity.mjs`）
- `gen.mjs` 不再輸出 `rtt.cityRef`（`city_rtt.csv` 的鏡像，前端從未讀取）；repo 內的 `rtt.js` 早於此變更，重產前仍含此欄位
- `ospf-import.js` 的 `OSPF_CITY` 值從 `{ city, country }` 物件簡化為純城市碼字串；country 由 `gravity.js` 的 `CITY_GEO` 衍生
- `edit.html` 資料編輯器：Equal Earth 投影 LON0 從 140°E 改為 150°E（`layoutGeoMap()` 與 `layoutMetroMap()` 皆適用；ITU/Telegeography 亞太電信業界慣例，縫合線在 −30°W，避免 Fortaleza 跑到錯的一側）；新增**地鐵圖**佈局選項（「八向化」）— Equal Earth 投影 → 格點量化 → Octilinear Nudge → 重疊消解；參數在 `LAYOUT_PARAMS.metro`（`grid`、`nudgeIter`、`angleTol`、`geoAnchor`、`distPow`）；`directions` 8/16/32 選擇器只在 `tools/metro-tune.html`；單次實測約 70–80% 的邊達到八向角
- `metro-tune.html`（現為 `tools/metro-tune.html`）：新獨立互動調參工具，用於調整地鐵圖佈局參數；6 種壓縮模式、邊著色即時預覽（綠=八向/橘=近似/紅=非八向）、方向數選擇器（8/16/32）、顯示控制
- `serve.py`（尚未提交到本 repo）：新開發用 HTTP 伺服器，回傳 `Cache-Control: no-store`；取代 `python -m http.server`（後者有約 1 分鐘的瀏覽器快取延遲）
- **edit.html 資料層架構**：`nodes` / `edges` / `positions` Maps 為 SSOT，cy 僅作渲染器。Inspector 採 mount/patch 模式——切換元素才重建 DOM，同元素只更新欄位值（保留 focus）。`applyField` 先寫 Maps 再同步 cy（`_skipCySync` 旗標防止 cy data 事件回寫 Maps）。edit.html 內部以 per-node 方式持有 `externals`（`node.externals`），匯出時攤平回頂層陣列。localStorage 草稿透過共用的 `draft.js` 模組；跨分頁即時更新則由各頁自行開啟的 `BroadcastChannel('topocide')` 負責（見 §2.1）。
- **規劃中(未實作)**:明確路徑導流 **steer**(Tier 0,把特定流量拉離最短路)+ 頻寬准入 **CAC**(Tier 1,「填滿才溢出 / admission 失敗」)。設計見 `docs/design/steering-cac.md`;實作後整併為新 §。

`engine.js` 的區塊註解(`§4 — SPT` …)與本文 § 編號雙向對應,§15.x 子區塊也依主題標號
(§15.1 目標函數 — `ftLinkPenalty` / `evalCongestion`、§15.2 硬約束 — `buildWeightBounds`、
§15.3 Tabu 驅動、§15.5 函式 — `applyWeights`)。§5.1 / §6.1 / §6.2 / §10.x 沒有 engine 區塊標記。UI 分頁編號另見 §12。

---

## §15 OSPF 權重最佳化(Fortz-Thorup 目標 + Tabu Search)

給定 demand 與 capacity,自動搜尋一組 OSPF 權重以**壓低壅塞**。評估壅塞重用 §6.2b
`allPairsTraffic`(ECMP 等分),故本節是「在既有負載引擎外面包一層搜尋」,不動 SPT/ECMP。

### §15.1 目標函數(字典序雙層)

```
minimize ( MLU , S )
  MLU = max_e u_e            主:最大鏈路利用率 u_e = traffic_e / cap_e
  S   = Σ_e (規模見下)        副:破平台(併列 MLU 解中選總壅塞低者)
```

`S` 隨區間自動切換(`tieBreak='auto'`):

| 區間 | S | 動機 |
|------|---|------|
| 可行(MLU<1) | `Σ u_e²`(均衡) | 主目標已殺尖峰,副目標把其餘負載**抹平** |
| 超載(MLU≥1) | `Σ cap_e · ψ(u_e)`(FT 凸) | 壓不下 100% 時,選**最少鏈路深陷紅區**的最不爛解 |

`ψ` = Fortz-Thorup 分段凸(斜率 1→3→10→70→500→5000,膝點 1/3·2/3·9/10·1·11/10),
cap 加權使大管超載權重更高。比較用 ε-band:MLU 差超過 ε 才主目標定勝負,否則比 S。

**MLU = max 邊利用率**,利用率採 §6.2b 的**較忙方向值**(`max(去,回)/capacity`,單向容量),
計入「所有有容量的邊」(p2p + transit)(選項 A,與 C4 邊流量同一組邊 → 兩視圖定義一致)。
理由:transit 段(共享 LAN 的 Router→Pseudo)的壅塞是真實的,若排除,優化器會壓低 p2p 卻盲於更糟的 LAN
段、**過度宣稱成績**。優化器**預設只動 p2p 權重**(藉 p2p 重繞把 LAN ingress 在多台掛載 router 間重新分配);
亦可選擇**一併調 transit ingress cost**(選項 B,`includeTransit`,見 §15.6)。

> **方向修正的影響**:改用單向峰值後,先前「雙向加總除單向容量」的 ~2× 高估消失。以當時資料集的單次實測
> (非規格值),`max` 情境
> MLU 由 202%(灌水)修正為 **101%**(優化後 70%、**feasible**)—— 原「無解」判定是計數假象,容量其實足夠。
> transit 的 `fwd`/`rev` 已分開(§6.2b),選項 B 的有向資訊**已就緒**,不再是 B 的前置阻擋。

### §15.2 硬約束(剛性剪枝,非計分)

每條 p2p 邊一個整數權重界 `D_e = [lo_e, hi_e]`,Tabu 生成鄰居時只在界內提議:

```
lo_e = max( 5, ⌈rttFloor_e⌉, protected_e ? current : 5 )
hi_e = min( 500, vip_e ? current : 500 )
```

| 紅線 | 效果 | 語意 |
|------|------|------|
| RTT 下限 (`rttFloor`) | `lo ≥ impliedCost(rtt)` | cost 不得低於延遲物理極限 |
| VIP / 大動脈 (`vip`) | `hi = current` | 封死調高 → 維持吸引力,流量不被驅離 |
| 故障多 / 備用 (`protected`) | `lo = current` | 封死調低 → 常態隔離普通流量 |
| 全域 clamp | `COST_CLAMP` 預設 `[5, 500]` | 輸出即 OSPF 正整數,直接配置;上限 500 避免長鏈路 RTT 下限頂到天花板被 frozen |

`lo>hi`(紅線矛盾)→ 夾在 `current` 並標 `conflict`;`lo≥hi` → `frozen`(不進鄰域)。
`vip` / `protected` 為**保留接口**:engine 收 `Set` 參數,來源(policy 檔 / UI 勾選)未定前預設空集,
此時實際生效的僅 RTT 下限 + `COST_CLAMP`(`[5,500]`)。

### §15.3 Tabu Search

| 環節 | 設計 |
|------|------|
| 起點 | `warm`(現網 cost 投影進界,最小擾動)或 `invcap`(`round(maxCap/cap)`) |
| 鄰域 | 單邊移動,候選 `cur±{1,2,4} ∪ {lo,hi}`(`steps` 預設 `[1,2,4]`)夾在 `D_e`;frozen 邊跳過(剪枝) |
| 評估 | 每候選 `applyWeights → evalCongestion`(= 一輪 all-pairs traffic) |
| 選擇 | 最佳非 tabu 鄰居;**aspiration**:tabu 但破全域最佳則解禁 |
| Tabu list | 記反向移動 `(edge,oldW)`,tenure = `tabuTenure` 或 `max(5, round(√movable))` |
| 多樣化 | 連續 `stallK`(預設 8)輪無進步 → 隨機 `divM` 邊重設(seeded PRNG) |
| 終止 | `MLU ≤ target`(預設 0.75)/ 封頂 `maxIters`(預設 300)/ 全域最佳連續 `stopAfter` 輪未改善(預設 `max(15, stallK + 12)`)/ 無可動鄰居 → 回全域最佳 |
| 預算 | `maxEvals`(預設 6000;確定性主限制器,計鄰域評估次數,每輪開始時檢查一次,所以可能多跑最多一個鄰域;多樣化與 `binding` 的評估不計入)封住 runtime;`timeBudgetMs`(預設 15000)僅作脫韁保險(大到正常規模不觸發);`seed` 預設 1 |
| 重現 | `mulberry32(seed)` + `maxEvals`(非 wall-clock)→ 同輸入同輸出 → export 穩定 |

### §15.4 無解處理(一級輸出)

- `MLU ≤ target` → `targetMet`
- `target < MLU < 1` → `feasible` 但未達標
- `MLU ≥ 1` → **約束內無解**:回 `bottleneck`(達 MLU 的邊)與 `binding` —— 逐條把界外放鬆一步重算
  (試算值不超出 `COST_CLAMP`),依 MLU 降幅排「鬆哪條紅線 MLU 降最多」,只回前 5 名,每筆為
  `{ edgeId, dir: 'fwd' | 'rev', relaxTo, mluAfter, gain }`,供人決定鬆綁。

### §15.5 函式(engine.js,純函式)

```
ftLinkPenalty(load, cap)                         → cap·ψ(load/cap)
evalCongestion(topoW, demand, fE, fN)            → { mlu, sumU2, sumPhi, util, lostDemand }
applyWeights(topo, weights)                      → topo 淺拷貝;weights key 為「權重變數」(eid=去/對稱、eid|rev=回),不 mutate
buildWeightBounds(topo, { rttFloor, vip, protectedSet, clamp, includeTransit, asymmetric })
                                                 → Map<varKey,{lo,hi,frozen,conflict,current}>  (varKey = eid / eid|rev)
optimizeWeights(topo, demand, bounds, opts)      → { weights, mlu, sumU2, sumPhi, util, feasible,
                                                     targetMet, target, bottleneck, binding, frozen,
                                                     history, iterations, elapsedMs }
```

### §15.6 已知限制

- **只優化無故障態**:對 N-1(§10)不保證更好;robust TE(對最壞失效優化)為 Roadmap。
- **權重變數**:p2p 邊每方向一個變數 —— 去程 `eid`、回程 `eid|rev`。開回程變數的條件:
  - **預設(`asymmetric:false`)**:僅「資料本來就不對稱」(`costRev != null && != cost`)的邊開回程變數;
    對稱邊單變數(cost=costRev=w),**行為與舊版相同**。
  - **opt-in(`asymmetric:true`,UI「允許不對稱權重」勾選框)**:**全部 p2p 邊**都開回程變數(去/回獨立,
    現值 `costRev ?? cost`),可把對稱邊也優化成不對稱。
  - FT 本是有向問題,對稱只是省算力的約定(見 §14);**對稱 demand 下不對稱無增益**(故現網勾了也採基準)。
    紅線(RTT/VIP/protected)去回共用同組界。
- **transit ingress cost 亦可選調**(選項 B,`buildWeightBounds({ includeTransit:true })`,UI「也調 transit」勾選框):
  只動 `e.cost`(ingress)、不套 RTT 下限、界 `COST_CLAMP`(`[5,500]`);egress(`PN→router`)由 `buildAdjacency` 寫死 0,
  故 B 天生不違反 Type-2 語意。
- **「永不更差」保證(UI 層,一般化)**:C10 一律先跑**基準**(預設配置,`init: 'warm'`);若勾任何進階選項
  (InvCap 起點 / 不對稱 / transit),額外跑**選用配置**,只有其 MLU 嚴格低於基準時才採用
  (`rSel.mlu < rBase.mlu − 1e-9`;只比 MLU,不是字典序 (MLU, S) 目標)。理由:進階選項放大搜尋空間,在固定
  評估預算下可能落進**更差的局部最優**(單 seed 單次實測:transit 73.8% vs 基準 67.2%);此保證確保結果不退步。注:差距為 seed 敏感(multi-start 可追平),
  非選項本質較差。
- **吃 active demand profile**:優化 `avg` 與 `max` 出來的權重不同,維運上通常優化 `max`。
- **權重保護鏈路吸引力,非某條流的路徑**:OSPF 目的地導向 + ECMP 分流,無法硬保證特定流走特定路;
  硬保證需 SR / policy routing,不在本範圍。
- 規模見 §13:每次評估一輪 all-pairs。為保**確定性**,runtime 主限制器用 `maxEvals`(評估次數)而非
  wall-clock;同 seed/同圖 → 同結果,runtime 隨機器變但有界。`timeBudgetMs` 只是脫韁保險,正常 POC 規模不觸發
  (故不破壞確定性);真實骨幹規模請改 Web Worker + 增量 SPF(本版全量重算)。UI 端搜尋為同步,先畫「計算中」再 yield 一個 macrotask 讓 spinner paint。

> **UI 對應**:分頁 **C10 鏈路** 內的「壅塞最佳化」區塊;結果由 `applyOptimize` 寫回 `edge.cost` / `edge.costRev`
> (對稱邊刪掉 `costRev`;接著 `paintEdgeLabels` + `render()` + `rerenderIfPathActive()`,與 `applyEdgeChange`
> 相同的重畫 / 重算步驟,但不呼叫它),再由現成「輸出 topology.js」帶走。優化器 = 繼手動、RTT 之後的**第三個權重來源**。

---

## §16 國際化(i18n)

UI 全面雙語(zh / en),單一字典 + `t()` 查表;`engine.js` 不參與顯示(只吐代碼,見 §7 reason 合約)。

### §16.1 字典與查表

- `index.html` 的 `§0.5 I18N` 定義 `const I18N = { zh: {...}, en: {...} }`,兩語言 key **必須對稱**。
- `t(key, params)`:查 `I18N[LANG][key]`;值為字串直接回傳,為函式則回 `value(params)`;**缺 key 回傳 key 本身**(讓漏譯在畫面上顯眼)。
- 帶變數的字串用函式值:`'c2.failStatus': (p) => \`目前故障:${p.e} 鏈路 / ${p.n} 節點\``。
- 隨語言變動但定義在物件常數裡的標籤(tier `label` / `action`)用 **getter** → `t()`,確保 render 時才解析、切語言即時生效。

### §16.2 靜態 HTML 注入(`applyStaticI18n`)

四種屬性,依注入位置選用:

| 屬性 | 注入 | 用於 |
|------|------|------|
| `data-i18n` | `textContent` | 純文字元素 |
| `data-i18n-html` | `innerHTML` | 含 `<b>` / `<span>` 等標記的文案 |
| `data-i18n-title` | `el.title` | `title` 提示屬性 |
| `data-i18n-optlabel` | `el.label` | `<optgroup>` 標籤 |

HTML 內保留中文當 no-JS fallback;`applyStaticI18n()` 在啟動與切語言時覆寫。含 JS 動態填值的 span(如 C10 公式常數)要在 `render()` 重填,因 `data-i18n-html` 會重建子節點。

### §16.3 動態 render

各 Tab `render()` 一律 `t(key, params)`;分頁切換 / 切語言會重繪,故動態字串隨之更新。
**注意**:render 內若有 `const t = …`(如 `TIERS[tier]`)會遮蔽翻譯 `t()`;該 block 內只讀 `t.label`(經 getter 解析),勿在其中呼叫翻譯 `t()`。

### §16.4 key 命名與去重

- 命名 `<scope>.<sub>`:`common.*`(跨頁共用)、`c1.*`–`c10.*`(各分頁)、`ui.*`(外框)。
- 跨頁完全相同的字串抽 `common.*`(如 `common.auditBanner` / `scanAllPairs` / `recalc` / `status.*` / `tier.*`)。
- 引擎代碼 → 文字用動態組鍵,例如 `t('c6.reason.' + code, row)`(對齊檢查會顯示「定義 > literal 引用」,屬正常)。`c5.optType.*` / `c5.srlgType.*` 則經 literal 對照表取用。

### §16.5 語言狀態與切換

- 預設語言:`localStorage['br-lang']` > 瀏覽器語言(`zh*` → zh,其餘 → en)。
- `setLang(lang)`:存 localStorage + `applyStaticI18n()` + 更新切換鈕標籤 + 重繪當前分頁。
- 左側「控制」面板的 `#langToggle`(`data-action="toggleLang"`)顯示「要切過去的語言」。

### §16.6 不翻譯

- generated 資料的識別碼:節點碼(`TPE\nTW`)、prefix、subnet、`§` / `Cx` 錨點、CSS class、role/op 名。
- 刻意保留的技術英文(部分表頭 Node/Total、Connected/DISCONNECTED 等)。

> **與 engine 的合約**:engine 任何回給 UI 的「原因 / 狀態 / 類別」一律為穩定代碼 + 結構化參數(§7),顯示字串由本 § 的 `t()` 負責;engine 內不得出現面向使用者的白話字串(僅註解可用中文)。
