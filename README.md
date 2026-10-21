# ClinicScheduling
Scheduling system for a rehab clinic with 5 full-time staff


## 排班完成報告信

`CoreSystem.closeFtWindow()` 完成排班及前台匯出後，使用當次最終 context 寄送 HTML 報告至 Script Properties 的 `ADMIN_EMAIL`；重排成功也會寄送。部署時須包含 `scheduling_report.js`，並保留原有 MailApp 寄信授權。

報告列出每人當月實際工時、預排工時、達成率、自願／非自願單節次數、自願單節明細、每人每週 AC／平日 C 與早班達成率，以及週六最終 AB／A／B／未排班次數。預排工時沿用 summary 應排工時定義，未知或零分母達成率顯示 N/A。短週標示日期與實際／目標，沒有跨次平均。

寄信失敗會記錄錯誤並回傳「排班已完成、報告未寄出」警告，不將已完成班表當作排班失敗還原；目前沒有自動補寄。排班或匯出失敗不寄完成信。

驗證：`node --test tests/scheduling-report.test.cjs tests/flow-retry.test.cjs`。測試使用寄信替身，不會寄出真實郵件。
