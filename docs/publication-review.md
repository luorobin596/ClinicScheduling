# 公開前資料檢查（2026-10-24）

結論：本機靜態檢查已完成，仍有資料來源與公開範圍待負責人確認，尚未標記可直接公開。

## 範圍與方法

檢查目前追蹤檔及未忽略的新檔、本機全部 refs 可達的 45 個 commit、去重後的歷史 blob、commit 訊息及作者／提交者資訊。封存壓縮檔內的 JSON 也納入檢查；不是只看最新版本。包含當前與歷史重複項在內，共檢查 419 份文字物件，約 358 MB。

以本機規則比對常見 GitHub／Google／AWS 憑證、私鑰、秘密值指派、Google 資源連結、硬編碼試算表 ID、信箱、電話及身分證格式，並人工核對匹配項、測試姓名與案例來源。本機未安裝 gitleaks／trufflehog，本次使用自訂規則與人工檢視，不代表能辨識所有秘密格式或所有個資。

未連線取得遠端新 refs，也未檢查 GitHub 的 Issues、PR、Actions 產物、Release 附件、不可達物件或 reflog，以及 Google 試算表、GAS Script Properties 與部署環境。

## 檢查結果

- 在上述範圍與規則中，未發現疑似真實 API 憑證、私鑰、Google 內部資源連結或硬編碼試算表 ID。歷代 Config_system.js 均使用 Script Properties 讀取設定。
- 檔案信箱匹配為 scheduling-report.test.cjs 的 admin@example.com 測試值。電話格式匹配位於 rosterHash 內，人工核對為誤報。
- 結構化 name／staff_name 值為「測試員工1～5」及「員工1～5」。這不代表員工代碼與日期已無法對應真實人員。
- 15 個歷史 commit 的作者資訊包含個人 Gmail 信箱。最新 commit 使用 GitHub noreply 信箱；最新設定不會移除舊信箱。此處不重貼完整地址。
- tests/fixtures/weekday-workday-preservation.cjs 明示為使用者提供的意願，包含員工代碼與 2026-11 的逐日 off／fixed 資料；tasks/weekday-workday-preservation-spec.md 也記錄案例日期與員工代碼。是否為真實意願、是否適合公開，需由負責人確認。
- flow_run.js 的通知文字含診所名稱，web_entry.js 與 FT_Portal.html 的註解含人名暱稱範例。這些不是憑證，但仍需確認是否保留在公開專案。

## 未完成決策

- [x] 公開範圍決策：負責人不接受公開歷史作者的個人 Gmail 信箱（2026-10-24）。
- [ ] 公開前移除歷史中的個人 Gmail：需另行處理作者／提交者資訊並重新掃描；尚未改寫歷史或推送。
- [ ] 確認使用者提供案例為合成資料，或決定改成保留問題特徵的合成回歸案例。
- [ ] 確認診所名稱與註解暱稱的公開範圍。暱稱是 web_entry.js 與 FT_Portal.html 註解中的「小羅」／「小羅(A)」；診所名稱另見 flow_run.js 通知文字。

如需移除不適合公開的歷史內容，另外決定歷史處理方式；單次刪檔、修改作者設定或新增 commit 不會清除舊版本。本次未改寫歷史、變更資料案例或執行部署。
