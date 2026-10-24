# 首次接軌正式專案比對

日期：2026-10-24（Asia/Taipei）。來源為維護者下載的 DDclinic_GAS_online_backup；維護者已確認此為正式專案，並要求本機程式與正式版本一致。

## 已整合差異

| 檔案 | 處理結果 |
|---|---|
| GAS/debug.js | 加入正式版 testAdminEmail() 管理員寄信測試函式；未執行寄信 |
| GAS/flows_run.js | 從 flow_run.js 更名，採正式版的每月 1 號註解與「大墩恆新骨科班表」通知文字；同步更新測試及現行文件引用 |
| GAS/scheduling_engine.js | 採正式版 v4.0 檔頭註解 |
| GAS/appsscript.json | 原樣使用正式專案下載的 manifest |

其餘 13 個 JavaScript／HTML 檔逐行一致（忽略換行格式）。整合後 16 個程式檔與 manifest 的檔名及逐行內容均與此次正式備份一致。

manifest 使用 Asia/Taipei、V8，dependencies 為空，Web App 設定 executeAs=USER_DEPLOYING、access=MYSELF。這是下載當時的專案設定，不代表已確認既有部署版本；實際觸發器排程須另查 GAS 設定，程式註解不會更改觸發器。

本機 .clasp.production.json 對應正式專案，rootDir 為 GAS，由 Git 忽略。未讀取登入憑證、未執行 push、未修改線上專案。

## 後續流程

- 將程式同步、manifest 與流程設定提交 PR，經另一位維護者核准並合併。
- 依 gas-deployment.md 設定 GitHub main 審查規則；同一份 checkout 使用 .clasp.test.json 設定 TEST Script ID，與正式設定分開。
- 未來正式部署須完成 TEST 驗證、更新 main、測試與部署檢查，再由 Robin 手動 push 並記錄版本。
