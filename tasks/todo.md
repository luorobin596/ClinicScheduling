# 可驗證的小型任務：來源 → 覆蓋 → 公平性

## 待審新增任務：擴大測試 EX01～EX07（2026-10-20）

規格：[expanded-simulation-spec.md](expanded-simulation-spec.md)。2026-10-20 已依授權編寫 EX01～EX05 與 EX06 成本估算工具，並新增測試案例；依使用者指示只做語法／差異檢查，沒有執行任何測試、生成樣本或模擬。所有驗收框保留未勾選，程式存在不表示已驗證。實際入口與檔案以 tests/EXPANDED_TESTING.md 為準；2026-10-21 已編寫手動前導 GitHub workflow，未推送／啟動；雲端前導及 EX07 未執行。原有完成項目保留於後文。

### EX01：月份與休診日曆（小，1～2 檔）

- [ ] 驗收：三月基本月休為 10／11／9，自行安排均 8 半天；10/09、10/10、10/26 休診，普通週六可營業。
- [ ] 驗收：週日與假日去重，完整週／短週與跨月邊界正確。
- 驗證：`node --test tests/expanded-calendar.test.cjs`，逐日核對已確認日曆。
- 依賴：無。預計檔案：tests/support/expanded-calendar.cjs、tests/expanded-calendar.test.cjs。

### EX02：可重現情境及額度（中，3～4 檔）

- [ ] 驗收：三休假模式、連休 A／B、兩人同／異週與週六群均產生正確原始意願；額外假與基本假不重複。
- [ ] 驗收：200／5,000／10,000 三份 manifest 總數與配額正確、逐層子集一致、ID 唯一，同種子逐字一致；不出現兩位小兒人員同週連休，且人選輪替有分布統計。
- 驗證：`node --test tests/expanded-fixtures.test.cjs`，再只生成 manifest 核對 200／5,000／10,000 三版，不執行排班。
- 依賴：EX01。預計檔案：tests/support/expanded-fixtures.cjs、tests/expanded-fixtures.test.cjs、tests/generate-expanded-inputs.cjs、tests/fixtures/expanded-manifest.json。

檢查點：確認配額與模式例外已由使用者審閱，日曆及額度測試通過，才執行模擬。

### EX03：單組執行與獨立驗證（中，3 檔）

- [ ] 驗收：初始／修補／最終保存統計、來源、預算及停止原因；獨立驗證硬限制、休診零排班、配對與公平性不劣化。
- [ ] 驗收：負向案例正確識別輸入衝突；搜尋到限與輸入無解分開，失敗不替換。狀態機證據沿用假 Sheet 測試。
- 驗證：`node --test tests/expanded-evaluation.test.cjs`，每情境少量執行並人工核對失敗樣本。
- 依賴：EX02。預計檔案：tests/support/expanded-audit.cjs、tests/evaluate-expanded.cjs、tests/expanded-evaluation.test.cjs。

### EX04：三月報告及個人可排目標（中，3 檔）

- [ ] 驗收：零目標 N/A、國定假日短週與週六排除正確；AC／C／早班欄口徑不改，連休者分母按原始意願。
- [ ] 驗收：成功／衝突分母與個人結果可追溯，未成功樣本不混入公平性平均；summary.md 直接包含最終月平均、逐週 AC／C／早班及週六分配表，不顯示前後比較；原始階段與分位數保留 JSON 診斷。
- 驗證：`node --test tests/expanded-report.test.cjs`，小型手算資料核對比率平均與分位數。
- 依賴：EX03 輸出格式。預計檔案：tests/summarize-expanded.cjs、tests/expanded-report.test.cjs、tests/support/weekly-report.cjs（必要時）。

### EX05：分批與中斷重跑（中，3 檔）

- [ ] 驗收：相同 manifest 分批／合併不遺失、不重複；缺批、輸入／引擎版本不符明確拒絕完整報告。
- [ ] 驗收：逐組結果落檔，重跑保留嘗試紀錄；舊 400 組證據不覆寫。
- 驗證：`node --test tests/expanded-shards.test.cjs`，注入中斷、重複及缺批後核對。
- 依賴：EX03、EX04。預計檔案：tests/evaluate-expanded.cjs、tests/merge-expanded.cjs、tests/expanded-shards.test.cjs。

檢查點：完整現有測試與新聚焦測試通過；先完成本機小樣本核對；雲端僅先跑 200 組前導，未選定正式規模前不得啟動 5,000／10,000 組。

### EX06：GitHub Actions 200 組前導及成本估算（小，2 檔）

- [ ] 驗收：私人儲存庫 Linux hosted runner 手動觸發、固定時區及 Node 版本，無 Google 憑證；限制並行、逾時及產物保留期限。
- [ ] 驗收：200 組雲端前導完整對帳、硬限制零違規、8 個負向案例正確拒絕；未解釋搜尋失敗及程式錯誤先調查，不得標示通過。
- [ ] 驗收：依實際各分層耗時、job 取整分鐘、合併時間與儲存量，估算 5,000／10,000 兩版及含 30% 運算餘裕的成本；先回報，再由使用者決定規模。
- 驗證：雲端前導產物核對及成本公式手算；未完成規模選擇不得觸發正式工作，搜尋時間到限差異須披露。
- 依賴：EX05、可用 GitHub 私人儲存庫。預計檔案：.github/workflows/expanded-simulation.yml、tests/README.md。

### EX07：完整執行與結果交付（小，報告／資料）

- [ ] 驗收：使用者選定的 5,000 或 10,000 個唯一案例全部有結果，失敗與未完成不得隱藏；按群／月／模式與預期衝突分開統計。
- [ ] 驗收：摘要、逐組指標、凍結輸入與最差案例可追溯，完整披露公平性取捨與搜尋上限。
- 驗證：完整 manifest 對帳、獨立稽核結果及報告人工審閱。
- 依賴：EX06 前導通過、完成成本回報，且使用者明確選定正式 5,000 或 10,000 組；正式批重跑前導子集，不混算重複案例。預計檔案：tests/results/expanded-2026-09-11/ 下的獨立資料與報告；不覆寫舊結果。

---

狀態：2026-10-19 已依使用者授權完成本機實作與驗證；尚未更新線上 Library。證據及限制見 tests/results/summary.md。
來源規格：staff-assignment-provenance-spec.md；覆蓋/公平性規格：coverage-fairness-spec.md。

已先建立失敗案例，再依序實作。為控制 scheduling_engine.js 複雜度，指派、統計及搜尋分別放入 scheduling_assignments.js、scheduling_fairness.js、scheduling_adjustments.js。下列檔案清單為原預估，實際分工及驗證入口見 tests/README.md；每項驗收句仍須成立。

## S01：正規化當月意願與衝突診斷

- [x] 完成此任務。
- 驗收：fixed/off 日期與 ID 正規化且同一次運算只讀一次；同班 fixed/off 衝突及個人三班意願報錯。
- 依賴：無。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S01" tests/assignment-provenance.test.cjs`。

## S02：逐人 metadata 與指派新增入口

- [x] 完成此任務。
- 驗收：新增/去重後 staff 與 metadata 一對一；不同人的 source 不互相覆寫。
- 依賴：S01。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S02" tests/assignment-provenance.test.cjs`。

## S03：指定班與小兒固定/代班鎖定

- [x] 完成此任務。
- 驗收：個人指定及 PEDS 均不可移動；PEDS 同時遇個人指定保留單筆及兩種理由。
- 依賴：S02。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S03" tests/assignment-provenance.test.cjs`。

## S04：C/AC/A 階段接逐人來源

- [x] 完成此任務。
- 驗收：指定 A 不被自動 A 覆寫；AC 與剩餘 A 分別保留來源且人選不變。
- 依賴：S03。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S04" tests/assignment-provenance.test.cjs`。

## S05：B 與週六階段接逐人來源

- [x] 完成此任務。
- 驗收：同班 BC/AB/單節 B 可保留三種來源；週六 A/B 正確且人選不變。
- 依賴：S04。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S05" tests/assignment-provenance.test.cjs`。

## S06：依 ID 匯出來源並在刪除前驗證

- [x] 完成此任務。
- 驗收：D/E/F 與 J/K/L 正確對應；缺 metadata/重複 ID 時尚未刪寫舊表。
- 依賴：S05。
- 預計檔案：scheduling_engine.js；tests/assignment-provenance.test.cjs；tests/support/fake-sheets.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S06" tests/assignment-provenance.test.cjs`。

## S07：凍結來源修改前後等價回歸

- [x] 完成此任務。
- 驗收：凍結同批 100 組輸入，人選/工時/班型完全不變；原覆蓋缺失保留為診斷，不在來源階段修補。
- 依賴：S06。
- 預計檔案：tests/assignment-provenance.test.cjs；tests/support/engine-harness.cjs。
- 聚焦驗證：`node --test --test-name-pattern="S07" tests/assignment-provenance.test.cjs`。

檢查點：聚焦測試及 `node --test tests/*.test.cjs` 通過，`git diff --check` 無錯；先確認本階段產物，再進入依賴它的下一階段。

## F01：共用公平性統計

- [x] 完成此任務。
- 驗收：自選單節排除、PEDS 非自願單節按月累計，指定雙班納入每週班型；引擎與測試對相同 context 及週切分一致。
- 依賴：S03。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs；tests/evaluate-adjustments.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F01" tests/fairness-adjustment.test.cjs`。

## F01b：個人應排工時與達成率

- [x] 完成此任務。
- 驗收：只依完整原始休假日期/額度計算 C，半天/全天/指定雙班分別扣 1/2/0，C=168/144、H=140/120 的比例相同；零分母 N/A、H>0 的零基準報錯，空班不降低分母。
- 依賴：F01。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs；tests/evaluate-adjustments.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F01b" tests/fairness-adjustment.test.cjs`。

## F02：公平性向量與比較器

- [x] 完成此任務。
- 驗收：S 依月單節→月工時達成率→週AC→週BC/AB同級比較，符合手算；個人月合計相同但週分配不同能區分，低優先不得抵銷高優先惡化，同 S 不接受。
- 依賴：F01b。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F02" tests/fairness-adjustment.test.cjs`。

## R01：分階段共同規則驗證

- [x] 完成此任務。
- 驗收：意願/同時段/每日兩班/骨科上限共用驗證；最低覆蓋可依階段開啟，月底與週六規則正確。
- 依賴：S03。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R01" tests/coverage-repair.test.cjs`。

## R02：候選副本與原子提交

- [x] 完成此任務。
- 驗收：成功整組更新 staff/metadata/歷程；失敗後原 context 與 constraints 完全不變。
- 依賴：R01；S02。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R02" tests/coverage-repair.test.cjs`。

## R03：同日移動及交換修補

- [x] 完成此任務。
- 驗收：11/30 無休假缺 B、兩人同 AB 缺 C 的可交換小案例達標；L 嚴格下降且不破壞原覆蓋。
- 依賴：R02；F02。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R03" tests/coverage-repair.test.cjs`。

## R04：跨日及兩步組合修補

- [x] 完成此任務。
- 驗收：跨日捐出班別仍有人；兩步組合只驗證/提交完整候選，鎖定及每日上限不破壞。
- 依賴：R03。
- 預計檔案：scheduling_engine.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R04" tests/coverage-repair.test.cjs`。

## R05：新增班備援與搜尋停止診斷

- [x] 完成此任務。
- 驗收：前兩層無改善才新增合法一班；可注入預算測出未找到/超時/輸入衝突，均不可誤報成功。
- 依賴：R04；D2 工程初值與量測（見完成判定）。
- 預計檔案：scheduling_engine.js；Config_system.js；tests/coverage-repair.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="R05" tests/coverage-repair.test.cjs`。

檢查點：聚焦測試及 `node --test tests/*.test.cjs` 通過，`git diff --check` 無錯；先確認本階段產物，再進入依賴它的下一階段。

## F03：保持每時段人數的公平性交換

- [x] 完成此任務。
- 驗收：只接受 S 改善，修補後每日期班別站別人數與鎖定不變；公平性到限仍保留合格最佳解及停止原因。
- 依賴：R05；F02。
- 預計檔案：scheduling_engine.js；tests/fairness-adjustment.test.cjs。
- 聚焦驗證：`node --test --test-name-pattern="F03" tests/fairness-adjustment.test.cjs`。

檢查點：聚焦測試及 `node --test tests/*.test.cjs` 通過，`git diff --check` 無錯；先確認本階段產物，再進入依賴它的下一階段。

## I01：接入 generateSchedule 儲存前驗證

- [x] 完成此任務。
- 驗收：初始/修補/公平性三段依序執行；最終未達標或資料不一致時零輸出寫入，錯誤有 code/details。
- 依賴：F03；S06。
- 預計檔案：scheduling_engine.js；tests/adjustment-integration.test.cjs；tests/support/fake-sheets.cjs。
- 聚焦驗證：`node --test --test-name-pattern="I01" tests/adjustment-integration.test.cjs`。

## I02：截止後重試與錯誤流程

- [x] 完成此任務。
- 驗收：排班開始後各階段失敗明確還原到 CLOSED 並可再觸發，不重開/重設截止，PUBLISHED 禁止；還原本身失敗及部分 I/O 有獨立診斷。
- 依賴：I01。
- 預計檔案：flow_run.js；repo_core.js（如需）；tests/adjustment-integration.test.cjs。
- 聚焦驗證：`node --test tests/flow-retry.test.cjs`。

## I03：關閉後的後端提交限制與截止互斥

- [x] 完成此任務。
- 驗收：processFtSubmission 僅 OPEN 可寫，舊頁在 CLOSED 提交被拒；提交狀態檢查/寫入與截止共用互斥機制，競爭測試無截止後誤寫。
- 依賴：I02。
- 預計檔案：web_entry.js；flow_run.js；tests/adjustment-integration.test.cjs。
- 聚焦驗證：`node --test tests/flow-retry.test.cjs`。

## V01：同批 100 組三段比較及耗時

- [x] 完成此任務。
- 驗收：逐筆核對凍結 seed/events，三段結果與失敗全保留；報告覆蓋成功率、各公平性變化、候選/時間上限與耗時，不宣稱全域最優。
- 依賴：I03。
- 預計檔案：tests/evaluate-adjustments.cjs；tests/support/engine-harness.cjs；tests/README.md。
- 聚焦驗證：`TZ=Asia/Taipei node tests/evaluate-adjustments.cjs`。

## 完成判定

- [x] D1 優先序與 D3 失敗還原要求已依使用者指示更新（不是程式實作完成）。
- [x] D2 採用工程初值 20,000 候選／200 次接受／共享 10 秒，已完成 Node 本機量測；不代表使用者另行核准數值或線上 GAS 效能已確認。
- [x] 來源等價、覆蓋修補及公平性改善分開驗證，不將原始最低覆蓋失敗混入來源修正驗收。
- [x] 凍結 100 組全部列入報告；未達標及超時逐案回報，不能以測試程式本身通過宣稱排班全數合格。
- [x] 所有硬條件驗證及假 Sheet 整合測試通過。
- [x] 已回報量測結果及剩餘限制；未授權時不更新線上 Library。

## 交付證據

`node --test tests/*.test.cjs`：109／109。V01 另跑原同批 100 組及新增三種情境各 100 組；統計與逐案結果見 [測試報告](../tests/results/summary.md)。線上 GAS 整合仍待 TEST 專案驗證，不列為本機完成項。
