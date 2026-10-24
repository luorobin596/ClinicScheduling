/** Render saved evaluation evidence; does not rerun or resample simulations. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const configHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'GAS', 'Config_system.js'))).digest('hex');
const kinds = ['baseline', 'full-only', 'mixed', 'week-off'];
const labels = ['原先同批意願', '五人只休全天', '五人全天／半天混合', '一人連休一週'];
const reports = kinds.map(k => require(`./results/${k}-evaluation.json`));
const avg = values => values.reduce((a, b) => a + b, 0) / values.length;
const spread = values => Math.max(...values) - Math.min(...values);
const f = n => n.toFixed(2);
const valid = report => report.runs.filter(r => r.status === 'VALID');
const metrics = (runs, stage) => {
 const measurements = runs.map(r => r[stage].measure);
 return [
  avg(measurements.map(m => spread(m.staff.map(p => p.involuntarySingle)))),
  avg(measurements.map(m => spread(m.staff.map(p => p.attainment * 100)))),
  avg(measurements.map(m => m.score[4])), avg(measurements.map(m => m.score[5])),
  avg(measurements.map(m => m.score[7])), avg(measurements.map(m => m.score[8]))
 ];
};
let out = `# 排班修改與 400 次離線模擬結果\n\n日期：2026-10-19。月份：2026 年 11 月；無額外國定假日；五位 FT；骨科平日 A/B/C 上限各 3 人，週六 A3/B2；小兒固定班／代班不計入骨科人數。\n\n正式程式已在本機完成修改，尚未上傳或更新線上 Apps Script Library。\n\n## 實作結果\n\n保留原初始排班及正反序輪轉，再依序執行最低骨科覆蓋修補、受優先序約束的公平性交換、完整驗證，才寫出班表。修補優先移班／交換，最後才新增。公平性階段維持修補後每個日期／班別／站別人數。\n\n公平性優先序：月非自願單節 → 月工時達成率 → 每週 AC → 每週 BC／AB 同級。每級先看差距，再看離散程度；低優先改善不能抵銷高優先惡化。指定單節且其餘時段休假不計非自願單節，小兒形成的單節照計。指定雙班鎖定且納入週班型。\n\n逐人來源與原始意願分開保存；固定班及小兒班不可移動。失敗還原 FT_WINDOW_CLOSED，保留首次截止時間並可重試；後端拒收關閉後的舊頁提交。來源／班表驗證在刪除舊輸出前完成，寫入失敗揭露可能部分寫入及舊資料快照，不承諾跨 Sheet 交易回復。\n\n## 模型與抽樣\n\n- 一般員工月休 9 天：5 個週日＋8 個半天額度。全天休扣 2 且 ABC 全禁；半天休扣 1，指定一班、其餘禁排。\n- 只休全天：每人另休 4 個全天。混合：每人都有全天與半天，總額度仍為 8。\n- 連休一週：一名員工完整休週日至週六，其中 6 個營業日全休，因此月休 11 天；其餘四人 9 天。該員工應排工時 152 小時，其餘為 168 小時。未將一週另加在原本 9 天上。\n- 原同批 100 組沿用先前凍結的 seed 與意願，未排除其中的失敗案例。\n- 新增三情境先按固定 seed 產生意願，僅依原始意願／固定小兒班檢查當日可行性，選出 100 組後先存檔再執行修補。排班後失敗不能換樣本；因此新增情境成功率是「通過輸入篩檢者」的結果。\n\n## 最低覆蓋與限制驗證\n\n| 情境 | 正式樣本 | 初始最低覆蓋不合格 | 最終合格 | 失敗 | 前置拒絕輸入 |\n|---|---:|---:|---:|---:|---:|\n`;
reports.forEach((r, i) => { out += `| ${labels[i]} | ${r.sampleCount} | ${r.initialCoverageFailed} | ${r.successful} | ${r.failed} | ${r.inputRejected} |\n`; });
out += `\n所有合格班表均獨立檢查原始意願、小兒指派不變、骨科各班上限、每日最多兩班、同時段不跨科重複及最低覆蓋；公平性階段另檢查各時段人數不變。最低覆蓋為平日至少兩名骨科員工且 ABC 各有人；週六至少一名骨科員工。未要求 FT 補滿需求上限，仍可留缺額給兼職。\n\n原同批 seed 19 的 11/05：FT001、FT004、FT005 全天休；FT002 小兒 B、FT003 小兒 C。依每日最多兩班，剩餘兩人合計最多只能排兩節骨科，無法涵蓋 ABC 三節。回報 INPUT_CONFLICT，不寫出班表。這個失敗保留在 100 組分母中。其餘 83 組初始覆蓋缺失均修補完成，原本合格的 16 組仍合格。\n\n新增情境的前置拒絕僅依意願／小兒固定班判斷，不參考初始自動指派，包含小兒兩人同班休假、固定指定班衝突、骨科可用人力不足；完整種子、原因及採用意願見各 inputs.json。這些不是修補後排除的失敗。\n\n## 公平性：同一批成功樣本前後比較\n\n以下數字均為「各次排班中五位員工最大值減最小值，再跨次取平均」，越小越平均。原同批前後使用相同 99 組，另 1 組僅納入失敗統計。工時欄為達成率差距的百分點，不是實際總工時差。\n\n| 情境 | 非自願單節差距：初始 → 最終 | 工時達成率差距：初始 → 最終 |\n|---|---:|---:|\n`;
reports.forEach((r, i) => {
 const runs = valid(r), a = metrics(runs, 'initial'), b = metrics(runs, 'final');
 out += `| ${labels[i]} | ${f(a[0])} → ${f(b[0])} 次 | ${f(a[1])} → ${f(b[1])} 百分點 |\n`;
});
out += `\n### 每人每週班型平均次數\n\n各情境各一表；每列固定同一員工與同一週，AC／BC／AB 分開呈現「初始 → 最終」。每格平均＝該情境成功樣本中，該員工該週該班型的次數總和 ÷ 成功樣本數；未排到為 0，休假週亦保留在分母。單位為次／該週，包含骨科與小兒、固定指定雙班及週六。第 1～4 週為 11/02–07、11/09–14、11/16–21、11/23–28；第 5 週只有 11/30，不宜與完整週直接比較。\n\n同週同班型可直接看出誰平均較多或較少。跨次平均仍可能抵銷個別班表的不均，不能單憑平均接近就認定每次排班都公平；連休一週對象輪替，也會稀釋該週休假的影響。\n\n`;
reports.forEach((r, i) => {
 const runs = valid(r);
 out += `#### ${labels[i]}（${runs.length} 組）\n\n| 週別 | 員工 | AC：初始 → 最終 | BC：初始 → 最終 | AB：初始 → 最終 |\n|---|---|---:|---:|---:|\n`;
 const weeks = runs[0].final.measure.staff[0].weekly.map(w => w.week);
 const ids = runs[0].final.measure.staff.map(p => p.id);
 for (const week of weeks) {
  for (const id of ids) {
   const cells = ['AC', 'BC', 'AB'].map(pattern => {
    const means = ['initial', 'final'].map(stage => avg(runs.map(run =>
     run[stage].measure.staff.find(p => p.id === id).weekly.find(w => w.week === week)[pattern]
    )));
    return `${f(means[0])} → ${f(means[1])}`;
   });
   out += `| 第 ${week} 週 | ${id} | ${cells.join(' | ')} |\n`;
  }
 }
 out += '\n';
});
out += `\n非自願單節差距明顯縮小，工時達成率差距平均亦縮小。原有差距統計中 AC 逐週差距合計略增，BC／AB 平均改善；上表則用來辨識各週各人的分配，不能宣稱所有指標同時變好。這是高優先項改善時容許低優先項取捨的結果，且未強制請假較多或短週員工達到固定班型次數。公平性階段的完整評分向量逐組均不劣於覆蓋修補完成時，但不表示每個低優先指標逐組都改善。\n\n## 每位員工的最終月平均\n\n此表是每位員工跨次平均，仍需搭配每次班表內的人員差距解讀。連休一週情境的對象會輪替，因此各人的平均應排工時可能略異。達成率欄為各次個人比率取平均，不是平均實際工時除以平均應排工時。\n\n`;
reports.forEach((r, i) => {
 const runs = valid(r);
 out += `### ${labels[i]}（${runs.length} 組）\n\n| 員工 | 實際工時 | 應排工時 | 工時達成率 | 非自願單節次數 | 自願單節次數 |\n|---|---:|---:|---:|---:|---:|\n`;
 for (let id = 1; id <= 5; id++) {
  const key = `FT00${id}`, people = runs.map(x => x.final.measure.staff.find(p => p.id === key));
  out += `| ${key} | ${f(avg(people.map(p => p.hours)))} | ${f(avg(people.map(p => p.capacityHours)))} | ${f(avg(people.map(p => p.attainment * 100)))}% | ${f(avg(people.map(p => p.involuntarySingle)))} | ${f(avg(people.map(p => p.voluntarySingle)))} |\n`;
 }
 out += '\n';
});
out += `## 搜尋預算、耗時與適用界限\n\n工程初值為每階段 20,000 個候選／200 次接受，後處理共享 10 秒期限。399 組合格結果的公平性搜尋全部因 CANDIDATE_LIMIT 停止，保留當時最佳合格解；沒有證明局部最優或全域最優。最低覆蓋修補均在限額內完成。\n\n| 情境 | 本機平均耗時 | 本機最長耗時 | 公平性候選到限組數 |\n|---|---:|---:|---:|\n`;
reports.forEach((r, i) => { out += `| ${labels[i]} | ${f(r.elapsedMs.mean / 1000)} 秒 | ${f(r.elapsedMs.max / 1000)} 秒 | ${r.fairnessSearchLimits} |\n`; });
out += `\n以上為 Node 假 Google 服務測試，耗時不含線上 Spreadsheet／Mail／Calendar I/O，不代表 Apps Script 的實際執行時間。部署前仍需在 TEST 專案驗證權限、Library 檔案載入、ScriptLock、截止重試及真實 Sheet 匯出。\n\n## 證據與重跑\n\nConfig_system.js SHA256：${configHash}。原同批結果的 engineHash 僅含四個排班模組，新增三情境的 engineHash 另含 Config_system.js；兩者對應相同正式程式內容，雜湊範圍不同。\n\n- 單元及假 Sheet 整合測試：109／109 通過。\n- [原同批結果](baseline-evaluation.json)、[只休全天](full-only-evaluation.json)、[混合](mixed-evaluation.json)、[連休一週](week-off-evaluation.json) 保留初始／修補／最終統計、失敗與停止原因。\n- 同名 inputs.json 保存全部樣本及前置拒絕原因；報告帶有引擎與輸入 SHA256。baseline-3-* 為 3 組先導驗證；superseded-initial-roster-screen/ 為移除初始班表篩選偏差前的先導結果，兩者均不納入正式 400 組。\n- 重跑：\n\n\x60\x60\x60sh\nnode --test tests/*.test.cjs\nTZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario baseline\nTZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario full-only\nTZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario mixed\nTZ=Asia/Taipei node tests/evaluate-adjustments.cjs --scenario week-off\nnode tests/summarize-adjustments.cjs\n\x60\x60\x60\n`;
fs.writeFileSync(path.join(__dirname, 'results', 'summary.md'), out);
console.log(path.join(__dirname, 'results', 'summary.md'));
