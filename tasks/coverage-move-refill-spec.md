# 最低覆蓋：移班並補回原班規格

狀態：使用者已授權實作，本機回歸完成；雲端前導／正式批待驗收。日期：2026-10-21。
能力 ID：`coverage-move-refill`。本規格只擴充最低覆蓋修補的候選，不改初始排班及公平性排序。

## 1. 問題與目標

正式 5,000 組中的 `2026-11_random_half_0017`（seed 3208942101）在 11/19 缺骨科 C。輸入可行，但現有修補搜尋 281 個候選後以 NO_IMPROVEMENT 停止，回報 COVERAGE_UNRESOLVED。

FT001、FT004、FT005 指定單 B 且 A/C off；FT002 固定小兒 B、自動骨科 A；FT003 固定小兒 C。可行解為 FT002 骨科 A→C，同時新增 FT003 骨科 A。兩項操作合併驗證後合法；任一單獨操作均不能完成修補。

成功條件：同一凍結輸入不換種子、不放寬硬限制，即可完成最低覆蓋，進入公平性調整及最終驗證。

## 2. 範圍與邊界

- 修改處：`scheduling_adjustments.js` 的 repair 候選生成；沿用 apply、validate、metadata 與 adjustmentHistory。
- 指定 fixed/off、小兒固定與代班全部保留；同人同時段不得跨科，含小兒每日最多兩班。
- 骨科 A/B/C 上限、每日最低覆蓋、週六最大可行 AB 配對均沿用既有規則；不要求 FT 補滿需求上限。
- 不增加依賴、不改 Sheet 欄位、初始 C→AC→A→B／週六流程、員工輪轉或公平性優先序。
- 不將有限搜尋失敗宣稱為輸入無解，不刪除正式失敗樣本。

## 3. 候選與接受規則

1. 保留既有純移班／交換候選優先順序。
2. 若既有候選無改善，且尚有預算，在「直接新增」之前搜尋同日「移班＋補回」組合：
   - 從問題日期 D 的骨科 S 班選可移動員工 X，移到缺人的 T 班，S≠T。
   - 選另一員工 Y（Y≠X），新增其骨科 S 班，補回 X 移出的位置。
   - 不允許移動鎖定指派；新增的 Y 不得與任何 off、fixed、小兒占用及每日上限衝突。
3. 在副本上原子套用兩項操作，再驗證完整結果。中間 S 無人不構成拒絕理由，但中間狀態不能寫 Sheet 或作為後續基準。
4. 完整結果必須嚴格降低覆蓋 loss，且不新增原本沒有的時段缺失或人數不足；不得把缺班搬去另一班／日。
5. 同層候選先比較覆蓋 loss，再用現有公平性向量及既有決勝方式。此組合淨增一班，歸類為「含新增的修補」，不得描述為純交換。
6. 沒有可接受組合時，沿用直接新增及原本錯誤分類；不改變失敗還原、禁止輸出不合格班表的流程。

本次只加入同日兩操作組合，不做任意長度交換鏈或全月求解器。候選穩定按日期、現有班別順序、staff_id 生成。

## 4. 預算、來源與診斷

- 一個完整組合算一個 evaluated 候選，不把內含兩項操作各算一候選；仍受既有候選數、接受數與共享期限限制，不重設計時。
- 新增來源沿用 COVERAGE_REPAIR；移班保留 originalSource，新增班建立獨立 metadata；兩操作記在同一 history 事件。
- 可在修補報告增補 moveRefillEvaluated／moveRefillAccepted，供確認新路徑有被搜尋，舊欄位意義不變。
- 成功停止原因維持 COVERAGE_SATISFIED；到限維持 SEARCH_LIMIT；未到限仍找不到維持 COVERAGE_UNRESOLVED。

## 5. 可驗證驗收案例

| ID | 輸入／操作 | 預期 |
|---|---|---|
| CR01 | 凍結案例 2026-11_random_half_0017 | 原版可重現失敗；新版通過完整排班與獨立 audit，不必鎖定唯一班表 |
| CR02 | 同日 FT002 A→C，加 FT003 A | 兩項合併合法，ABC 覆蓋齊全，兩位小兒班不變 |
| CR03 | 單移 A→C 造成 A 無人，或直接補第三班 | 均拒絕；不能藉中間狀態繞過完整驗證 |
| CR04 | Y 休假、已占用 S、已有兩班，或 X 來源鎖定 | 組合拒絕，輸入 context／metadata 不被污染 |
| CR05 | 存在合法純移班，或原本覆蓋已足 | 純移班優先；無缺失時不為新功能任意新增班 |
| CR06 | 候選／期限到限；反覆同輸入固定預算 | 停止原因正確，不擴大預算；非時間截斷條件下順序可重現 |

## 6. 技術、測試與風格

正式環境為 GAS V8；離線使用既有 Node node:test 與 engine-harness，不新增套件。單元／回歸檔規劃為 `tests/coverage-move-refill.test.cjs`，凍結精簡案例放 `tests/fixtures/coverage-move-refill.cjs`。正式失敗原始 manifest、結果、引擎 hash 保留為歷史證據，不改寫 Downloads 的原檔。

沿用既有操作格式與兩空格縮排，例如：

```js
{ remove: { date, shift: 'A', station: 'ORTHO', id: 'FT002' },
  add: { date, shift: 'C', station: 'ORTHO', id: 'FT002' }, source: 'COVERAGE_REPAIR' }
```

預定驗證命令（本次規格階段不執行）：

```sh
TZ=Asia/Taipei node --test tests/coverage-move-refill.test.cjs
TZ=Asia/Taipei node --test tests/coverage-repair.test.cjs
TZ=Asia/Taipei node --test tests/*.test.cjs
git diff --check
```

既有測試檔名稱於實作時核對；沒有獨立 build／lint pipeline，不虛構命令。後續雲端驗收依 plan.md；不直接沿用舊引擎的前導通過證據。

## 本機驗證紀錄（2026-10-21）

原問題先以新增測試重現失敗，再修復通過。`TZ=Asia/Taipei node --test tests/*.test.cjs`：188／188 通過。未重跑 200／5,000／10,000 組，未推送或部署；完整雲端驗收仍見 plan.md／todo.md 的 VX02。
