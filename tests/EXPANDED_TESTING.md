# 擴大測試工具操作說明

最新狀態（2026-10-21）：兩個正式引擎缺口已在本機修復，全套測試 188／188 通過；尚未執行新版雲端前導或正式模擬。既有 400／5,000 組報告保留。下方原始操作命令仍供後續手動執行；本輪新版驗證要求見本文末節。原擴大測試規格見 [expanded-simulation-spec.md](../tasks/expanded-simulation-spec.md)。

## GitHub 網頁操作：由使用者推送與啟動

### 已選定正式測試：5,000 組，同時 4 批

2026-10-21 使用者已選擇 5,000 組、同時 4 批。新增 `.github/workflows/formal-simulation-5000.yml`，網頁名稱為 **Clinic scheduling - 5000 cases (4 parallel)**，只手動啟動。參數記錄在 `.github/formal-test-plan.json`，不提供 10,000 組選項。推送由使用者執行；這次設定工作沒有啟動雲端測試。

推送到預設分支後：Actions → Clinic scheduling - 5000 cases (4 parallel) → Run workflow。流程會讀取通過的前導 run **39539952715／attempt 1** 的 `pilot-report` 產物，檢查原始輸入政策、引擎／工具雜湊、時區與搜尋預算，並使用該前導的精確 Node 版本。若不符或前導產物已過期，明確中止，需先重跑前導並更新計畫的 run ID。

驗證通過才生成一次 5,000 組輸入，並核對前導 200 組確實為內容未變的子集。分為 **50 批，每批 100 組，max-parallel=4**。既有評估入口的成本門檻仍保留：套件中的 `cost-estimate.json` 是本次對話已審閱的規劃估算（來源有明確標記），綁定前導 identity；不是假造逐 job 實測帳單。約 400 個運算分鐘的預算是規劃值，不是 GitHub 帳號的強制支出上限。

前導只作驗證依據，正式批會完整重新執行 5,000 組，不把前導重複加進正式分母。最終要求 4,800 組一般／壓力案例成功、200 組預期衝突正確拒絕，且沒有缺組或待調查。`pilotPassed` 僅供 200 組前導使用；正式產物另有 `formalPassed`，摘要顯示「正式測試通過」。

完成後下載 `formal-report-執行編號-嘗試編號`，開啟 `report/summary.md`。產物包含 package/ 的凍結輸入、前導 metadata 及成本審閱計畫，以及 shards/ 原始紀錄與報告，保留 7 天。各批失敗仍盡量上傳資料。重跑同一 run 的失敗工作時沿用 prepare 實際產生的輸入產物名稱，合併該 run 不同嘗試的紀錄並去重；不得跨不同 run／版本混合。

此工作流程只新增 GitHub 設定及計畫，不改測試引擎或已通過前導的工具內容，避免因改變工具雜湊而使既有前導失效。

### 200 組前導工作流程

工作流程位於 `.github/workflows/expanded-simulation.yml`，顯示名稱為 **Clinic scheduling - 200-case pilot**。只設定 `workflow_dispatch`，沒有 push／pull_request／排程觸發，推送程式本身不會執行測試，也沒有正式 5,000／10,000 組選項。

1. 將工作流程與測試工具提交並推送到 GitHub 儲存庫的預設分支。此步由使用者自行執行。
2. 開啟儲存庫 → Actions → Clinic scheduling - 200-case pilot → Run workflow，選擇含完整程式的分支，再手動啟動。
3. 流程先在 Linux 執行 `node --test tests/*.test.cjs`。這是單元／假服務整合驗證，不會重跑歷史 400 組模擬。通過後才凍結 200 組前導輸入。
4. 分 4 批各 50 組、同時最多 2 批，然後合併、獨立驗證及產生報告。整個流程同時最多執行一輪，重複手動啟動可能進入等待。
5. 完成後開啟該次 run，從 Artifacts 下載 `pilot-report-執行編號-嘗試編號`。含 `report/summary.md`、`report/reports/`、`inputs/pilot.json.gz`、`shards/` 原始紀錄及診斷日誌。產物保留 7 天；需長期追溯者請自行下載保存。

prepare 會解析一次 Node 22 的精確版本，其餘工作使用相同版本；全部採 Asia/Taipei 時區及同一 commit。失敗會盡量保存已落檔的資料，最終不合格會讓整個 workflow 顯示失敗；不要只看單個 shard 綠燈。取消或主機被強制終止時，無法保證來得及上傳所有資料。

2026-10-21：三個下載步驟改用 `actions/download-artifact@v7`，其動作執行環境為 Node 24，修正 v6 宣告 Node 20 導致的棄用警告。這與 `setup-node` 設定的排班測試 Node 22 分開；測試版本與抽樣／公平性規則不變。參考 [官方 v7 發行說明](https://github.com/actions/download-artifact/releases/tag/v7.0.0)。此修改不會更新已啟動的 run，也未由助理推送或重跑。

若程式驗證先失敗，200 組前導不會開始；請下載 `pilot-validation-...` 的 tests.log。若前導／合併失敗，請下載 `pilot-shard-...` 或 `pilot-report-...`，保留原失敗證據後再修正。重新執行整輪會產生新的嘗試產物；不與前一次自動混合。

這份 workflow 不會讀取 Google 憑證、不部署 GAS、不修改儲存庫或自動推送。成本計算仍依下方「成本回報與放大門檻」核對執行完成後的實際時間及上傳量；目前未加入自動費率查詢或正式批工作。

## 三種規模

- 前導 200：三月各 64 個正常／壓力案例，加 3／3／2 個週六全休負向案例。
- 正式 5,000：4,800 個正常／壓力案例、200 個負向案例。
- 正式 10,000：9,600 個正常／壓力案例、400 個負向案例。
- 200 是 5,000 的分層子集；5,000 是 10,000 的分層子集。相同 sampleId 對應相同意願，不用排班結果篩選輸入。

三月基本月休為 10／11／9 天，可自行安排均 8 半天。完整額外連休保留週外的基本額度，再加上該週原營業日；兩人小兒不能同週連休。指定週六的全天休屬「全半天」模式例外，標籤保留。輸入衝突不換種子。

### 新版協調模型：200／5,000／10,000 全部適用

三種規模都透過同一個 `generateFixture` 產生，政策標記為 `COORDINATED_ORIGINAL_INTENT_V2`。先按原始請假／指定班、小兒固定班及代班規則做每日可行性檢查：小兒每個必要時段須有人可值、指定班不能超出骨科上限，且原始人力能合法滿足每日最低骨科覆蓋。這裡只執行固定班填入與原始意願的日可行性驗證，不呼叫自動平日／週六分配、修補或公平性搜尋。

固定該樣本的月份、休假模式、強制連休對象與週別、指定週六及全天休人數，僅重新抽樣其餘原始意願。每組最多 1,000 次，達上限明確報 INPUT_GENERATION_EXHAUSTED，不能偷換情境或縮減樣本數。輸入內 `sampling` 保存採用的候選種子、嘗試序號、退回數及每次退回原因／請求雜湊；可由 `generateCandidate` 重現被退回的意願。條件通過後才凍結正式輸入，正式排班失敗不得再換樣本。

刻意週六五人全休的負向案例，只豁免該營業週六的最低覆蓋檢查；其他日期仍須滿足同一套輸入條件。因此不能再以其他日期先發生的小兒衝突代替完整月的預期週六拒絕。

舊前導結果保留，新三種規模都需生成新的 manifest。執行器拒絕舊模型的 manifest；新版樣本若仍在排班時遇到一般 INPUT_CONFLICT，合併器會列為待調查，不能自動視為前導通過。重新跑新版 200 組前導後才能估算正式成本，舊前導的成功率及耗時不直接沿用。

## 日後驗證命令（目前未執行）

```sh
TZ=Asia/Taipei node --test tests/expanded-*.test.cjs
TZ=Asia/Taipei node --test tests/*.test.cjs
```

## 只生成凍結輸入，不排班

```sh
node tests/generate-expanded-inputs.cjs --size 200 --out tests/results/expanded-2026-09-11/inputs/pilot.json.gz
node tests/generate-expanded-inputs.cjs --size 5000 --out tests/results/expanded-2026-09-11/inputs/formal-5000.json.gz
node tests/generate-expanded-inputs.cjs --size 10000 --out tests/results/expanded-2026-09-11/inputs/formal-10000.json.gz
```

所有輸出要求新路徑，拒絕覆寫既有證據。manifest 內有逐組及全批雜湊；不需 Google 憑證。

## 前導分批執行

200 組拆成 4 批各 50，工作編號為 0～3；各工作只執行自己這一批。下面只是第 0 批示例，另外三批須改 --shard 參數。

```sh
TZ=Asia/Taipei node tests/evaluate-expanded.cjs --manifest tests/results/expanded-2026-09-11/inputs/pilot.json.gz --out tests/results/expanded-2026-09-11/pilot-records --shards 4 --shard 0
```

僅傳入 --manifest／--out 預設一次執行整批；雲端必須明確傳入 --shards／--shard。中斷後可以相同分批參數加 `--resume true`，完整終態略過，其他結果重試並保留舊紀錄。不可換 manifest、Node 精確版本、時區、引擎／工具或搜尋預算後接續舊結果。各組即時壓縮落檔，不等整批結束才保存。

每批 job JSON 記錄 attempt ID 與程式內 elapsedMs。雲端日後設定下載產物時保留 shard 子目錄，並將失敗／中斷工作已落檔結果一併取回。執行器錯誤會在逐組狀態顯示；合併檢查才判斷前導通過與否，單一 Node 程序正常結束不代表全部案例合格。

## 合併與報告

```sh
node tests/merge-expanded.cjs --manifest tests/results/expanded-2026-09-11/inputs/pilot.json.gz --input tests/results/expanded-2026-09-11/pilot-records --out tests/results/expanded-2026-09-11/pilot-report
node tests/summarize-expanded.cjs --input tests/results/expanded-2026-09-11/pilot-report
```

缺組會產生 completed=false 的報告並以非零狀態結束；不是完整成功。合併檢查雜湊與來源，不重複計算重試案例；採最新嘗試，其他嘗試保留於索引。未知狀態、程式錯誤與未說明的搜尋失敗不能通過前導。三個月份都至少須有一組成功班表，避免全部輸入衝突仍稱通過。

`summary.md` 保留情境狀態，並直接放入與原 400 組報告形式一致的每人月平均、每人每週 AC／C／早班、週六最終 AB／單 A／單 B／未排班表，以及最終配對稽核與平均耗時。依使用者 2026-10-21 要求，成果表只顯示最終平均值，不顯示前後比較；`reports/` 是各月／情境／模式的相同最終表格與逐組診斷。零目標 N/A、部分有效 n、短週實際次數規則不變。`statistics.json` 仍保留各階段均值／中位數／P90／P95／最大值及最差種子供追查，不把原始診斷資料移除。`summary.ndjson.gz` 逐組保存狀態及統計；原始 result 壓縮檔保留成功班表、來源及失敗階段班表。正式統計不覆寫舊 400 組報告。這次只改產生程式，沒有新增已生成報告或重跑測試。

新增綜合表：全部成功月班表各算一筆，按員工計算月工時達成率、實際／應排工時及非自願／自願／總單節次數，不先把不同情境的平均等權平均。綜合每週表將所有成功週樣本合併，完整五平日週列達成率，短週按 1／2／3／4 個營業平日分列實際次數，不把次數與百分比混算；沒有營業平日的週排除，個人整週請假仍保留，零目標只排除比率分母。表內列樣本 n，JSON 的 combined 欄保存對應統計。

失敗原因直接列在 summary.md 與各情境詳細報告：包含狀態、錯誤碼、發生階段、原始訊息、日期、員工、sampleId、seed 及詳細診斷；預期拒絕與一般輸入衝突分開統計。原始紀錄缺少的日期／員工不猜測；訊息中的換行與表格分隔符會轉義，避免破壞表格。

負向案例除完整月失敗外，另以該營業週六的原始意願呼叫正式日可行性驗證器，確認確實為零骨科可用人員；避免其他日期先衝突就誤稱週六拒絕已驗證。此 probe 是測試工具的診斷，沒有改變正式引擎排班流程。

## 成本回報與放大門檻

雲端前導後，複製 `expanded-usage.example.json`，填入每個 evaluator attempt 對應的 GitHub 實際完整 job 毫秒數（含 setup／checkout／上傳），其他工作時間、上傳產物大小與保存天數，並查核當時官方費率。範例的 0／placeholder 刻意不可用。可選填 `remainingFreeMinutes`、`remainingFreeStorageBytes`，均指前導完成後帳號當下剩餘免費額度；省略就只列假設情境，不冒充已讀取帳號額度。

```sh
node tests/estimate-expanded-cost.cjs --input tests/results/expanded-2026-09-11/pilot-report --usage /path/to/observed-usage.json
```

估算逐層加權，負向案例按月合併模式估算；按每個正式批次向上取整分鐘，另外計算工作啟動及合併成本。輸出兩版成本、前導＋正式總用量、30% 運算餘裕及儲存近似值。實際雲端測試環境與產物大小尚待前導量測，不能依本機時間保證費用。

只有使用者看過通過的前導及成本報告並選定規模後，才使用以下正式示例（第 0／50 批）；10,000 組改成對應 manifest、確認數字與 100 批：

```sh
TZ=Asia/Taipei node tests/evaluate-expanded.cjs --manifest tests/results/expanded-2026-09-11/inputs/formal-5000.json.gz --out tests/results/expanded-2026-09-11/formal-5000-records --shards 50 --shard 0 --confirm-formal-size 5000 --pilot-report tests/results/expanded-2026-09-11/pilot-report
```

正式入口會要求通過的前導、相同引擎／工具／Node／時區／預算、已產生的成本審閱紀錄及明確規模參數。重新完整執行所選正式樣本，不把前導重複加進案例分母。已提供手動 200 組前導與 5,000 組正式 workflow；助理未遠端上傳或啟動。

## 2026-10-21：兩個缺口修復後的驗證狀態

最低覆蓋新增原子「移班＋補回」候選；公平性調整保留修補後的平日工作日。全套本機測試 188／188 通過，含正式失敗案例與使用者實際意願的回歸。這不等同新版已通過雲端 200／5,000 組。

新增 `weekdayWorkdays` 診斷（schema：weekday-workdays-v1），保留 initial／repaired／final 空班清單；獨立 audit 比對修補後工作日，若 final 遺失則不能列為 VALID。summary 只呈現 final：未請假整天空班總筆數、涉及樣本數、每員工平均月空班日數及日期／員工／來源明細。既有空班與週六輪休分開；歷史結果沒有此欄位時顯示未稽核，不當作零筆。

**下次先手動執行新版 200 組前導。** 新引擎及工具 hash 已不同，舊前導 39539952715 不可用於新版正式批。確認新版前導結果及 Usage 後，再更新 formal-test-plan.json 的 pilotRunId／pilotAttempt 與成本審閱資訊；不得略過 workflow 的身分一致性檢查。此輪未更新綁定，也未啟動工作流程。

舊正式 5,000 組報告保持原樣。若後續重跑，逐組沿用原凍結意願並核對 inputHash，不能換樣本迴避失敗；舊結果是否已有空班須另外稽核，不能因為過去列 VALID 就推定沒有。
