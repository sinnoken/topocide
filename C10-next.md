# C10 壅塞最佳化 — 下一版設計文件

> **性質**:設計草案(Design Doc),非 SPEC 更新。
> 對應現有 SPEC.md §15(Fortz-Thorup + Tabu);本文描述**擴充版**,聚焦「目前 v1 不做但要做的」。
> 確認後再更新 engine.js + SPEC.md §15。

---

## 一、現況(v1)做了什麼

- **單一目標**:最小化正常態 MLU(最忙鏈路利用率)。
- **硬約束**:RTT 下限(cost 不能低於實體延遲)+ `COST_CLAMP [5,500]`。
- **無 N-1**:完全不考慮失效後的狀況。
- **無** RTT 端對端預算、頻寬單價、異動比數/幅度等。

---

## 二、下一版(v2)要加什麼

### 2.1 完整的約束 / 目標分層

**層 1 — 硬約束 Gate(只在找到新 incumbent 時驗,pass/fail)**

| 約束 | 生效條件 | 說明 | 資料需求 |
|------|----------|------|----------|
| N-1 MLU ≤ 上限 | 一律 | K 個失效態 MLU 不超過設定值 | 失效集(見 §2.3) |
| RTT 繞道上限 | **勾選時** | 調整後路徑 RTT ≤ 現況 OSPF RTT + Δ；正常態 + 失效態皆驗 | `rtt.edges`(已有);現況 RTT 初始化算一次後固定 |
| 既有 | 一律 | RTT 下限、`COST_CLAMP` | 已有 |

> Gate 不是「每個候選都剔除」,而是「找到正常態更優的 incumbent 時才驗一次」;過不了就退回繼續搜,把昂貴驗證從「每候選」壓到「每次改善」。若所有改善都過不了 Gate → 沿用 §15.4 infeasibility 輸出。

**層 2 — 主要目標(越小越好,有序)**

| 優先 | 目標 | 正常態 | 含入 N-1 情境 |
|------|------|--------|--------------|
| 1 | **MLU** | ✅ 一律 | ✅ 一律 |
| 2 | **$ 傳輸成本** | ✅ 勾選時 | ✅ **勾選 $ 成本才含** |

**層 3 — 平手再比(Tie-breaker)**

| 優先 | 指標 | 含入 N-1 情境 |
|------|------|--------------|
| 1 | 異動比數(L0) | **勾選 change budget 才含** |
| 2 | 異動幅度(L1) | **勾選 change budget 才含** |

> **核心規則**:RTT 預算 / $ 成本 / change budget 三個選項——
> - **勾了** → 整個進 N-1 情境一起評估(Gate / 目標 / tie-breaker 全部含)
> - **沒勾** → 完全不納入任何情境、目標、tie-breaker
>
> N-1 的 MLU 失效態一律生效,不可關。
> 實作走**字典序**:層 1 → 層 2 → 層 3,不加權混合。

---

### 2.2 UI 勾選設計(對齊現有 C10 進階選項風格)

```
壅塞最佳化                                          [最佳化]

─── 目標 ───────────────────────────────────────────────────
  ━━  壅塞目標：全網最忙鏈路利用率(MLU) ≤ [75] %
  ☐   同時最小化頻寬單位成本（Σ 流量 × $/Gbps）

─── 約束 ───────────────────────────────────────────────────
  ☑   N-1 生存性：任一關鍵失效後 MLU ≤ [95] %      ← 必選，不可關
        失效集：前 [5] 個（依脆弱度排行自動選取）
  ☐   RTT 繞道上限：調整後 ≤ 現況路徑 + [50] ms
  ☐   異動上限（Change Budget）≤ [10] 條

─── 進階選項 ───────────────────────────────────────────────
  ☐   起點改用 InvCap（預設：現網 warm 投影）
  ☐   允許不對稱權重（去 / 回程獨立）
  ☐   也調 transit 介面成本
```

> **可選項規則**：RTT 預算 / 頻寬單價 / 異動上限，勾了就**同時納入正常態與 N-1 失效態**的評估；不勾就完全不參與。N-1 生存性（MLU）一律生效。

---

### 2.3 N-1 的失效集怎麼選

**原則**:不是跑全 N,而是用**工具已有的資料**先挑出「最危險的幾個」:

1. **前 K 個 SRLG 群組**(海纜 / 共管 / 機房 / 上游,已在 `srlg.js`)
2. **C9 脆弱度排行前幾個節點**(最致命失效排行,已在 engine)
3. K 由使用者設定(預設 5,上限建議 10)

這樣 **K 是有界的**,不會隨節點數爆炸。

---

### 2.4 N-1 評估怎麼算得起來

**核心問題**:每次評估一組權重,要多跑 K 次失效態 → 計算量變 (K+1) 倍。

**三個省力手法:**

**A. 只在 incumbent 驗 N-1(省最多)**
- Tabu 鄰域探索 → 用正常態 MLU 快速評分
- 只有「找到更好的正常態解」時 → 才跑 K 個失效態驗 Gate
- 過不了 Gate → 退回、繼續搜

**B. 增量流量計算(每次只算被影響的部分)**
斷一條鏈路或節點,只有「本來走那裡的流量」才需要重算,其他八九成保持原樣。
- 建兩個索引:`(fE,fN) → 用到它的 source-tree`、`(fE,fN) → 相關 demand`
- 失效評估 = 從正常態出發,**減掉**受影響的流量 → 重繞那部分 → **加回**新流量
- 斷線後不可達的 demand 自動成 lostDemand 掉出分母,**不需要另外跑 BFS 判斷連通性**
- 比「每次失效都 full allPairsTraffic」快一個量級

---

### 2.5 評估器簽章(engine.js 層)

**現有:**
```js
evalCongestion(topo, demand, fE?, fN?)
  → { mlu, sumU2, sumPhi, util, lostDemand }
```

**新增(增量版):**
```js
// 一次建索引,後面每個失效態共用
buildN1Index(topo, demand, rttEdges)
  → { nominalLoad, nominalRtt, edgeToDemands, edgeToSourceTree }

// 單次失效態增量評估(支援邊失效 fE 或節點失效 fN,或兩者同時)
evalFailureIncremental(index, fE, fN)
  → { mlu, rtt, cost }

// 失效集彙總(取 worst-case over K 個失效情境)
evalN1Worst(index, K_set, constraints)
  → { mluWorst, rttWorst, costWorst, violations[] }
// K_set 每項為 { fE: Set<edgeId>, fN: Set<nodeId> },同時支援 SRLG(邊集合)與關鍵節點
```

**allPairsTraffic 維持不動**;新函式是**在它的結果上做 delta**,不重複造輪子。

---

### 2.6 Tabu 迴圈接點

```
[初始化]
  index       = buildN1Index(topo, demand)          ← 一次,後面所有失效態共用
  K_set       = selectFailureSet(srlg, n1ranking)   ← 用現有 C9 排行 + srlg.js
  nominalRtt  = allPairsRtt(topo, rtt.edges)        ← 現況 OSPF 路徑 RTT,算一次後固定
  // RTT Gate(勾選時):new_rtt ≤ nominalRtt[a][b] + Δ
  // Cost 已有 RTT 下限 + COST_CLAMP,不需額外光纖硬上限

[Tabu 主迴圈]
  for each neighbor w:
    score = evalCongestion(topo, demand, w)      ← 快(正常態,每候選都跑)
    if score < incumbent_score:
      n1 = evalN1Worst(index, K_set, opts)       ← 慢(只在正常態改善時跑)
      if n1 passes Gate:
        incumbent = w
        incumbent_score = score
        update tabu list
      else:
        記錄 n1.violations                        ← 供 infeasibility 輸出(§15.4)

[結束]
  if no incumbent passed Gate:
    return infeasible + bottleneck(§15.4)        ← 沿用現有 infeasibility 輸出
  else:
    return incumbent
```

---

## 三、資料需求(待補)

| 欄位 | 位置 | 現況 | 備註 |
|------|------|------|------|
| `edge.unitPrice` | topology.js edge | 未有 | $/Gbps,需在 edit.html 補欄位 |
| RTT Δ | UI 輸入 | 未有 | 預設 50ms;Gate 判斷對比 `nominalRtt`(初始化算一次後固定) |
| Change budget | UI 輸入 | 未有 | 對比 `originalEdges`(已有) |
| 失效集 K | UI 輸入 | 未有 | 預設 5 |

---

## 四、現有東西可以直接用

| 需求 | 現有資源 |
|------|---------|
| 失效後流量評估 | `allPairsTraffic(topo, demand, fE, fN)` |
| 最危險失效集 | C9 `computeN1WorstCase` 排行 + `srlg.js` |
| 異動比數/幅度 | `originalEdges`(C10 已存) |
| RTT 資料 | `rtt.edges`(已有) |
| warm 起點 | 現有 Tabu,不動 |
| 確定性 | `mulberry32(seed)` + `maxEvals`,不動 |
| infeasibility 輸出 | §15.4,沿用 |
| i18n | 新增 key 進 `I18N`,不動架構 |

---

## 五、不做的事(範圍外)

- 斷線(連通性)—— 交給 C5/C9 設計審計
- Minimax(最佳化最壞情境 MLU)—— 比約束式貴、且過度悲觀
- 機率加權 N-1 —— 需各 SRLG 失效機率,通常拿不到
- 完整 incremental SPF —— 可作為後續效能優化,v2 先用 delta load

---

## 六、建議實作順序

1. **UI**:新增 N-1 必選 + RTT/$/change budget 三個可選 checkbox
2. **資料**:edit.html 補 `unitPrice` 欄位
3. **Index**:`buildN1Index` + 失效集選法
4. **增量評估**:`evalFailureIncremental`(先用 full fallback 通過測試,再換增量)
5. **Gate 接入 Tabu**:`evalN1Worst` → incumbent-only 驗證
6. **字典序 objective**:把 RTT/$/ 異動比數接進比較函式
7. **驗證**:用現有 topology + 真實 SRLG,比對 v1 vs v2 結果差異
8. **SPEC.md §15 更新**

---

*本文件為草案,確認後更新 SPEC.md §15 + engine.js。*
