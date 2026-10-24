# 共同維護指南

流程：更新 main → 建立分支 → 修改與 TEST 驗證 → 提交 PR → 審查核准 → 主責維護者合併及部署。GitHub 保存程式版本；合併 PR 不會自動更新 Google Apps Script（GAS）。

## 分工

| 角色 | 責任 |
|---|---|
| 修改者 | 修改程式、測試與必要文件，提交 PR 並處理審查意見 |
| 審查者 | 檢查變更及驗證結果，提出修改要求或核准 |
| 主責維護者 | 確認審查通過、合併 PR、部署正式 GAS，管理權限與部署紀錄 |

修改者與審查者必須是不同人；主責維護者提出的修改，也須由審查者核准。

## 第一次參與

安裝 Node.js 24，下載專案並執行本機測試：

```sh
git clone https://github.com/luorobin596/ClinicScheduling.git
cd ClinicScheduling
TZ=Asia/Taipei node --test tests/*.test.cjs
```

本機測試不需要 npm 套件或 Google 權限。專案介紹見 [README](README.md)，排班規則見 [規格索引](tasks/README.md)，測試說明見 [tests/README.md](tests/README.md)。需要線上驗證時，再完成下方 GAS 設定。

## GAS 設定與同步指令

兩個環境共用本機的 `GAS/`，以不同設定檔選擇目標。安裝 clasp、登入 Google，並在 [Apps Script 帳號設定](https://script.google.com/home/usersettings) 開啟 Apps Script API：

```sh
npm install -g @google/clasp
clasp login
# 修改者可推送修改後的程式至GAS環境測試運行效果
cp -n .clasp.json.example .clasp.test.json

# 僅主責維護者需要正式環境設定
cp -n .clasp.json.example .clasp.production.json
```

在本機設定檔填入對應 GAS 專案的「指令碼 ID」，保留 `rootDir` 為 `GAS`。TEST 與正式 ID 不可相同，設定檔不提交 Git。第一次同步前，先備份並比對目標專案程式與 `GAS/appsscript.json`，確認授權、服務與 Web App 設定適用。

各 GAS 專案的 Script Properties 須分別設定：

| 屬性 | 用途 |
|---|---|
| `BACKEND_SHEET_ID` | 後端試算表 |
| `FRONTEND_SHEET_ID` | 前台匯出試算表 |
| `ADMIN_EMAIL` | 管理通知收件人 |

TEST 須使用測試試算表與核准收件人；選擇 TEST 專案不會自動隔離資料。共用 manifest 使用 V8 與 Asia/Taipei，試算表欄位與版面須符合程式要求。

## 從修改到 PR

1. 從乾淨且最新的 main 建立工作分支：

```sh
git switch main
git pull --ff-only origin main
git switch -c codex/describe-your-change
```

2. 修改 `GAS/` 及必要的測試、文件。每份 PR 處理一個問題；排班規則先討論確定並更新規格，修復錯誤須保留重現案例。
3. 執行本機測試。涉及 Google 服務、網頁、匯出或通知時，再同步到 TEST 驗證；各步成功後才繼續：

```sh
TZ=Asia/Taipei node --test tests/*.test.cjs
node scripts/check-gas-deploy.cjs test
clasp --project .clasp.test.json push
```

純文件變更可檢查連結與差異，不需同步 GAS。共用 TEST 前先與審查者協調分支與版本，避免覆蓋測試。TEST 檢查允許工作分支與未提交變更，但 PR 最終內容必須包含驗證過的版本。

4. 檢查並提交變更；`git add` 的路徑按實際修改調整：

```sh
git diff
git add GAS tests scripts .github .gitignore README.md CONTRIBUTING.md
git diff --cached
git commit -m "fix: describe the change"
git push -u origin HEAD
```

5. 在 GitHub 建立以 main 為目標的 PR，填寫問題、修改結果、測試命令與實際結果，再請審查者檢查。尚未驗證的項目須明確列出。
6. 依意見修正並推送後續 commit，重跑受影響的驗證，再請審查者確認最新變更。

一般測試由維護者手動執行，目前沒有 PR 自動測試。大型模擬僅在相關需求下執行，見 [擴大測試說明](tests/EXPANDED_TESTING.md)；歷史報告不能代替新版驗證。

## 審查與合併

審查者確認：

- 修改符合問題描述與規格，沒有混入無關變更。
- 正常、邊界與失敗情境合理，驗證涵蓋最新 PR 內容。
- 沒有夾帶真實 ID、email、個資或憑證。
- 已說明試算表、權限、manifest、觸發器及 Library／Web App 的影響與回復方式。

有阻擋問題時使用 GitHub Review 的 **Request changes**；確認修正後使用 **Approve**。PR 勾選框不代替核准。

主責維護者確認審查通過、阻擋意見已解決且驗證齊全後，合併至 main。若合併引入額外改動，須補做對應驗證。

主責維護者須在 GitHub 設定 main 的保護規則：要求 PR、至少一位其他人核准，以及新變更後重新審查。權限不足時請管理員設定；文件與本機工具不會自動啟用規則。

## 合併後正式部署

純文件變更不需部署。程式變更由主責維護者確認 TEST 結果後，在專案根目錄依序執行：

```sh
git switch main
git fetch origin
git pull --ff-only origin main
TZ=Asia/Taipei node --test tests/*.test.cjs
node scripts/check-gas-deploy.cjs production
clasp --project .clasp.production.json push
```

正式檢查要求乾淨的 main，且與 origin/main 一致；不會查詢 PR 核准。任何步驟失敗時停止，不繼續部署。

`git push` 更新 GitHub；`clasp ... push` 會取代目標 GAS 的原始碼。同步後確認內容與功能，固定版本 Web App 或 Library 另須更新部署或引用版本，觸發器與權限也須核對。

在對應 PR 記錄部署日期（Asia/Taipei）、Git commit、clasp 與 GAS 版本、驗證結果及前一可回復版本。故障時由主責維護者依紀錄回復；程式回復不會還原試算表資料。線上緊急修正須補回分支、測試與 PR。

## 資料與公開範圍

- 真實 GAS／Sheet ID、通知 email、憑證及診所資料不提交 Git，也不貼進公開 PR 或 Issue。測試 email 使用 example.com 或 example.invalid。
- `.clasp.test.json`、`.clasp.production.json` 與 `.clasprc.json` 不追蹤；`.clasp.json.example` 只保留佔位值。`GAS/appsscript.json` 則需提交及審查。
- 提交前檢查 `git diff --cached`，也要檢查日誌、截圖及壓縮檔。`.gitignore` 不會移除既有追蹤或歷史內容；Git 作者 email 依隱私需求使用 GitHub noreply 地址。
- 若誤提交憑證，先撤銷或輪替，再通知主責維護者協調清理歷史與副本，不自行 force push。
- `docs/` 僅作本機參考，不納入 Git；共同操作規則以本指南、README 與 PR 範本為準。
