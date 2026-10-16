# 可驗證的小型任務：來源 → 覆蓋 → 公平性

狀態：全部待執行。文件及驗收條件已細分，不代表業務決策已核准或程式已完成。
來源規格：staff-assignment-provenance-spec.md；覆蓋/公平性規格：coverage-fairness-spec.md。

每項任務預計只修改列出的 1～3 個檔案，先建立對應失敗案例再實作；test 名稱應包含任務 ID，讓下列聚焦指令能直接使用。新測試檔目前尚未建立；沒有符合名稱的測試不能算通過。每項列出的驗收句都是必須成立的條件。

## S01：正規化當月意願與衝突診斷

- [ ] 完成此任務。
- 驗收：fixed/off 日期與 ID 正規化且同一次運算只讀一次；同班 fixed/off 衝突及個人三班意願報錯。
- 依賴：無。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S01" tests/assignment-provenance.test.cjs`。

## S02：逐人 metadata 與指派新增入口

- [ ] 完成此任務。
- 驗收：新增/去重後 staff 與 metadata 一對一；不同人的 source 不互相覆寫。
- 依賴：S01。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S02" tests/assignment-provenance.test.cjs`。

## S03：指定班與小兒固定/代班鎖定

- [ ] 完成此任務。
- 驗收：個人指定及 PEDS 均不可移動；PEDS 同時遇個人指定保留單筆及兩種理由。
- 依賴：S02。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S03" tests/assignment-provenance.test.cjs`。

## S04：C/AC/A 階段接逐人來源

- [ ] 完成此任務。
- 驗收：指定 A 不被自動 A 覆寫；AC 與剩餘 A 分別保留來源且人選不變。
- 依賴：S03。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S04" tests/assignment-provenance.test.cjs`。

## S05：B 與週六階段接逐人來源

- [ ] 完成此任務。
- 驗收：同班 BC/AB/單節 B 可保留三種來源；週六 A/B 正確且人選不變。
- 依賴：S04。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S05" tests/assignment-provenance.test.cjs`。

## S06：依 ID 匯出來源並在刪除前驗證

- [ ] 完成此任務。
- 驗收：D/E/F 與 J/K/L 正確對應；缺 metadata/重複 ID 時尚未刪寫舊表。
- 依賴：S05。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs；tests/support/fake-sheets.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S06" tests/assignment-provenance.test.cjs`。

## S07：凍結來源修改前後等價回歸

- [ ] 完成此任務。
- 驗收：凍結同批 100 組輸入，人選/工時/班型完全不變；原覆蓋缺失保留為診斷，不在來源階段修補。
- 依賴：S06。
- 預計檔案：tests/assignment-provenance.test.cjs；tests/support/engine-harness.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S07" tests/assignment-provenance.test.cjs`。

檢查點：聚焦測試及 `node --test tests/*.test.cjs` 通過，`git diff --check` 無錯；先確認本階段產物，再進入依賴它的下一階段。

## F01：共用公平性統計

- [ ] 完成此任務。
- 驗收：自選單節排除、PEDS 非自願單節納入、指定雙班納入；引擎與測試對相同 context 統計一致。
- 依賴：S03。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs；tests/analyze-fairness.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F01" tests/fairness-adjustment.test.cjs`。

## F02：公平性向量與比較器

- [ ] 完成此任務。
- 驗收：S 依單節→AC→BC/AB同級→工時比較並符合手算；拒絕以低優先改善抵銷高優先惡化，同 S 不接受。
- 依賴：F01。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F02" tests/fairness-adjustment.test.cjs`。

## R01：分階段共同規則驗證

- [ ] 完成此任務。
- 驗收：意願/同時段/每日兩班/骨科上限共用驗證；最低覆蓋可依階段開啟，月底與週六規則正確。
- 依賴：S03。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R01" tests/coverage-repair.test.cjs`。

## R02：候選副本與原子提交

- [ ] 完成此任務。
- 驗收：成功整組更新 staff/metadata/歷程；失敗後原 context 與 constraints 完全不變。
- 依賴：R01；S02。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R02" tests/coverage-repair.test.cjs`。

## R03：同日移動及交換修補

- [ ] 完成此任務。
- 驗收：11/30 無休假缺 B、兩人同 AB 缺 C 的可交換小案例達標；L 嚴格下降且不破壞原覆蓋。
- 依賴：R02；F02。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R03" tests/coverage-repair.test.cjs`。

## R04：跨日及兩步組合修補

- [ ] 完成此任務。
- 驗收：跨日捐出班別仍有人；兩步組合只驗證/提交完整候選，鎖定及每日上限不破壞。
- 依賴：R03。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R04" tests/coverage-repair.test.cjs`。

## R05：新增班備援與搜尋停止診斷

- [ ] 完成此任務。
- 驗收：前兩層無改善才新增合法一班；可注入預算測出未找到/超時/輸入衝突，均不可誤報成功。
- 依賴：R04；D2 審閱。
- 預計檔案：scheduling_engine.js；Config_system.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R05" tests/coverage-repair.test.cjs`。

檢查點：聚焦測試及 `node --test tests/*.test.cjs` 通過，`git diff --check` 無錯；先確認本階段產物，再進入依賴它的下一階段。

## F03：保持每時段人數的公平性交換

- [ ] 完成此任務。
- 驗收：只接受 S 改善，修補後每日期班別站別人數與鎖定不變；公平性到限仍保留合格最佳解及停止原因。
- 依賴：R05；F02。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F03" tests/fairness-adjustment.test.cjs`。

檢查點：聚焦測試及 `node --test tests/*.test.cjs` 通過，`git diff --check` 無錯；先確認本階段產物，再進入依賴它的下一階段。

## I01：接入 generateSchedule 儲存前驗證

- [ ] 完成此任務。
- 驗收：初始/修補/公平性三段依序執行；最終未達標或資料不一致時零輸出寫入，錯誤有 code/details。
- 依賴：F03；S06。
- 預計檔案：scheduling_engine.js；tests/adjustment-integration.test.cjs；tests/support/fake-sheets.cjs。
- 聚焦驗證：`node --test --test-name-pattern="I01" tests/adjustment-integration.test.cjs`。

## I02：截止後重試與錯誤流程

- [ ] 完成此任務。
- 驗收：排班開始後各階段失敗明確還原到 CLOSED 並可再觸發，不重開/重設截止，PUBLISHED 禁止；還原本身失敗及部分 I/O 有獨立診斷。
- 依賴：I01。
- 預計檔案：flow_run.js；repo_core.js（如需）；tests/adjustment-integration.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="I02" tests/adjustment-integration.test.cjs`。

## I03：關閉後的後端提交限制與截止互斥

- [ ] 完成此任務。
- 驗收：processFtSubmission 僅 OPEN 可寫，舊頁在 CLOSED 提交被拒；提交狀態檢查/寫入與截止共用互斥機制，競爭測試無截止後誤寫。
- 依賴：I02。
- 預計檔案：web_entry.js；flow_run.js；tests/adjustment-integration.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="I03" tests/adjustment-integration.test.cjs`。

## V01：同批 100 組三段比較及耗時

- [ ] 完成此任務。
- 驗收：逐筆核對凍結 seed/events，三段結果與失敗全保留；報告覆蓋成功率、各公平性變化、候選/時間上限與耗時，不宣稱全域最優。
- 依賴：I03。
- 預計檔案：tests/evaluate-adjustments.cjs；tests/support/engine-harness.cjs；tests/README.md。
- 聚焦驗證：`TZ=Asia/Taipei node tests/evaluate-adjustments.cjs`。

## 完成判定

- [x] D1 優先序與 D3 失敗還原要求已依使用者指示更新（不是程式實作完成）。
- [ ] D2 搜尋預算初值已確認並完成量測。
- [ ] 來源等價、覆蓋修補及公平性改善分開驗證，不將原始最低覆蓋失敗混入來源修正驗收。
- [ ] 凍結 100 組全部列入報告；未達標及超時逐案回報，不能以測試程式本身通過宣稱排班全數合格。
- [ ] 所有硬條件驗證及假 Sheet 整合測試通過。
- [ ] 已回報量測結果及剩餘限制；未授權時不更新線上 Library。
