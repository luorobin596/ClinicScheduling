# GitHub 審查與 GAS 手動部署

流程：分支修改 → 本機測試 → commit / push → PR → 另一位維護者核准並合併 main → Robin 更新 main → TEST 驗證 → 正式 clasp push → 更新所需版本／部署 → PR 留存紀錄。

GitHub 為程式碼版本來源。正式同步由 Robin 操作；同仁開發時不需要正式 GAS 的寫入權限。本文件不會自動上傳程式。TEST 與正式環境使用不同 Script ID，請分別使用獨立 checkout，各自保留本機 .clasp.json。

## 首次接軌（Robin）

1. 安裝 Node.js 24，再安裝並登入 clasp：

```sh
npm install -g @google/clasp
clasp --version
clasp login
```

至 https://script.google.com/home/usersettings 開啟 Google Apps Script API。從既有專案設定取得「指令碼 ID」，不是試算表或部署 ID。記錄所用 clasp 版本，升版時重新核對指令。

2. 在儲存庫以外的空資料夾下載既有線上版本：

```sh
mkdir gas-online-backup
cd gas-online-backup
clasp clone-script YOUR_SCRIPT_ID
```

保留這份備份，逐一比較線上與儲存庫 GAS/ 的程式、HTML 與檔名。clasp push 會取代線上專案內容，因此線上仍有需要但儲存庫缺少的模組，必須先補入並經 PR 審查。不要在現有 GAS/ 直接 clone 或 pull。

3. 回到儲存庫，在工作分支將下載的 appsscript.json 複製為 GAS/appsscript.json，保留原本授權範圍、Library／進階服務等設定，確認 V8 與 Asia/Taipei。不要從零猜測 manifest。檢查其中專案資訊是否適合公開；有環境差異時先處理 TEST／正式設定方式再部署。將 manifest、必要的程式差異與本次流程設定一起提交 PR。

4. 在每個部署用 checkout 的根目錄執行：

```sh
cp .clasp.json.example .clasp.json
```

編輯 .clasp.json，將 scriptId 換成該環境的真實 ID，保留 rootDir 為 GAS。此檔已忽略；每台電腦獨立設定。登入憑證 .clasprc.json 也不提交；GAS/appsscript.json 則必須納入 Git 與審查。

## GitHub 一次性設定（儲存庫管理者）

為 main 設定 branch protection 或 ruleset：要求 PR 才能合併、至少一名其他維護者核准、新 commit 後撤銷舊核准，並限制繞過規則。實際可用選項依 GitHub 方案與權限而定。目前一般測試仍由維護者手動執行並貼結果，大型模擬維持既有手動流程，不在這次啟用 PR 自動測試。

本機檢查只檢查分支、工作目錄、遠端追蹤 commit 與設定，不會查詢 PR 核准，也無法阻止具有 GAS 權限的人直接執行 clasp push。核准由 GitHub 規則與部署者核對。

## 日常開發（所有維護者）

首次 git clone 後進入專案；後續從 main 更新並建立工作分支：

```sh
git switch main
git pull --ff-only origin main
git switch -c codex/describe-your-change
```

修改 GAS/，在根目錄測試後提交：

```sh
TZ=Asia/Taipei node --test tests/*.test.cjs
git add gas tests docs README.md CONTRIBUTING.md
git diff --cached
git commit -m "fix: describe the change"
git push -u origin HEAD
```

git add 清單應依實際變更調整，首次接軌也須加入設定範本、忽略規則和部署工具。開 PR、附測試結果、由另一位維護者核准並合併。開發分支可在獨立 TEST 專案驗證，正式專案只同步已合併的版本。

## 合併後部署（Robin）

先確認 PR 已核准合併，且目前 checkout 的 .clasp.json 對應預期環境：

```sh
git switch main
git fetch origin
git pull --ff-only origin main
TZ=Asia/Taipei node --test tests/*.test.cjs
node scripts/check-gas-deploy.cjs
```

以上任一步驟失敗即停止，不繼續 push。確認 clasp 已安裝登入，在 TEST checkout 同步並驗證填寫、截止重試、排班、匯出與寄信；若發現問題，回工作分支修改並走新 PR。

正式 checkout 重做以上檢查，核對 Script ID 與完整上傳檔案後，才執行：

```sh
clasp push
```

push 更新專案原始碼。固定版本 Web App 或 Library 仍需在 GAS 管理部署／版本，更新既有部署或使用方的 Library 版本，並驗證既有網址、觸發器與外部選單。不能把 push 成功當成正式版本已生效。直接使用專案目前程式的執行方式可能在 push 後立即受到影響。

部署期間不要繼續修改該 checkout。完成後在 PR 記錄：

```text
部署日期（Asia/Taipei）：
環境：TEST／正式
Git commit：
clasp 版本：
GAS Library／Web App 版本或不適用：
前一可回復版本：
TEST 與正式驗證結果：
部署負責人：
```

## 線上緊急修改與回復

平常避免直接編輯線上正式程式。緊急修改後，先在另一個空資料夾下載比較，再將差異帶回工作分支、測試並走 PR，避免下次部署覆蓋修正。

需要回復時，優先切回已記錄的既有部署版本；若需回復目前程式，將已知良好版本的變更經 revert PR 合併至 main，再依同樣流程同步。程式版本回復不會還原試算表資料。

## 官方參考

- [clasp 安裝與使用](https://developers.google.com/apps-script/guides/clasp)
- [clasp 指令與 push 行為](https://github.com/google/clasp)
- [clasp 設定、憑證與 manifest](https://github.com/google/clasp/blob/master/docs/config-files.md)
