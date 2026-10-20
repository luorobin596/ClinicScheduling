# 最新：週六最大可行 AB 配對（2026-10-20）

週六固定合法 A／B 人數後，先求原始約束下最大可行骨科 AB 人數；只在達到此數量的方案中比較原公平性。repair／improve／最終驗證依調整後人數查同一原始限制的上界，不允許為改善評分拆成更多單節。沒有鎖定自動AB人選，也沒有加入雙班移轉。

```sh
node --test tests/*.test.cjs
TZ=Asia/Taipei node tests/evaluate-saturday-pairing.cjs --scenario baseline
TZ=Asia/Taipei node tests/evaluate-saturday-pairing.cjs --scenario full-only
TZ=Asia/Taipei node tests/evaluate-saturday-pairing.cjs --scenario mixed
TZ=Asia/Taipei node tests/evaluate-saturday-pairing.cjs --scenario week-off
node tests/summarize-saturday-pairing.cjs
```

`tests/saturday-pairing.test.cjs` 驗證最大AB、固定單班、限額仍保持最大配對及後處理保護；`tests/support/pairing-audit.cjs` 以獨立枚舉稽核各階段。新結果位於 `results/saturday-pairing/`，與 `results/saturday-allocation/` 同批比較；根目錄summary.md呈現最新結果，前版summary保存為summary-before-saturday-pairing.md。平日C／早班報表口徑維持使用者已確認定義。

舊先導測試及已被使用者清理的歷史檔案不再作此輪證據，未自動還原。原四種正式100組意願與結果保留，新的測試失敗不替換樣本。尚未部署線上Library。

---

以下為前一版週六配置的說明及比較入口。

# 週六分配與公平性測試（最新）

2026-10-19 已依週六增補規格實作 `scheduling_saturday.js`，固定合法名額後比較整日方案，使用共用增量評分。公平性優先序維持月單節 → 月工時達成率 → 每週AC → 每週BC/AB，未加入後處理雙班移轉。

[最新 400 組比較與週報](results/summary.md)。固定輸入沿用 `ced9647` 的四份 inputs.json，不重新選樣；新結果存 `results/saturday-allocation/`，舊JSON不覆寫。根目錄 summary.md 為最新報告，舊呈現保留在 summary-before-saturday-allocation.md。

```sh
node --test tests/*.test.cjs
TZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario baseline
TZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario full-only
TZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario mixed
TZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario week-off
node tests/summarize-saturday-allocation.cjs
```

`saturday-allocation.test.cjs` 驗證枚舉、增量與全量一致、來源／鎖定、原子性、限制、動態人數及平日不變。`weekly-report.test.cjs` 驗證平日C／早班目標、逐樣本率平均、N/A、短週與排除週六。新週報為AC次數、C達成率、早班達成率；短週C／早班為實際次數。報表指標不參與正式公平性評分。

S07 凍結來源等價測試明確使用 `saturday-before-allocation.cjs` 的檢查點函式，避免新週六算法被錯當成來源重構回歸。只有測試harness的 `saturdayVersion:'checkpoint'` 會載舊函式；正式引擎沒有回退開關。其他測試及正式流程預設新週六。

將來更新 TEST GAS 專案時，需加入新增的 `scheduling_saturday.js` 並同步 Config_system.js、scheduling_fairness.js、scheduling_engine.js；本次尚未上傳或部署。不要把 tests/、tasks/ 上傳為GAS程式。

---

以下為前一輪檢查點測試說明。舊版 `evaluate-adjustments.cjs`、`summarize-adjustments.cjs` 為歷史入口，請勿用來覆寫最新或凍結證據；現在請使用上方新命令。

# 排班測試與公平性評估

2026-10-19：來源追蹤、最低覆蓋修補、公平性調整及截止重試已完成本機實作。正式結果見 [400 次模擬報告](results/summary.md)。未更新線上 Apps Script Library。

## 現行驗證入口

```sh
node --test tests/*.test.cjs
TZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario baseline
TZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario full-only
TZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario mixed
TZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario week-off
node tests/summarize-adjustments.cjs
```

測試均在 Node 執行，以假 Google 服務／假 Sheet 取代線上服務，不寄信或修改真實試算表。完整測試 109 項；模擬結果另行逐筆驗證，不以測試程式跑完表示所有排班都合格。

- `assignment-provenance.test.cjs`：S01～S07；逐人來源、鎖定、刪除舊表前驗證、凍結 100 組初始班表等價。
- `coverage-repair.test.cjs`：R01～R05；硬限制、可行性、原子候選、同日／跨日／兩步修補與搜尋停止。
- `fairness-adjustment.test.cjs`：F01／F01b／F02／F03；休假工時基準、單節分類、逐週班型、字典序及人數不變。
- `adjustment-integration.test.cjs`：I01；最終流程與假 Sheet 寫入時序。
- `flow-retry.test.cjs`：I02／I03；CLOSED 重試、截止時間、失敗還原、拒收舊頁、共享互斥鎖及部分 I/O 診斷。
- `scenario-fixtures.test.cjs`：三種新增請假情境的額度與連續一週；既有輪轉、上限與休假模型測試亦保留。

## 現行模型與比較

11 月無國定假日、5 個週日；通常月休 9 天，扣週日後 8 個半天額度。全天休扣 2、ABC 全禁；半天休扣 1、指定一班並禁排其餘；指定雙班扣 0 且鎖定。小兒形成的非自願單節納入，個人指定的半天單節排除。連休一週者月休 11 天，其他四人 9 天。

最低骨科覆蓋：平日至少兩名不同員工且 ABC 各有人；週六至少一名。小兒不計骨科；仍容許未滿需求上限的兼職缺額。

公平性使用正式引擎共用的 `ScheduleFairness.measure`：月非自願單節 → 月工時達成率 → 每週 AC → 每週 BC／AB 同級。週日至週六分週，含週六班型與月初月底短週；不強制每週固定班型配額。工時達成率依原始休假算個人應排工時，不因排班空缺而縮小分母。

`baseline` 完全保留先前同批 seed／events，其中 1 組真實輸入衝突不會替換；前後公平性使用同一批成功 99 組。新增三情境以原始意願與小兒固定班做當日可行性檢查，先固定 100 組再執行後處理；不以初始自動班表或修補結果篩掉樣本。前置拒絕原因及正式樣本均保存在 `results/*-inputs.json`。修補後失敗一律留在分母。

`results/*-evaluation.json` 保存初始、修補、最終、失敗、搜尋停止及版本 SHA256；`summary.md` 是比較報告。先導測試及篩選偏差修正前的結果已於 2026-10-20 清除，不影響正式 400 組資料。

## 正式模組與本機測試邊界

新增 `scheduling_assignments.js`、`scheduling_fairness.js`、`scheduling_adjustments.js` 三個 GAS 全域物件，供 `scheduling_engine.js` 使用；既有前台呼叫介面與 Sheet 欄位維持。更新 TEST 專案時需一併加入三檔，並同步本次既有 JS 檔修改。`tests/`、`tasks/` 不上傳為 GAS 程式碼。

`engine-harness.cjs` 預設只執行初始排班，供歷史回歸；`{ final: true }` 或 `generateFinalSchedule` 才執行正式完整流程。模擬入口明確呼叫相同的初始、repair、improve，並獨立核對意願、人數、鎖定及最終最低覆蓋。

本機成功不等同線上 GAS 權限、實際 Library LockService 範圍、Spreadsheet I/O 與時間配額均已驗證。這些須在 TEST 專案確認。資料寫入並非跨 Sheet 原子交易；狀態還原不代表舊班表已自動回復。

## 清理與保留原則（2026-10-20）

已刪除不供現行測試／正式比較使用的歷史 `five-ft-*` JSON／CSV、三支 `simulate-five-ft*` 模擬入口、`fairness-2026-11.json`、`fairness-human-leave-2026-11.json`、`fairness-human-leave-coverage-2026-11.json`、有篩選偏差的 `superseded-initial-roster-screen/` 與兩輪 `baseline-3-*` 先導輸出。歷史內容可由 Git 追溯；舊文件提及這些先導輸出時，僅代表當時執行紀錄。

保留全部 `.test.cjs`、`support/` 與 `fixtures/`。`analyze-fairness.cjs` 的 `analyze` 仍被 `leave-model.test.cjs` 引用，不能當作過期腳本刪除；直接執行時仍可產生診斷報告。

保留 `fairness-paired-rotation-100-2026-11.json`、根 results/ 的四組正式 inputs／evaluation 及 saturday-allocation/ 的四組正式 inputs／evaluation。這些資料供凍結樣本、舊週六評分核對及最新報告重建使用，不能因版本較舊而刪除。診斷腳本、偏差分析與比較前摘要亦保留。

往後執行評估的 `--limit` 小樣本輸出屬先導產物，確認正式 100 組結果後可清除；勿取代正式固定輸入或回歸 fixtures。
