# ClinicScheduling 診所排班系統

以 Google Apps Script（GAS）與 Google Sheets 建立的診所排班系統，包含正職意願填寫、骨科／小兒排班、覆蓋與工作日修補、公平性調整、前台試算表匯出及完成報告信。目前測試情境以五位正職為主。

## 從哪裡開始

- 了解排班規則與設計：[規格索引](tasks/README.md)。
- 修改程式與本機驗證：[測試說明](tests/README.md)。
- 共同修改與部署：[貢獻指南](CONTRIBUTING.md)。
- 查詢尚未完成的工作：[待辦事項](tasks/todo.md)。
- 查詢歷次模擬：[歷史報告](tests/results/summary.md)及[原始結果封存](tests/results/archive/README.md)。歷史報告不是目前版本通過驗收的證明。

## 本機驗證

使用 Node.js 24（與現有 workflow 相同主版本），無須安裝 npm 套件。在專案根目錄執行：

```sh
TZ=Asia/Taipei node --test tests/*.test.cjs
```

測試使用假的 Google 服務與試算表，不寄出真實郵件，也不修改線上資料。GAS 正式程式不能直接當成 Node 應用程式啟動。

## 程式結構

Google Apps Script 的 JavaScript 與 HTML 統一放在 [`gas/`](gas/)；下表程式檔名皆相對於此資料夾。測試與文件保留在專案根目錄的各自資料夾。

| 檔案 | 用途 |
|---|---|
| `Config_system.js` | Script Properties、工作表名稱、班別與動態設定 |
| `web_entry.js`、`FT_Portal.html` | 正職意願填寫 Web App |
| `flow_run.js` | 月份任務、開放／關閉填寫與截止後排班流程 |
| `repo_*.js` | 員工、意願、任務及試算表讀寫／匯出 |
| `scheduling_engine.js` | 排班流程與初始分配 |
| `scheduling_assignments.js` | 逐人來源、固定班與意願鎖定 |
| `scheduling_saturday.js` | 週六分配與最大可行 AB 配對 |
| `scheduling_adjustments.js`、`scheduling_fairness.js` | 覆蓋／工作日修補與公平性 |
| `scheduling_report.js`、`notify_email.js` | 完成報告與通知信 |
| `debug.js` | 手動診斷函式；執行前確認其日期與人員設定 |
| `tasks/`、`tests/` | 規格、待辦及本機測試，不上傳為 GAS 程式 |

## GAS 設定與驗證邊界

目前儲存庫不是一鍵部署套件，未包含完整試算表範本、GAS manifest 或外部管理選單專案。接手部署時須先取得既有 TEST 環境結構，核對各 repo 模組使用的欄位與版面；不要只依工作表名稱建立空白表。

後端專案須設定以下 Script Properties：

| 名稱 | 用途 |
|---|---|
| `BACKEND_SHEET_ID` | 後端資料試算表 |
| `FRONTEND_SHEET_ID` | 前台匯出試算表 |
| `ADMIN_EMAIL` | 管理通知與排班完成報告收件人 |

後端工作表名稱見 `CONFIG.SHEET_NAMES`：`Run_Control`、`Staff`、`FT_Requests`、`PT_Availability`、`System_Configurations`、`Schedule_Output`。部分 repo 從第三列讀取資料，匯出另依賴既有版面，須保留原結構。動態設定的班別、人員與休診日由 `RulesConfig` 載入。

部署時需完整同步 `gas/` 內的正式 JS 模組與 HTML，保留 Spreadsheet／Mail 等所需授權，核對專案時區與觸發器。更新 Library 版本與 Web App、觸發器或外部選單的連結方式，須在 TEST 環境確認；目前文件未完整描述這些外部設定。

本機測試不能確認 GAS 實際權限、Library LockService 範圍、執行時間配額或真實 Spreadsheet I/O。先在 TEST 環境確認填寫、截止重試、排班、匯出與寄信，再處理正式部署。正式 GAS 暫由 Robin 部署，共同維護與交接方式見 [貢獻指南](CONTRIBUTING.md)。

## 完成報告信

`CoreSystem.closeFtWindow()` 在排班與前台匯出成功後，以最終 context 寄送 HTML 報告至 `ADMIN_EMAIL`；重排成功也會寄送。報告包含工時、達成率、單節與每週班型、早晚班及週六分配。

寄信失敗回傳「排班已完成、報告未寄出」警告，不還原已完成班表；目前無自動補寄。排班或匯出失敗不寄完成信。資料寫入並非跨 Sheet 原子交易，狀態還原不等於舊班表已恢復。

## 公開準備狀態

PR 自動測試暫緩，現有大型模擬只手動啟動。共同維護與部署約定已記錄於 [CONTRIBUTING.md](CONTRIBUTING.md)；程式碼採用 [MIT License](LICENSE)。靜態檢查範圍、限制與確認結果見[檢查紀錄](docs/publication-review.md)；其餘工作見[待辦](tasks/todo.md)。

## 授權

本專案程式碼與隨附文件採用 [MIT License](LICENSE)，允許使用、修改、散布及商用，須保留著作權與授權聲明；軟體依原樣提供，不提供擔保。正式條文見 LICENSE。

此授權不提供診所資料、員工個資、Google 帳號、試算表或正式部署環境的存取權。
