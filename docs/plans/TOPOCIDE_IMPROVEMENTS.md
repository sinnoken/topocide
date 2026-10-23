# Topocide 改善任務書（給 Claude Code 執行）

> Repo：`sinnoken/topocide`（純前端靜態頁，無 build）
> 執行前先讀 repo 內的 `CLAUDE.md` 與 `docs/SPEC.md`，**其中的鐵則優先於本文件**。
> **任務代號**：演算法與審計任務用 `A1–A6`；`C1–C10` 依 CLAUDE.md「編號慣例」只指 index.html 的 UI 分頁（例如「C2 矩陣」「C5 失效模擬」）。
> 本文件已彙整 2026-10-23 對 repo 的查核結果（見「已完成的清理」與「開工前待人工決定」）。

---

## 一頁總覽：改什麼、得到什麼

| 章 | 改什麼 | 得到什麼 |
|---|---|---|
| 0 前置 | 移除外洩 token；去掉本機路徑；建 golden test + CI | 雲端資料不再對外開放；clone 就能跑；之後任何修改都能立刻知道有沒有改壞計算結果 |
| 1 資料結構 | schema、版本號、驗證器；city/site 分開；平行鏈路可辨識；SRLG 格式明確；資料加英文標籤 | 使用者換自己的資料時知道怎麼填、填錯會被抓到；同城多站點的 RTT 查表正確；失效表能分辨哪條電路 |
| 2 資料處理 | **2.1 計算正確性**：ECMP 改逐跳等分、RTT 缺值不再當 0、邏輯搬回 engine<br>**2.2 審計能力**：N-1 納入流量、容量餘裕、SRLG+1、最佳化納入故障情境<br>**2.3 工具鏈與匯入**：重產 rtt.js、命名統一、匯入轉義<br>**2.4 base 查核發現的 bug**：demand 缺檔崩潰、`PN` 前綴撞號、externals 不同步 | **所有流量數字（C4/C5/MLU/最佳化）符合真實路由器行為；SLO 覆蓋率不再灌水**；N-1 直接回答「哪個故障損失多少 Gbps」；能回答「還能成長多少 %」；最佳化出來的權重斷線時不會更糟；文件與 repo 對得上；貼 LSDB 不會壞頁面 |
| 3 UI 與操作 | 修面板切掉 bug；分頁、說明、圖、結果表、文案、過期提示、編輯器工具列 | 後段分頁能用；結果表能直接拿去討論；英文介面可給國外同事看；改了輸入不會誤看舊結果 |
| 4 收尾 | README、截圖、Pages、範例 LSDB | 別人搜得到、點開就能試、不用真實設備也能體驗匯入 |

**最有價值的兩個任務：A1**（ECMP 分流模型與真實路由器不同，影響所有流量數字；SPEC §6.2b 刻意採用逐路徑模型，屬模型變更，要先量化差距）和 **P1**（RTT 缺值當成 0，影響 SLO 覆蓋率）。

---

## 執行順序總表

依序執行。「依賴」欄表示必須先完成的任務。每個 session 約 5 小時；主線做完才做加碼。

| # | 任務 | 章 | 預估 | 依賴 | Session |
|---|---|---|---|---|---|
| 1 | 0.1 移除 R2 token | 0 | 40 分 | — | **S1** |
| 2 | 0.2 clone 就能跑 | 0 | 35 分 | — | S1 |
| 3 | 0.3 Golden test + CI | 0 | 70 分 | 0.2 | S1 |
| 4 | D1 Schema 規格化 | 1 | 45 分 | — | S1 |
| 5 | D2 驗證器 | 1 | 40 分 | D1 | S1 |
| 6 | D3 city / site 分開 | 1 | 35 分 | D2 | S1 |
| 7 | D4 平行鏈路明確化 | 1 | 20 分 | D1 | S1 |
| | *S1 小計* | | *4 小時 45 分* | | |
| 8 | D5 SRLG affects 明確化 | 1 | 20 分 | D1 | **S2** |
| 9 | D6 顯示文字與資料分離 | 1 | 25 分 | D1 | S2 |
| 10 | A1 ECMP 逐跳等分 | 2.1 | 90 分 | 0.3 | S2 |
| 11 | P2 邏輯搬回 engine | 2.1 | 50 分 | D5 | S2 |
| 12 | P1 RTT 缺值不當 0 | 2.1 | 40 分 | D3, P2 | S2 |
| 13 | A2 N-1 流量感知 | 2.2 | 60 分 | A1, P2, D5 | S2 |
| | *S2 小計* | | *4 小時 45 分* | | |
| 14 | A3 容量餘裕 | 2.2 | 40 分 | A2 | **S3** |
| 15 | A5 SRLG + 1 | 2.2 | 45 分 | A1, D5, P2 | S3 |
| 16 | A4 最佳化納入故障 | 2.2 | 90 分 | A2 | S3 |
| 17 | P3 重產 rtt.js | 2.3 | 30 分 | D3 | S3 |
| 18 | P4 工具鏈與命名統一 | 2.3 | 40 分 | — | S3 |
| 19 | P5 匯入清理與轉義 | 2.3 | 50 分 | D2 | S3 |
| | *S3 小計* | | *4 小時 55 分* | | |
| 20 | U1 面板切掉 bug | 3 | 30 分 | — | **S4** |
| 21 | U2 分頁列 | 3 | 30 分 | U1 | S4 |
| 22 | U3 說明收合 | 3 | 35 分 | — | S4 |
| 23 | U4 拓樸圖 | 3 | 35 分 | — | S4 |
| 24 | U5 失效模擬結果表 | 3 | 25 分 | D4 | S4 |
| 25 | U6 文案與 i18n | 3 | 30 分 | D6 | S4 |
| 26 | U7 計算觸發與過期提示 | 3 | 45 分 | — | S4 |
| 27 | U8 edit.html 工具列 | 3 | 40 分 | D2 | S4 |
| 28 | U9 矩陣表頭固定 | 3 | 20 分 | — | S4 |
| | *S4 小計* | | *4 小時 50 分* | | |
| 29 | B1 demand.js 缺檔不崩潰 | 2.4 | 15 分 | — | **S5** |
| 30 | B2 pseudo-node 判斷不靠 `PN` 前綴 | 2.4 | 30 分 | 0.3 | S5 |
| 31 | B3 externals 同步到 index | 2.4 | 40 分 | — | S5 |
| 32 | B4 兩項行為確認（清除故障、C2 頻寬存活） | 2.4 | 20 分 | — | S5 |
| 33 | B5 雲端同步失敗仍顯示成功 | 2.4 | 10 分 | 0.1 | S5 |
| 34 | B6 edit.html 匯入對話框與「載入全部」 | 2.4 | 40 分 | — | S5 |
| 35 | B7 metro-tune 與 edit.html 不一致 | 2.4 | 45 分 | — | S5 |
| 36 | P6 Worker 強化文件（自 S3 移入，S3 原本超過 5 小時） | 2.3 | 20 分 | — | S5 |
| 37 | F1 README | 4 | 30 分 | 全部 | S5 |
| 38 | F2 GitHub Pages | 4 | 10 分 | — | S5 |
| | *S5 小計（主線）* | | *4 小時 20 分* | | |
| 加碼 | D7 座標分離評估、A6 LFA 覆蓋率、P7 Web Worker、U10 edit i18n、U11 無障礙、F3 範例 LSDB、F4 SRI | | 約 5 小時 | | S5 |

---

## 執行規則（所有章節通用）

1. **每個任務各開一個 commit**，訊息用英文祈使句，不要再用 "Add files via upload"。
2. **不要手改 generated 檔**（`topology.js` / `demand.js` / `srlg.js` / `rtt.js`），見 CLAUDE.md 鐵則 #1。要改內容就改產生器（`pipeline/gen.mjs`）後重新產生；`topology.js` 屬於 edit.html 人工策展路徑，改它要透過遷移腳本，不要用 gen 覆蓋。
3. **資料格式一律向下相容**：使用者手上可能有舊格式的 `topology.js`。新增欄位是 optional；改名或改結構時，讀取端要同時接受新舊格式，並集中在一個 `normalize*()` 函式處理。
4. **每個任務都跑 `npm test`**（0.3 建立）。結果**刻意**改變時，用 `UPDATE_SNAPSHOT=1` 更新快照，並在 commit 訊息寫明哪些數值改變、為什麼改變。
5. **新增的 UI 字串一律寫進 I18N 字典**（zh/en 兩種語言都要補）。engine 只回傳代碼，不回傳顯示用的字串（CLAUDE.md 鐵則 #5）。
6. **資料格式或 SPEC 描述的行為有任何改動，`docs/SPEC.md` 和 `docs/SPEC.zh.md` 要同步更新**；README 同理（中英兩份）。
7. 任務超過預估時間的 1.5 倍就先停下，記錄卡住的地方，再換下一個任務。
8. 遇到需要人工決定、或碰外部服務的事（Cloudflare 後台、GitHub 設定、改寫 git 歷史），**不要自己猜，列進「待人工處理」清單**。
9. 驗收用的 `git grep` 一律排除本任務書：`git grep -n "<pattern>" -- ':!docs/plans/'`（本文件引用了那些字串，不排除就永遠不會通過）。

---

## 已完成的清理（2026-10-23，不影響功能）

- 文件搬進 `docs/`（`SPEC*.md`、`design/`、`plans/`）；`UNIFIED_STATE_SYNC.md` 併入 `docs/SPEC.md §2.1` 並修正兩處不實（draft 未分 topo、index 沒有 remote 載入）。
- 設計草案改名：`C10-next.md` → `docs/design/optimizer-v2.md`、`steer.md` → `docs/design/steering-cac.md`，標題與「狀態：設計草案」開頭統一；README roadmap 連到這兩份。
- 非主程式歸位：`gen/` → `pipeline/`；`metro-tune.html` → `tools/`；與本專案無關的相機景深計算器 → `misc/dof-calculator.html`。
- 註解與標題的舊名：`working/` → `pipeline/`、BlastRadius → Topocide（不含 draft key、Worker URL、generated 檔頭）、`gravity.mjs` → `gravity.js`、`gen.py` → `gen.mjs`、edit.html 匯出檔頭 `edit2.html` → `edit.html`。
- engine.js 的 `§16 PATH DIVERSITY` / `§17 N-1 BANDWIDTH` 與 SPEC §16（i18n）撞號 → 改為 SPEC 實際記載處 `§4.5` / `§4.6`。
- 補回 `.gitignore`（歷史上的 `gitignore` 少一個點，從未生效）。
- **UI 文字對照程式**：index.html 修正 14 處說明文字（中英同步，含靜態 fallback），刪除 5 個沒用到的字典 key；edit.html、tools/metro-tune.html、`ospf-import.js` 修正與程式不符的 tooltip / 訊息 / 圖例；需要改程式行為的列為 B5–B7、U6、U8。
- **SPEC / README / CLAUDE.md 全面對照程式碼**（以程式為準）：SPEC 約 70 條描述改成實際行為（中英同步）；README 修正 C2 模式、互動、依賴、分頁執行方式；CLAUDE.md 修正檔案結構（index 需 10 檔）、draft.js、依賴方向、`activate` 可選、Graceful Degradation 與 `PN` 前綴現況；engine.js 的 §15 子區塊與 §4.6 註解對齊 SPEC。屬於程式 bug 的列為 B1–B4。
- CLAUDE.md、README 修正與現況不符的敘述（cityRef、SCALE 數字、byte-identical、缺檔標註、執行步驟、Limitations）。

---

## Base：repo 實際狀態（2026-10-23 實跑）

> 任務書與 SPEC 一律以這份實跑結果為準（CLAUDE.md 原則：以程式為準）。重現方式：在 scratchpad 以 `vm` 載入 `topology.js` / `srlg.js`、`require` 載入 `demand.js` / `rtt.js`，直接 import 根目錄 `engine.js` 執行。

- **語法**：根目錄全部 `.js`、`pipeline/*.mjs`、三個頁面的 inline script 都通過 `node --check`。
- **engine 以 demo 資料實跑全部正常**：
  - `allPairsTraffic` 回傳 `traffic / trafficFwd / trafficRev / totalPairs / reachablePairs / lostPairs / totalDemand / servedDemand / lostDemand / lostDemandPairs`。
  - `evalCongestion` 的 MLU = 0.668（含 transit 邊）。
  - `ecmpBackupScanAll`：`n/a` 1783、`passed` 197、`failed` 0。
  - `computeN1WorstCase`：95 個故障情境，最嚴重是 TPE 節點故障。
  - `optimizeWeights`：預設 target 0.75 已達成會直接返回；target 0.5 → 0.48，同 seed 結果相同。
- **`pipeline/` 五支工具在 repo 內都跑不起來**（`ERR_MODULE_NOT_FOUND`，`../output/` 不存在）。模擬 `output → repo 根目錄` 後：
  - `verify.mjs`：avg profile 沒有 p2p 超載，最忙 `e_SIN_BOM` 48%；max profile 53 / 81 條超載，最忙 652%。這裡只算 p2p，與 `evalCongestion` 含 transit 的口徑不同。
  - `verify_ecmp.mjs`：與 engine 實跑一致。
  - `gen.mjs`：缺兩個 RTT CSV，所以 `measured=0`；產出的是另一份更大的合成拓樸，`topology / demand / rtt.js` 都與 repo 不同，只有 `srlg.js` byte-identical。**repo 的 demo 資料不是現行 gen.mjs 的產物**，重產等於換掉整組資料。
- **SPEC 對照**：三段逐條比對程式後，SPEC 約 70 條描述與程式不符，已依程式修正（`docs/SPEC.md` / `.zh.md`）。其中屬於程式 bug 的列為 B1–B4。

---

## 開工前待人工決定（決定前不要動相關任務）

1. **repo 結構**（影響 0.2、P4）：CLAUDE.md 描述的是作者本機 `/mnt/workspace/{output,working,input}` 工作區，`pipeline/*.mjs` 的 `../output/` 匯入在那裡是對的；GitHub repo 只放了其中一部分。要不要讓 repo 自成一體（改匯入路徑、CLAUDE.md 鐵則 #3），由 repo 主人決定。
2. **repo 缺少的檔案**：`serve.py`、`pipeline/node_rtt.csv`、`pipeline/city_rtt.csv`、`pipeline/rid_hostname.csv`、`input/Cisco OSPF.txt`、`*.imported.js`、`worker.js` 都從未 commit。真實量測與 LSDB 可能不宜公開；缺 CSV 時 gen 會退回 geo 模型（`measured=0`，CLAUDE.md 視為耦合斷裂），所以 **P3 與任何重產都要等 CSV 到位**。
3. **demo 四檔與 `gen.mjs` 的對應關係**（影響 D3、D5、D6、P3）：`gen.mjs` 每次執行都會覆寫 `topology.js`，但現有 `topology.js` 是 edit.html 匯出的人工策展版；`gen.mjs` 預設產生的是它自己的合成拓樸，產出的 demand / srlg / rtt 的 key 不一定對得上。先決定重產策略（`--out` 到暫存目錄、只採用部分檔案，或替 `gen.mjs` 加 `--topology <path>`）。**未決定前，任何重產都不得覆寫根目錄的 `topology.js`**（鐵則 #1：兩條路徑不可混用）。
4. **Playwright 的使用方式**（影響第 3、4 章截圖）：devDependency 或只用 `npx`；兩者都不算 runtime 依賴，但要寫進 `package.json` 或 README。

---

# 第 0 章：前置（約 2 小時 25 分）

> 放最前面的原因：0.1 是公開外洩的 token，必須立刻處理；0.3 的 golden test 是後面所有章節的安全網，沒有它就分不出「刻意改變」和「意外弄壞」。

### 0.1 移除寫死的 R2 token（40 分）

**現況**：`edit.html` 約第 1691–1702 行寫死了 `REMOTE_URL` 和 `REMOTE_TOKEN`，並以 `X-Token` 送給 CF Worker。repo 是公開的，任何人都能讀寫這個 R2。

**做法**：
- 刪除 `REMOTE_TOKEN`。新增「雲端同步設定」入口，讓使用者輸入 Worker URL 與 Token，存在 localStorage（key：`topocide-remote`，讀寫包 try/catch）。
- 沒有設定時，同步按鈕 disabled 並顯示提示，**其他功能照常運作**。
- 新字串進 I18N。

- `index.html` L42 有一行註解引用 `REMOTE_URL`，一併清掉。

**驗收**：`git grep -n "7d1314" -- ':!docs/plans/'` 搜不到結果；沒有設定時，edit.html 不會報錯；設定之後，同步行為跟改之前一樣。

> ⚠️ 待人工處理：**到 Cloudflare 作廢並更換舊 token**（舊 token 還留在 git 歷史裡）。是否改寫 git 歷史由 repo 主人決定，**不要 force push**。

### 0.2 讓 repo clone 下來就能跑（35 分；需先完成「待人工決定」第 1、2 點）

> 這不是修 bug：`../output/` 與 `/mnt/workspace` 在作者本機工作區是正確的。本任務是「讓 repo 自成一體」，有外部使用者才需要。

- 新增 `serve.py`：只用標準函式庫，加上 `Cache-Control: no-store`，port 預設 8000，可用參數覆寫。
- 消除寫死的絕對路徑：`pipeline/gen.mjs` 第 25 行的 `--out` 預設值、`pipeline/verify_ecmp.mjs` 第 4、8 行、`pipeline/verify.mjs` 的 `OUT`。一律改成用 `import.meta.url` 計算的相對路徑，並保留 CLI 覆寫參數。
- **修正 repo 中不存在的 `output/` 目錄**（clone 後 pipeline 工具跑不動的主因）：`pipeline/*.mjs` 都從 `'../output/engine.js'`、`'../output/gravity.js'`、`'../output/ospf-import.js'` 匯入，`pipeline/verify.mjs` L24 的 `OUT` 指向 `../output`，`pipeline/companions.mjs` 與 `pipeline/ospf_to_topology.mjs` 也寫到 `../output/*.imported.js`；但 repo 沒有 `output/`，檔案都在根目錄。一律改成指向 repo 根目錄（`new URL('../engine.js', import.meta.url)` 等）。
- CLAUDE.md 鐵則 #3 已改為「在 repo 根目錄確認成品」並保留本機工作區對照；本任務完成後刪掉 `/mnt/workspace` 的說明，鐵則 #4 的「pipeline 只能在本機結構執行」註記也一併移除。
- `pipeline/ospf_to_topology.mjs` 讀的是 repo 裡不存在的 `../input/Cisco OSPF.txt`：改成用 CLI 參數傳入路徑；檔案不存在時印出 usage 並 exit 1。
- 新增 `package.json`：`private`、`type: module`、`engines.node >= 20`；scripts 包含 `serve`、`gen`、`verify`、`test`、`validate`（D2 用）。**不要加任何 runtime dependency**。

**驗收**：`git grep -n "/mnt/workspace" -- ':!docs/plans/'` 與 `git grep -n "\.\./output/" -- pipeline/` 都搜不到結果；`node pipeline/gen.mjs --out <暫存目錄>` 可執行；從乾淨的 clone 執行 `npm run serve`，`index.html`、`edit.html`、`tools/metro-tune.html` 三個頁面都能開啟，console 沒有 404。

### 0.3 Golden-master 測試與 CI（70 分）

- 新增 `test/engine.golden.test.mjs`（使用 `node:test`）：
  - 載入方式沿用 `pipeline/verify.mjs` 的策略（`topology` / `srlg` 用 `vm` 執行，`demand` / `rtt` 用 require）。
  - 對 demo 資料執行以下函式，序列化（key 排序、浮點數四捨五入到 1e-9）後與 `test/__snapshots__/engine.json` 比對：`allPairsTraffic`、`computeN1WorstCase`、`ecmpBackupScanAll`、`detectAsymmetric`、`evalCongestion`、`optimizeWeights`（固定 seed、調小 `maxEvals`）、`n1BandwidthSurvivability`。
  - 環境變數 `UPDATE_SNAPSHOT=1` 時改寫快照。
- 加上手工小型拓樸的單元測試（三角形、ECMP 菱形、平行鏈路），並驗證 `applyWeights` 不會修改輸入。
- 新增 `.github/workflows/ci.yml`：在 push 與 PR 時觸發，Node 20，執行 `npm test`。
- 更新 CLAUDE.md 鐵則 #4：把「目視比對」改成「執行 `npm test`」。
- **快照基準取 engine 直接跑 repo demo 資料**（見「Base」），不要依賴 `pipeline/gen.mjs`：gen 產出的是另一份資料集。`optimizeWeights` 要指定 `target`（例如 0.5），否則預設 0.75 已達成會直接返回，快照測不到搜尋行為。

**驗收**：`npm test` 通過；故意修改 `COST_CLAMP` 時，測試會失敗。

---

# 第 1 章：資料結構（約 3 小時）

> 以下問題是用腳本實際檢查 demo 資料得到的。目前四個資料檔都是 JS 全域常數：`topology` / `srlg` 沒有 export，`demand` / `rtt` 有 export，讀取方式不一致；檔案中也沒有版本號，單位只寫在註解裡。

### D1 Schema 規格化（45 分）

- 新增 `schema/` 目錄，為四個資料檔各寫一份 JSON Schema（draft 2020-12）。內容依 SPEC 和實際資料整理。目前實際存在的欄位：
  - node：`id, label, country, city, type, area, stubs, isASBR, isABR, subnet`
  - edge：`id, source, target, cost, costRev?, capacity, type`
  - topology 頂層：`nodes, edges, externals, positions`
- 每個資料檔加上 `schemaVersion: 1`（讀取端沒有這個欄位時，視為 v0 並正常讀取）。
- **單位寫進資料**：`capacity` 的單位 Gbps 目前只寫在 SPEC 註解裡。在 topology 頂層加入 `units: { capacity: 'Gbps' }`（optional，預設 Gbps）。demand 和 rtt 已經有 `unit` 欄位，命名要跟著統一。
- schema 註解中預留 `area` 未來可能移到 edge 或介面層級的空間（多 area 不在這次範圍）。
- SPEC 的資料模型章節改成引用這些 schema。

**驗收**：四份 schema 都存在；demo 資料可以通過 D2 的驗證。

### D2 資料完整性驗證器（40 分）

新增 `pipeline/validate.mjs`（`npm run validate`）。現行 edit.html 的 `validate()` 以**相鄰節點數**判斷（L1662），兩條平行鏈路接同一鄰居會被標成單點，且「≥2 個鄰居」不等於有備援路徑（橋接鏈路會漏）；新驗證器改用 edge connectivity 判斷。純函式，同時給 Node CLI 和 edit.html 的「✔ 驗證」按鈕（約第 1646 行）共用：
- schema 驗證（自己寫輕量的檢查即可，**不要引入 ajv 等 runtime 依賴**）。
- 參照完整性：edge 的 source/target 必須存在；SRLG `affects` 中的每個 id 都必須存在；demand 矩陣的 key 必須是 router id；rtt.edges 的 a/b 必須是已知節點或城市。
- 語意檢查（警告，不視為錯誤）：`city` 是空字串（目前 PEK 就是）；router 沒有任何 stub；`capacity` ≤ 0；`costRev` 與 `cost` 相差過大；demand 對角線不為 0；某條 p2p 鏈路找不到任何 RTT 來源。
- 輸出格式：`{ errors: [{code, path, params}], warnings: [...] }`，只回傳代碼（文字由 UI 透過 I18N 產生）。

**驗收**：demo 資料執行時回報 PEK 的 city 是空值；手動製造一條懸空的 SRLG 參照時會被抓到。

### D3 修正 `city` 欄位的語意（35 分）

**現況**：demo 拓樸中不重複的 city 數幾乎等於節點數，因為 `city` 實際上被填成 node id（`TPE2.city = "TPE2"`、`HKG3.city = "HKG3"`）；PEK 的 city 是空字串。可是 RTT 用 `rtt.matrix[city][city]` 查詢，等於把**都會區**和**站點**混成同一個概念。

**做法**：
- 明確定義：`city` = 都會區代碼（TPE2 → `TPE`、HKG3 → `HKG`、LHR2 → `LHR`）；新增 optional 的 `site` 欄位，代表機房或 PoP。
- 改 `pipeline/gen.mjs` 後重新產生資料（依「開工前待人工決定」第 3 點的策略，**不得覆寫策展版 `topology.js`**）；人工策展的 `topology.js` 用一次性遷移腳本 `pipeline/migrate-v1.mjs` 處理（腳本要提交進 repo）。修正 PEK 的空值。
- 遷移腳本不屬於鐵則 #1 的兩條合法路徑，要在 CLAUDE.md 鐵則 #1 補登「一次性 schema 遷移腳本」為例外，並寫明它只能做結構轉換、不改數值。
- normalize 函式：遇到舊資料的 `city` 看起來是 id 時，輸出 warning，但不自動修改。
- 這個任務**會刻意改變**同城 RTT 的計算結果，要更新快照並在 commit 說明。

### D4 平行鏈路明確化（20 分）

**現況**：平行鏈路用 `_b` 後綴區分（`e_TPE_TYO` / `e_TPE_TYO_b`，共 7 組）。UI 上兩條都只顯示成「TPE ↔ TYO」。

**做法**：edge 新增 optional 欄位 `circuit`（給人看的電路名稱，例如 `"APCN-2 #1"`）。engine 新增 `edgeDisplayKey(edge, allEdges)`，只回傳結構化資料 `{a, b, parallelIndex, parallelCount, circuit}`，不組字串；UI 顯示在 U5 處理。

### D5 SRLG `affects` 明確化（20 分）

**現況**：`affects` 裡混放 edge id 和 node id，執行期由 index.html 的 `expandSRLG()` 去猜。

**做法**：新格式 `affects: { edges: [...], nodes: [...] }`，讀取端仍接受舊的陣列格式（由 normalize 轉換）。新增 optional 欄位 `label_en`。`gen.mjs` 改成輸出新格式。

### D6 顯示用文字與資料分離（25 分）

**現況**：node 的 `label: "TPE\nTW"` 就是 `id + "\n" + country`，是存在資料裡的顯示格式；demand profile 的 `label: '月均'`、SRLG 的 `label: 'APCN-2 海纜'` 都只有中文。

**做法**：node 的 `label` 改成 optional（沒填時由 UI 依 `id` 和 `country` 組出；有填時優先使用）。demand profile 和 SRLG 加上 optional 的 `label_en`，UI 依語言選擇，缺少時退回 `label`。更新 gen.mjs 與 schema。

### D7（加碼，30 分）版面座標與網路模型分離

`positions` 是 Cytoscape 用的座標，屬於呈現層，卻存在 topology 裡。**只產出評估**，寫在 `docs/adr-001-layout.md`，不直接修改。

---

# 第 2 章：資料處理（約 12 小時 15 分）

## 2.1 計算正確性（約 3 小時）

> 這一節是整份文件中最重要的部分。A1 是模型變更（現行逐路徑等分是 SPEC §6.2b 的刻意設計，但與路由器行為不同），P1 是確認的 bug。
> 每一項都會刻意改變快照，commit 訊息要附上改前改後的關鍵數字。

### A1 ECMP 分流改成逐跳等分（模型變更，90 分）

**現況**：`allPairsTraffic`（engine.js L298）把 demand 平分到「每條 edge-distinct 的端到端路徑」（L336 `w = gbps / r.edgePaths.length`）。真實路由器的 ECMP 是**每一跳**對下一跳等分，兩者在等價路徑不對稱分岔時結果不同。

**驗證**（可重現，附檔 `evidence-ecmp-tiny.mjs`）：
```
S→A→T 一條；S→B→T 但 B–T 有兩條平行鏈路；demand S→T = 90
engine 現在：S–A 30、S–B 60、A–T 30、B–T#1 30、B–T#2 30
真實 OSPF： S–A 45、S–B 45、A–T 45、B–T#1 22.5、B–T#2 22.5
```
demo 資料用逐跳模型重算後，SIN–BOM 的利用率差約 38 個百分點（初步比對，要再驗；base 實跑現行模型 avg profile 下 SIN–BOM 為 48%）。**先量化**：在 demo 資料上列出兩種模型差異超過 5 個百分點的鏈路數與最大差距，再決定是否改預設。

**影響範圍**：C4 鏈路流量、C5 失效模擬、MLU、`evalCongestion`、`optimizeWeights` 的目標函數。也就是所有流量相關的審計輸出。

**做法**：
- 在 `dijkstraSource` 的 `preds` 基礎上，對每個 (src, dst) 建 SPT DAG，從 src 依 dist 順序往下推流量，每個節點把進來的流量平分給它在 DAG 上的後繼邊（平行鏈路各算一條後繼）。
- 這比現在的「枚舉所有路徑」更快（枚舉路徑在 ECMP 多的圖上是指數成長）。
- 節點介數（`computeNodeBC`）**不改**：SPEC §6.3 刻意讓平行鏈路合併成一條路徑、不灌水節點介數，逐跳 DAG 會違反這個語意。
- 保留 `splitMode: 'per-hop' | 'per-path'` 選項，預設 per-hop，方便回歸比對；SPEC §6.2b 更新定義（中英兩版），依 CLAUDE.md 鐵則 #4 做「刻意改變結果」的行為驗證。
- 只改流量分配，**不要移除 `edgePaths`**：`ecmpBackupScanAll`（engine.js L452 `edgePaths.length < 2`）等函式仍需要路徑枚舉。
- 測試：上面的 5 邊小圖、菱形圖、含 pseudo-node 的圖。

### P2 把業務邏輯從 index.html 移到 engine.js（50 分）

**現況**：`expandSRLG()`（index.html 約 L1692）和每條鏈路的 RTT 解析（約 L1887 與 L2989，**兩處各寫了一份**）都放在 UI 檔案裡，違反 CLAUDE.md 的 SoC 原則，也測試不到。

**做法**：
- engine.js 新增並匯出純函式：`expandSRLG(group, topo)`（吃 D5 的新格式）、`resolveEdgeRtt(edge, topo, rtt)` 回傳 `{ms, src: 'measured'|'city-ref'|'model'|null}`、`pathRtt(path, ...)`。
- 優先順序只定義在一個地方：人工指定 > 實測 > 城市參考 > 模型（CLAUDE.md「資料工具鏈」）。`rtt.edges` 每筆已帶 `src`（`measured` / `city-ref` / `model`），由產生器解析；`rtt.cityRef` 陣列不是 RTT 來源，前端不讀。
- index.html 的兩處 RTT 解析都改成呼叫這些函式。補上單元測試。

### P1 RTT 缺值被當成 0（bug，40 分）

**現況**：RTT 解析在找不到 RTT 時回傳 0（註解「同城/缺 → 0」）。transit 鏈路（如 `e_TPE_PN_AS`）都沒有 RTT，所以經過 pseudo-node 的路徑 RTT 會被少算。C2 矩陣中 **TPE→SIN 顯示 0.0 ms**（`rtt.edges` 其實有 TPE–SIN 32.9 ms），SLO 覆蓋率（目前 70%）因此被灌水。

**做法**：
- 缺值改成回傳 `null`。路徑上只要有一段是 `null`，整條路徑的 RTT 就是「未知」，矩陣中顯示「?」並用獨立顏色；SLO 覆蓋率的分母排除這些路徑，另外顯示「未知 N 對」。現行分母也把**不可達**的 pair 算進去、當成超標（`index.html` L1990/L2039），一併決定是否分開顯示。
- 經過 pseudo-node 時：`A → PN → B` 的 RTT 用 `rtt(A,B)` 計算（pseudo-node 本身不增加延遲），規則寫進 SPEC。
- 同城 RTT 不應該是 0：從資料取得，或使用具名常數（例如 0.5 ms）。常數放在 engine.js 並 export，或由呼叫端當參數傳入；**不能放 index.html 的 `LIMITS`**（engine 不可反向依賴 UI）。
- 更新快照時，commit 中列出覆蓋率修正前後的數字。

## 2.2 審計能力（約 3 小時 55 分）

### A2 N-1 改成流量感知（60 分）

**現況**：`computeN1WorstCase`（L549）只比較失效後的最短路徑 cost 倍率和可達性，沒有用 demand 和容量。C9 分頁（`index.html` L2865–2881）已對排名前 `LIMITS.topFailures` 名的故障呼叫 `allPairsTraffic` 算超載鏈路**數**，但：邏輯寫在 UI 層（違反 SoC）、只算數量不算 Gbps / lostDemand、排名不看流量。本任務是把這段搬進 engine 再擴充。

**做法**：
- 對每個情境（每條 p2p 鏈路、每台 router、每個 SRLG）呼叫 `allPairsTraffic(topo, demand, failed…)`，記錄：失效後 MLU、超載鏈路數與超載 Gbps、lostDemand、最差的鏈路 id。
- `failureRows` 多幾個欄位；UI 的 N-1 表格增加「MLU 後」「超載 Gbps」「損失 Gbps」欄，可排序。排名預設改成：lostDemand → 超載 Gbps → cost 倍率。
- 計算量約 (E + V + |SRLG|) 次 allPairsTraffic；base 實跑單次約 5 ms，demo 規模約 1 秒內。
- 現行 `computeN1WorstCase` **不含 SRLG**（`engine.js` L565–572 只列單條 p2p 與單台 router，SRLG 只在 C5），本任務加入。
- 順手修：`maxRatio` 從 1 起算、只計有限值，UI 的 `f.maxRatio === Infinity` 分支（`index.html` L2907）永遠不會進入。

### A3 容量餘裕（成長係數）（40 分）

**缺口**：工具能算 MLU，但不能回答「流量成長多少 % 會開始爆」。

**做法**：
- 新增 `headroom(topo, demand, {failedEdges, failedNodes, target = 1.0})`：找出 MLU 剛好達到 target 的 demand 係數 k（MLU 與 k 成線性，但要處理 lostDemand 和 0 容量的情況，用二分搜尋的通用寫法）。
- 輸出兩個數字：正常狀態的 k、最差 N-1 情境下的 k（用 A2 的結果取最差）。
- UI：放在 C4 鏈路流量的摘要卡（「可承受成長 +37%；最壞單點故障下 +4%」）。

### A5 SRLG + 1 雙重故障（45 分）

**現況**：SPEC §4.6 標明 no N-2。但「海纜斷了之後再斷任何一條」是海纜網路的標準審計情境。

**做法**：
- 新增 `srlgPlusOne(topo, demand, srlgGroup)`：先套用 SRLG 失效，再逐一加斷每條其餘的 p2p 鏈路，對每一組算可達性與 lostDemand。計算量 |E| 次，每個 SRLG 可獨立執行。
- UI：在 C5 失效模擬的結果下方加「再斷一條會怎樣」區塊，列出最危險的前 10 條。
- 全組合的 N-2（E² 級）不做。

### A4 最佳化納入故障情境（90 分）

> **設計來源：`docs/design/optimizer-v2.md` §2.3–2.6**（失效集挑選、只在 incumbent 驗 N-1 Gate、增量流量、評估器簽章）。依該文件實作，下方只列本任務書獨有的驗收；兩者衝突時以 optimizer-v2 為準，完成後更新 SPEC §15。

**現況**：`optimizeWeights`（L787）只在無故障拓樸上評估 Fortz-Thorup 目標。找到的權重正常時 MLU 漂亮，斷一條線可能比原本更糟。README roadmap 的「N-1 survivability gate」就是這一項。

**做法**：
- 失效集與 Gate 依 optimizer-v2 §2.3–2.4（K 預設 5，可調；A2 完成後可改用流量感知排名挑選）。
- UI 顯示「正常 MLU / 最壞情境 MLU」改前改後各一組。
- 保留只評估正常狀態的選項作為快速模式。

### A6（加碼，判斷，90 分）LFA / IP-FRR 覆蓋率

OSPF 收斂前的黑洞時間取決於有沒有 loop-free alternate（RFC 5286）。對每個 router 的每個目的地與主要下一跳，檢查是否存在鄰居 N 滿足 `dist(N, dst) < dist(N, S) + dist(S, dst)`。輸出每台 router 的 LFA 覆蓋率，並標出沒有保護的 (router, dst)。先在 `docs/` 寫設計說明再決定要不要做。

## 2.3 工具鏈與匯入（約 2 小時 20 分）

### P3 重新產生 RTT 資料（30 分）

**現況**：`rtt.js` 的 header 寫著 `Generated by working/gen.py`，與現在的 `gen.mjs` 不一致。`rtt.matrix` 只有 8 個城市，但拓樸有 45 個 router，表示這是舊版產生器的產物。

**做法**：等「開工前待人工決定」第 2 點的 CSV 到位後，用 gen.mjs 重新產生 rtt.js（依第 3 點，只取 rtt.js、不得覆寫 topology.js），確認 matrix 涵蓋所有 city（套用 D3 修正後的 city），且輸出不再含 `cityRef`（CLAUDE.md 已定案移除）。

### P4 工具鏈與命名統一（40 分）

- ~~CLAUDE.md、SPEC 和程式碼註解中的 `working/` 改成 `pipeline/`~~；~~註解與標題中的 BlastRadius 改成 Topocide~~（已於清理完成）。
- 剩下：**generated 檔的 header 改產生器**（`pipeline/gen.mjs` 第 696、940 行仍寫 `working/gen.mjs`、BlastRadius），不要手改輸出檔；edit.html 匯出 `topology.js` 的 header 字串。
- CLAUDE.md 通篇的 `output/` 說法（鐵則 #3、「資料工具鏈」段）依「待人工決定」第 1 點處理。
- **修 bug**：`draft.js` 的 `read()` / `write()` 忽略呼叫端傳入的 topo key（`index.html` L28–36、`edit.html` L1751–1758 都有傳），所有 `?topo=` 共用同一份草稿。改成 per-topo key，與下面的 key 改名一起做。
- `draft.js` 的 localStorage key `'blastradius-draft'` 改成 `'topocide-draft'`，**要寫遷移邏輯**（新 key 沒資料而舊 key 有，就搬過去）。語言 key `br-lang` 同樣處理。
- Worker URL `blastradius-worker...` **不要改**。

### P5 匯入資料的清理與 HTML 轉義（50 分）

**現況**：hostname、label、prefix、SRLG 名稱都可能來自使用者貼上的 LSDB，然而 `index.html` 約 35 處、`edit.html` 約 17 處 `innerHTML`。

**做法**：
- 匯入端（`ospf-import.js`）：驗證 id 字元集（`[A-Za-z0-9_-]`），不合法的 hostname 做 sanitize 並輸出 warning（用 D2 的格式）。
- 顯示端：新增共用的 `escapeHtml()`，所有外部資料插入 innerHTML 前先轉義；純文字改用 `textContent`。

**驗收**：用 `<img src=x onerror=alert(1)>` 當 hostname 匯入一段 LSDB，在各個 tab、inspector、toast 都不會執行。

### P6 Worker 端強化建議文件（20 分）

新增 `docs/worker-hardening.md`：驗證 key 格式（`^[a-zA-Z0-9_-]{1,64}$`）、限制 payload 大小、rate limit、constant-time 比對 token、可改用 CF Access 或 Turnstile，附一段參考用的 Worker 程式碼。（Worker 原始碼不在 repo；若之後補參考版，放根目錄 `worker.js`，與 CLAUDE.md 一致。）

### P7（加碼，60 分）把重計算移到 Web Worker

N-1 掃描和 `optimizeWeights` 目前在主執行緒上執行（L3249 `setTimeout(..., 30)`）。做了 A2、A4、A5 之後計算量會增加，這一項的價值會變高。新增 `engine.worker.js`，讓 UI 顯示進度並可取消；不支援 module worker 的環境退回主執行緒。

---

## 2.4 base 查核發現的程式 bug（約 3 小時 20 分）

> 對照 SPEC 與 UI 時發現的程式問題。SPEC / UI 文字已如實描述現況（UI 說明文字的錯誤已直接修正）；這裡是要改程式行為的任務。

### B1 demand.js 缺檔時 index.html 崩潰（bug，15 分）

**現況**：`index.html` L1685 在模組頂層直接 `Object.entries(demand.profiles)`，沒有 `typeof demand` 防護。缺 demand.js 會 ReferenceError，整個 module script 停止，違反 CLAUDE.md 的 Graceful Degradation。C3/C4/C10 已有各自的「未載入」提示，但現在執行不到。

**做法**：profile 下拉加防護（沒有 demand 或沒有 `profiles` 時隱藏或 disabled），讓既有的各分頁降級訊息生效。

**驗收**：暫時移除 `<script src="demand.js">` 後頁面能開，C4 顯示未載入訊息。

### B2 pseudo-node 判斷依賴 `PN` 前綴（bug，30 分）

**現況**：engine 以 id 是否 `startsWith('PN')` 判斷 pseudo-node（`engine.js` L28、`stripPseudo` L183）。`ospf-import.js` L32 把 hostname 前綴 `CB` 對到城市 `PNH`（金邊），產生 `PNH1`、`PNH2`… 這些 router 會被當成 pseudo-node。

**做法**：改用節點 `type === 'pseudonode'` 判斷（資料已有這個欄位），或改用不衝突的城市代碼。改判斷方式屬於 engine 行為改動，要跑 0.3 的快照確認 demo 結果不變。

### B3 edit.html 的 externals 不會傳到 index.html（bug，40 分）

**現況**：edit.html 把 externals 存在各節點的 `node.externals`，但 index.html 只從草稿 / 廣播換掉 `nodes / edges / positions`（`index.html` L38），engine 的 `buildPrefixIndex` 只讀頂層 `topology.externals`（`engine.js` L53）。在 edit.html 改 LSA5 外部路由，index 看不到。

**做法**：index 載入草稿時從 `node.externals` 重建頂層 `externals`（或 engine 同時讀兩處，由 normalize 函式處理）。

### B4 兩項行為確認（判斷，20 分）

- 「清除所有故障」不論目前在哪個分頁，都會重畫 C1 路徑（`index.html` L3458–3462）。
- C2 屬於「即時狀態」群組，但 bandwidth-survival 模式不看右鍵故障（`index.html` L1952）。

- C4 在鏈路沒有 `capacity` 時把利用率設為 0、歸為閒置，即使有流量（`index.html` L2401；demo 資料每條邊都有容量，目前不會觸發）。

先確認是刻意設計還是 bug；是 bug 就修，是刻意就在 UI 加提示。

### B5 雲端同步失敗仍顯示「已同步」（bug，10 分）

**現況**：`pushRemote`（`edit.html` L1709–1715）不檢查 `r.ok`，Worker 回 401 / 500 時仍跳「☁ 已同步到雲端」，只有網路錯誤才顯示失敗。

**做法**：`r.ok` 為 false 時丟錯，走既有的失敗提示。與 0.1 一起做。

### B6 edit.html 匯入對話框與「載入全部」（bug，40 分）

**現況**：
- `btnImport` / `modalOk` 的 onclick 在 `edit.html` L2279–2282 被重新指定，蓋掉 L1799 / L1900 的版本，新版不呼叫 `openImport()`。結果是 Demand / SRLG / RTT 分頁的 placeholder 仍寫 topology.js，「填入範例」永遠出現且只會填 OSPF LSDB，開過一次 OSPF 匯入後一般匯入會殘留 OSPF 提示。
- 貼上有語法錯誤的 topology.js 時會退回 OSPF 解析（L1916），顯示「沒有解析到 Router LSA」，訊息誤導。
- 「載入全部」每個 fetch 都 `.catch(()=>{})`，缺檔仍提示「已載入同目錄 4 個檔」（L2284–2289）。
- OSPF 匯入不看 `Router Link States (Area N)` 標頭，多 area 的貼上會被合併並全標成 area 0（`ospf-import.js` L78–123）。

**做法**：handler 只保留一套（合併兩處）；JS 解析失敗時先報 JS 錯誤，只有看起來像 LSDB 才走 OSPF；「載入全部」回報實際成功的檔數；OSPF 匯入遇到非 0 area 時給 warning。

### B7 metro-tune 與 edit.html 不一致（bug，45 分）

**現況**：
- 著色與「八向化率」固定以 45° 判定（`tools/metro-tune.html` L573），選 16 / 32 向時正確吸附到 22.5° / 11.25° 的邊也被標成未達標。UI 已改標「以 45° 判定」。
- 「複製 `LAYOUT_PARAMS.metro`」只有 `none` / `radial` 模式會輸出 edit.html 讀得到的 `distPow`；其他模式的參數 edit.html 不讀，貼回後壓縮等於關閉（`edit.html` L1152）。README 已註明。
- 調參頁的排版與 edit.html 不同：`LON0` 140 vs 150、de-overlap 3 次 vs 4 次、沒有最終格點吸附、達標門檻 `A_TOL+3` vs `+2`。

**做法**：著色改依所選方向數判定；複製時對 edit.html 不支援的模式 / 方向數給警告；排版步驟抽成共用函式或至少對齊常數。

---

# 第 3 章：UI 與操作（約 4 小時 50 分）

> 以下問題是用 Playwright 在 1440×900 與 1100×760、中英文下實際截圖觀察到的。
> 遵守 CLAUDE.md 的設計原則：Desktop-first（**不做手機版**）、顏色走 design token、字串進 I18N、狀態變更走 setter、按鈕走 `data-action` 委派。
> 截圖工具 Playwright 的安裝方式依「開工前待人工決定」第 4 點。
> **共同驗收**：每個任務完成後在兩種尺寸、兩種語言下截圖，回報時附上修改前後的截圖路徑；`npm test` 必須維持通過。

### U1 右側面板被橫向捲動，內容左側被切掉（bug，30 分）

點選後段的分頁（「鏈路」「Prefix」）後，整個右側面板往右捲動，標題變成「INK COSTS」「ath」。

**做法**：分頁列自己用 `overflow-x: auto`，右側面板設 `overflow-x: hidden`。切換分頁時只呼叫 `tabbar.scrollTo`，**不要用會牽動祖先容器的 `scrollIntoView`**（L2079）。

**驗收**：依序點過所有分頁，面板的 `scrollLeft` 一直是 0。

### U2 分頁列（30 分）

**現象**：英文「N-1」被斷成兩行，「Link traffic」「Failure sim」換行；「Prefix」在 1440 寬時就被切掉；三組分頁的分組意思只寫在 tooltip 裡。

**做法**：tab 文字加 `white-space: nowrap`；每組分頁上方加一行小的分組標籤（顏色用 `--tab-*` token）；縮短英文標籤為 `Traffic`、`Failure`、`Asym.`，完整名稱放 tooltip。改標籤時同步 README 功能表與 SPEC §12 的分頁名稱（目前三者一致：Link traffic / Failure sim / Asymmetric）。

### U3 長篇說明收合（35 分）

**現象**：每個分頁頂端有 4～15 行說明，把操作和結果擠到畫面下方。

**做法**：改成「一行摘要 + `<details>` 展開」，展開狀態記在 localStorage（`topocide-help-open`），第一次使用預設展開。「Design audit：忽略手動故障標記」這種影響結果判讀的警告**要保留在外面**。

### U4 拓樸圖（35 分）

**現象**：圖沒有填滿畫布；每條鏈路都顯示 cost 和容量，在 HKG、SIN、TYO 一帶完全重疊。

**做法**：載入完成、視窗尺寸改變、拖動分隔線時執行 `cy.fit()`；設定 `min-zoomed-font-size`；在左側 CONTROLS 中段加切換「cost / 容量 / 兩者 / 隱藏」，偏好記在 localStorage。

### U5 失效模擬結果表（25 分）

**現象**：平行鏈路「TPE ↔ TYO」出現兩次無法分辨；鏈路名稱斷成兩行；Δ% 同時用箭頭和正負號（「↓ -100%」）；徽章「×2 ▲8 ▼4」沒有說明。

**做法**：用 D4 的 `edgeDisplayKey` 顯示 `TPE ↔ TYO #2` 或電路名稱，套用到所有列出鏈路的表格；鏈路欄和 Δ% 欄加 `nowrap`；Δ% 只保留帶正負號的數字加顏色；三個徽章各加文字或 tooltip。

### U6 文案與 i18n 細節（30 分）

- **硬編在 I18N 外的 UI 字串**（違反鐵則 #5）：C2 diversity 格子 tooltip（`index.html` L1997）、頻寬存活 tooltip（L2002、L2007）、C10「無參考」（L3085）、空白處圓盤選單「存圖 / 置中 / 編輯器」（L3521–3523）、編輯器連結 title（L332）、`UNREACHABLE`（L2103）、C5 的 `Components after failure` / `Disjointed groups` / `Top affected links`（L2577–2607）、C8 的 `Prefix Index` / `redundant` / `single-advertised`（L2790–2795）、`+N more`（L1643）。全部移進 I18N（zh / en）。
- 畫面內建的「已知限制」（`ui.limit.*`）與 README Limitations 內容不同，F1 時決定以哪份為準並同步。

- 單複數：「1 links」，在 I18N 中用函式處理，全域搜尋類似寫法。
- 「4544 Gbps demand all routable」改成「All 4,544 Gbps of demand is routable」。
- 大數字用 `Intl.NumberFormat`。
- 流量情境、SRLG 名稱改用 D6 的 `label_en`，缺少時顯示 `id · label`。
- 語言切換按鈕改成分段按鈕 `中文 | EN`，目前語言反白；切換時同步更新 `document.documentElement.lang`。
- 頂部副標題縮成一句話。

### U7 統一計算觸發方式，並標示結果是否過期（45 分）

**現象**：「路徑」分頁一開啟就有結果；「N-1」卻是空白只有按鈕。輸入改變後，舊結果沒有提示。base 確認：C1–C4、C10 有 `activate`，切換就算；C5–C9 只回傳 `render`，只能按按鈕（`index.html` L2644–2964）。

**做法**：計算量小的分頁切換進來時自動計算；計算量大的保留按鈕，但空白狀態顯示一句提示。用 `inputsVersion` 與各分頁的 `resultVersion` 比對，過期時顯示「結果已過期 · 重新計算」。執行超過 300ms 時按鈕顯示 loading；做了 P7 就顯示進度並可取消。

### U8 edit.html 工具列（40 分）

> 已修正的文字：雲端同步 tooltip（KV → R2）、PNG 匯出、格點吸附、新增節點位置、驗證說明與結果訊息、OSPF「/30」用詞、圖例補上綠色「不對稱 cost」。剩下：ASBR 勾選框標籤「注入 LSA5 預設路由」容易誤解（只設 `isASBR`，`edit.html` L705）；狀態列國家數把空字串算進去（L1685）。

**現象**：一列 15 顆按鈕貼到右邊界；💾 ☁️ 只有圖示；「載入」和「匯入」分不出差別；圖上的綠色鏈路在圖例中找不到說明。

**做法**：按功能分組（檔案下拉、儲存、編輯、新增、驗證），「驗證」顯示 D2 的結果清單並可跳到對應元素；「載入」「匯入」只留一種用詞；純圖示按鈕補 `title` 和 `aria-label`。（圖例的綠色「不對稱 cost」已於清理時補上。）

### U9 index 矩陣的表頭固定（20 分）

C2 矩陣 45×45，捲動後看不到行列標題。比照 edit.html 的 `.dt th` / `.rowh`，讓首列與首欄 `position: sticky`。

### U10（加碼，60 分）edit.html 的 i18n

edit.html 中英文混雜且沒有語言切換。比照 index 的 `I18N` + `t()`，兩頁共用語言 key。先處理工具列、分頁和 Inspector。

### U11（加碼，30 分）無障礙與快捷鍵

edit.html 分頁從 `<div>` 改成 `<button role="tab">`；所有可點擊元素加 `:focus-visible`；只用顏色表達的狀態附文字；按 `?` 開啟快捷鍵說明。

---

# 第 4 章：收尾，文件與發佈（約 40 分 + 加碼）

### F1 README（中英兩份同步修改，30 分）

- 最上方：一句話說明、live demo 連結（`https://sinnoken.github.io/topocide/`）、截圖（用 Playwright 實際拍攝放在 `docs/img/`，**不要偽造**）。
- 修正執行步驟（`npm run serve`）；`misc/dof-calculator.html` 是與本專案無關的相機景深計算器,不寫進 README。
- 新增「Data format」（連結 `schema/`、`npm run validate`）和「Development」（`npm test`、兩條資料產生路徑）段落。
- 雲端同步段落改為說明 0.1 的設定方式。
- 更新 Limitations：A1 完成後改寫第 5 點（ECMP 模型）、P4 修好後刪第 6 點（草稿分 topo）；補 Tailwind Play CDN 不適合正式環境。

### F2 GitHub Pages（10 分）

新增 `.github/workflows/pages.yml`，用 `actions/deploy-pages` 部署。

> ⚠️ 待人工處理：Settings → Pages 的 Source 設為 GitHub Actions；About 補上 description 與 topics（`ospf`、`network-resilience`、`traffic-engineering`、`srlg`、`cytoscape`）。

### F3（加碼，30 分）範例 LSDB

新增 `examples/sample-lsdb.txt`：**合成的** `show ip ospf database` 輸出，約 10 個節點，IP 與 hostname 虛構。寫測試確認 `ospf-import.js` 能解析，README 說明如何使用。

### F4（加碼，25 分）CDN 版本統一並加上 SRI

`tools/metro-tune.html` 的 cytoscape 3.26.0 改成 3.28.1；所有外部 script 補上 `integrity` 和 `crossorigin`，hash 實際下載計算，**不能編造**。

---

## 不在這次範圍內（不要做）

- 拆分 `index.html` / `edit.html` 為多個檔案。
- 移除 Tailwind CDN，或引入任何 build step。
- 改寫 git 歷史、force push。
- 多 area 計算、steer/CAC 等 roadmap 功能。
- 全組合 N-2（只做 SRLG + 1）。
- 手機或觸控版 RWD；更換整體配色或字型。

---

## 附錄：每項建議的依據

檢查方式：**(A)** 閱讀程式碼，附行號；**(B)** 用 `evidence-data-check.cjs` / `evidence-ecmp-tiny.mjs` 實際執行；**(C)** 用 Playwright 在 1440×900 / 1100×760、中英文下截圖。標記「判斷」的是我的設計建議，不是 repo 現有的方向，可以討論。

| 任務 | 依據 | 類型 |
|---|---|---|
| 0.1 token | `edit.html` L1691–1692 寫死 `REMOTE_URL` / `REMOTE_TOKEN`，L1702 以 `X-Token` header 送出；repo 公開 | A |
| 0.2 路徑 | README L63 `cd /mnt/workspace/output && python serve.py`，repo 無 `serve.py`；`pipeline/gen.mjs` L25、`pipeline/verify_ecmp.mjs` L4/L8 寫死 `/mnt/workspace/output`；`pipeline/ospf_to_topology.mjs` L9 讀不存在的 `../input/Cisco OSPF.txt` | A |
| 0.3 測試 | repo 無 `test/`、`.github/`、`package.json`；CLAUDE.md 鐵則 #4 要求人工「目視比對」 | A |
| D1 schema | 四個資料檔無 `schemaVersion`；`capacity` 單位只在 SPEC §1.3 註解；`topology`/`srlg` 無 export、`demand`/`rtt` 有 export | A |
| D2 驗證器 | `edit.html` L1646 `validate()` 只在 UI 內；`pipeline/` 無對應 CLI | A |
| D3 city | 腳本輸出：48 節點、46 個不重複 city；`TPE2.city="TPE2"`、`HKG3.city="HKG3"`；PEK / PN_* 的 city 為空字串；`index.html` L1898 以 `rtt.matrix[city][city]` 查表 | B + A |
| D4 平行鏈路 | 腳本輸出 7 組：LAX-SJC、TPE-TYO、HKG-TPE、SHA-TYO、HKG-SIN、LAX-TYO、JFK-LHR，皆以 `_b` 後綴區分 | B |
| D5 affects | `srlg.js` L3–4 註解「may contain edge IDs and node IDs… expandSRLG() resolves at runtime」；`index.html` L1692 | A |
| D6 label | `topology.js` 每個節點 `label: "TPE\nTW"` 等於 `id\ncountry`；`demand.js` L15 `label: '月均'`、`srlg.js` `label: 'APCN-2 海纜'` 無英文；截圖英文介面顯示中文資料名 | A + C |
| D7 positions | `topology.js` L157 `positions` 與網路模型同檔 | A，判斷 |
| A1 ECMP | `engine.js` L336 `w = gbps / r.edgePaths.length`；`evidence-ecmp-tiny.mjs` 小圖輸出 S–A 30 vs 預期 45；demo 資料逐跳重算 SIN–BOM 差約 38 pts（初步） | B + A |
| P2 搬回 engine | `expandSRLG` 在 `index.html` L1692；RTT 解析在 L1887 與 L2989 兩處 | A |
| P1 RTT=0 | `index.html` L1887 註解「同城/缺 → 0」；截圖 `evidence-P1-rtt-zero.png` C2 矩陣 TPE→SIN = 0.0，而 `rtt.js` L165 有 `{a:'TPE', b:'SIN', rtt:32.9}` | A + C |
| A2 N-1 無流量 | `computeN1WorstCase` L549–658 只用 `dist`，無 demand / capacity 參數；C9 的超載數在 `index.html` L2865–2881（UI 層） | A |
| A3 餘裕 | 無對應函式；可由 `evalCongestion` 推得 | 判斷 |
| A5 SRLG+1 | SPEC §4.6「no N-2」 | A，判斷 |
| A4 最佳化 | `optimizeWeights` L787 以單一情境評估；README roadmap「N-1 survivability gate」未完成；設計見 `docs/design/optimizer-v2.md` | A |
| A6 LFA | 無對應功能 | 判斷 |
| P3 rtt 重產 | `rtt.js` L2 header 寫 `working/gen.py`；腳本輸出 `rtt.matrix` 只有 8 城市 | A + B |
| P4 命名 | `git grep working/` 命中 CLAUDE.md、SPEC、`ospf-import.js` L3、`gen.mjs` L696/L940；`git grep -i blastradius` 命中 `draft.js` L4、`theme.css` L1、`tools/metro-tune.html` L7 等 | A |
| P5 轉義 | `grep -c innerHTML`：index 35、edit 17；`ospf-import.js` 直接把 hostname 寫入 label | A |
| P7 Worker | `index.html` L3249 `setTimeout(() => runOptimizeCore(target), 30)` | A，判斷 |
| U1 面板切掉 | 截圖 `evidence-U1-panel-clipped.png`；`index.html` L2079 `scrollIntoView` | C + A |
| U2 分頁 | 截圖「N-1」斷成兩行、「Prefix」被切掉；分組只在 L393–404 的 `title` | C + A |
| U3 說明過長 | 截圖 Links 分頁說明約 15 行，操作按鈕在 y≈755 | C |
| U4 圖未填滿 | 截圖右下約 1/3 畫布空白；HKG/SIN 一帶 label 重疊 | C |
| U5 結果表 | 截圖 `evidence-U5-parallel-links.png`：「TPE ↔ TYO」出現兩次；「↓ -100%」；徽章無說明 | C |
| U6 文案 | 截圖「1 links」「4544 Gbps demand all routable」；`index.html` L1207/L1256 無單複數處理；L1428 語言鈕顯示「要切過去的語言」 | C + A |
| U7 觸發不一致 | 截圖路徑分頁進入即有結果 vs N-1 空白只有按鈕 | C，做法為判斷 |
| U8 工具列 | 截圖 15 顆按鈕貼到右邊界，💾 ☁️ 無文字；圖例只有 p2p / transit | C |
| U9 表頭 | `edit.html` L155/L160 已有 sticky；`index.html` 矩陣無 | A |
| U10 edit i18n | 截圖中英混雜；`edit.html` 無 `I18N` / `t()` | C + A |
| U11 a11y | `edit.html` L244–247 分頁為 `<div class="tab">` | A |

附檔：`evidence-data-check.cjs`、`evidence-ecmp-tiny.mjs`、三張截圖。**這些附檔目前不在 repo 裡**；執行時請提交到 `docs/evidence/`，或在 0.3 / A1 的單元測試中重現同樣的數字（例如 5 邊小圖 S–A 30 vs 45）。

---

## 每個 session 結束時的回報格式

```
## 已完成
- [x] 0.1 … （commit sha，實際耗時）
## 刻意改變的計算結果
- A1：SIN–BOM 利用率 xx% → yy%（快照差異摘要）
- P1：SLO 覆蓋率 70% → xx%（未知 N 對）
## 跳過 / 部分完成（原因）
## 待人工處理
- [ ] Cloudflare 作廢並更換舊 token
- [ ] repo 結構與缺檔（待人工決定第 1、2 點）
- [ ] 是否改寫 git 歷史
- [ ] GitHub Pages / About topics
## 測試結果
npm test 輸出摘要
```
