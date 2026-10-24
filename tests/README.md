# 測試與模擬

## 日常回歸測試

使用 Node.js 24，無外部 npm 相依。在專案根目錄執行：

```sh
TZ=Asia/Taipei node --test tests/*.test.cjs
```

`*.test.cjs` 是單元／整合回歸，`support/` 提供假 Google 服務與獨立稽核，`fixtures/` 保存固定輸入與問題重現案例。一般測試不需還原歷史結果，不寄信、不寫入真實試算表。

2026-10-24 整理後，本機執行上述命令：203／203 通過；未啟動大型模擬或遠端部署。

核心覆蓋包括意願來源與鎖定、休假模型、最低覆蓋、工作日修補／保護、公平性、週六最大配對、報告信與截止重試。測試結果只代表本機驗證，GAS 權限、配額與實際 I/O 仍須 TEST 環境驗收。

## 擴大模擬

現行工具為 `generate-expanded-inputs.cjs`、`evaluate-expanded.cjs`、`merge-expanded.cjs`、`summarize-expanded.cjs` 與 `estimate-expanded-cost.cjs`。操作、固定輸入與成本門檻見 [EXPANDED_TESTING.md](EXPANDED_TESTING.md)。

現有 GitHub workflow 僅手動啟動 200 組前導及 5,000 組正式測試。PR 自動測試僅列[待辦](../tasks/todo.md)。依既有紀錄，工作日修補版本尚需新的雲端前導與正式驗收，不能以舊結果放行。

## 歷史比較工具與結果

`evaluate-adjustments.cjs`、`evaluate-saturday-allocation.cjs`、`evaluate-saturday-pairing.cjs` 及對應摘要／診斷工具，保留供歷史比較。執行前先依[封存說明](results/archive/README.md)還原 JSON。這些工具會寫入既有 results 路徑，請在獨立工作目錄執行，以免覆寫歷史報告；目前程式重跑也不等於重現舊版本算法。

[歷史 400 組報告](results/summary.md)記錄 2026-10-20 的版本，不代表後續工作日修補已通過同樣驗收。歷次命令與開發過程見 [HISTORY.md](HISTORY.md)，其中數字與狀態均屬當時紀錄。

保留 `analyze-fairness.cjs`（仍被測試引用）、`fairness-paired-rotation-100-2026-11.json`、全部 fixtures 及診斷工具。三組 `baseline-3-*` 先導輸出已清除，不影響正式四種各 100 組的封存資料。
