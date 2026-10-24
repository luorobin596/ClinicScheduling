# 公開前資料檢查（2026-10-24）

結論：公開前資料檢查已完成。

## 範圍與方法

檢查目前追蹤檔及未忽略的新檔、本機全部 refs 可達的 45 個 commit、去重後的歷史 blob、commit 訊息及作者／提交者資訊。封存壓縮檔內的 JSON 也納入檢查；不是只看最新版本。包含當前與歷史重複項在內，共檢查 419 份文字物件，約 358 MB。

以本機規則比對常見 GitHub／Google／AWS 憑證、私鑰、秘密值指派、Google 資源連結、硬編碼試算表 ID、信箱、電話及身分證格式，並人工核對匹配項、測試姓名與案例來源。本機未安裝 gitleaks／trufflehog，本次使用自訂規則與人工檢視，不代表能辨識所有秘密格式或所有個資。

原始靜態檢查未連線取得遠端新 refs。檢查範圍不包含 GitHub 的 Issues、PR、Actions 產物、Release 附件、不可達物件或 reflog，以及 Google 試算表、GAS Script Properties 與部署環境。

## 檢查結果

- 在上述範圍與規則中，未發現疑似真實 API 憑證、私鑰、Google 內部資源連結或硬編碼試算表 ID。歷代 Config_system.js 均使用 Script Properties 讀取設定。
- 檔案信箱匹配為 scheduling-report.test.cjs 的 admin@example.com 測試值。電話格式匹配位於 rosterHash 內，人工核對為誤報。
- 結構化 name／staff_name 值為「測試員工1～5」及「員工1～5」。這不代表員工代碼與日期已無法對應真實人員。
