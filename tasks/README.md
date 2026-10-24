# 排班規格與文件索引

本目錄保留已確認的排班規則與未完成事項。過程紀錄集中在 `archive/`，不以歷史段落的「尚未執行」判斷目前狀態。

## 現行規格

| 文件 | 範圍與優先關係 |
|---|---|
| [來源與鎖定](staff-assignment-provenance-spec.md) | 逐人來源、原始意願與固定班 |
| [覆蓋與公平性](coverage-fairness-spec.md) | 最低覆蓋、搜尋、評分及截止重試的基礎規格 |
| [週六分配](saturday-allocation-spec.md) | 整日候選與公平性；最大可行 AB 配對的後續變更見 tests/HISTORY.md 與 saturday-pairing.test.cjs |
| [移班並補回](coverage-move-refill-spec.md) | 增補最低覆蓋的原子兩步候選 |
| [平日工作日保護](weekday-workday-preservation-spec.md) | 公平性不得消除既有工作日 |
| [平日工作日修補](weekday-workday-repair-spec.md) | 覆蓋修補後消除未請假平日空班，取代舊「初始空班僅揭露、不修補」限制 |
| [擴大模擬規格](expanded-simulation-spec.md) | 固定輸入、情境與獨立稽核；實際操作以 tests/EXPANDED_TESTING.md 為準 |

現行排班順序：固定意願／小兒 → 平日初始配置 → 週六 → 最低覆蓋修補 → 個人工作日修補 → 建立保護基準 → 公平性 → 最終驗證 → 輸出。

公平性優先序：月非自願單節 → 月工時達成率 → 每週 AC → 每週 BC／AB 同級；合法性條件優先於公平性評分。

## 狀態與歷史

- [未完成事項與最近本機驗證](todo.md)：依既有紀錄，新版工作日修補本機曾通過 197 項測試；新版雲端前導與正式批仍待驗收。
- [目前方案入口](plan.md)。
- [歷史實作方案](archive/plan.md)、[歷史任務](archive/completed-tasks.md)、[規格審查紀錄](archive/spec-review.md)。歷史數字與部署狀態均屬記錄當時。

本次文件整理沒有驗證遠端執行或部署狀態。規格中較新的明確修訂優先；若遇到未解決的規則衝突，應記錄並討論，不自行以舊報告代替規格。
