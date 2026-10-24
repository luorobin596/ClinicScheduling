# 歷史原始結果封存

`historical-results.tar.gz` 保存整理前 results/ 的 26 份 JSON，包含正式四種情境在三代排班版本的輸入／結果與診斷。路徑相對於 tests/results/，原始位元組數與 SHA-256 見 [manifest.json](manifest.json)。封存保留原始 JSON 位元組，不重新執行、改寫結果或更新其版本雜湊。

一般回歸測試不依賴這些檔案；需要執行舊比較、摘要或診斷工具時，在專案根目錄還原：

```sh
tar -xkzf tests/results/archive/historical-results.tar.gz -C tests/results
```

`-k` 保留已存在檔案；若有同名資料，tar 會回報衝突，請先確認其來源。還原資料已加入 .gitignore，避免重新提交展開檔。

確認還原後位元組完整性（專案根目錄）：

```sh
node -e 'const fs=require("node:fs"),c=require("node:crypto"),a=require("node:assert/strict"); for(const e of JSON.parse(fs.readFileSync("tests/results/archive/manifest.json")).entries){const b=fs.readFileSync("tests/results/"+e.path);a.equal(b.length,e.bytes);a.equal(c.createHash("sha256").update(b).digest("hex"),e.sha256)} console.log("26 files verified")'
```

歷史 Markdown 報告內的 JSON 連結在還原後有效。三組先導輸出的兩個檔案 `saturday-pairing/baseline-3-inputs.json`、`baseline-3-evaluation.json` 不屬正式 400 組，已刪除，可由整理前 Git 版本追溯。

目前工作目錄縮小不會刪除既有 Git 歷史中的大檔。本次不改寫 Git 歷史。封存也不表示已完成資料去識別或公開前敏感資料檢查。
