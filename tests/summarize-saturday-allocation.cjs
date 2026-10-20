/** Render the new experiment without overwriting frozen baseline JSON evidence. */
const fs=require('node:fs');
const path=require('node:path');
const {formatWeeklyCell}=require('./support/weekly-report.cjs');
const kinds=['baseline','full-only','mixed','week-off'];
const labels=['原先同批意願','五人只休全天','五人全天／半天混合','一人連休一週'];
const reports=kinds.map(k=>require(`./results/saturday-allocation/${k}-evaluation.json`));
const previous=kinds.map(k=>require(`./results/${k}-evaluation.json`));
const avg=a=>a.length?a.reduce((n,v)=>n+v,0)/a.length:null;
const fmt=n=>n===null?'N/A':n.toFixed(2);
const spread=a=>Math.max(...a)-Math.min(...a);
const paired=(r,old)=>r.runs.filter(x=>x.status==='VALID'&&old.runs.some(y=>y.seed===x.seed&&y.status==='VALID'));
const oldPaired=(runs,old)=>runs.map(r=>old.runs.find(x=>x.seed===r.seed));
const measureSpread=(runs,field)=>avg(runs.map(r=>spread(r.final.measure.staff.map(p=>field==='hours'?p.attainment*100:p.involuntarySingle))));

function render(newPrefix,oldPrefix){
 let out='# 週六分配調整與 400 次公平性測試\n\n日期：2026-10-19。2026 年 11 月、五位 FT、無國定假日；以 `ced9647` 為舊演算法基準。已完成本機修改，尚未更新線上 Apps Script Library。\n\n';
 out+='## 本次變更與比較方式\n\n週六先固定合法 A／B 人數，再比較整日方案，依月非自願單節 → 月工時達成率 → 每週 AC → 每週 BC／AB 同級選擇；只有完整評分相同才輪轉。同一筆請假、平日初始配置、固定班、小兒指派與工時基準保持一致，未加入後處理雙班移轉。候選增量評分已與完整統計核對。\n\n每種情境使用原本 inputs.json 的相同 100 組，沒有重新篩選或抽樣；舊輸入 hash 已核對。原同批那一組 11/05 真實人力衝突保留在失敗分母。新增三情境是先前已通過原始意願可行性檢查的固定樣本，不代表任意未協調請假都能排班。\n\n';
 out+='## 合格率與最低覆蓋\n\n| 情境 | 舊版最終合格 | 新版最終合格 | 新版初始覆蓋不合格 | 新版失敗 |\n|---|---:|---:|---:|---:|\n';
 reports.forEach((r,i)=>{out+=`| ${labels[i]} | ${previous[i].successful}/${previous[i].sampleCount} | ${r.successful}/${r.sampleCount} | ${r.initialCoverageFailed} | ${r.failed} |\n`;});
 out+='\n所有新版成功結果獨立核對：指定上班與休假、小兒原指派、每日最多兩班、同時段不跨科重複、骨科各班上限及最低覆蓋；公平性後處理另維持修補後各時段人數。仍容許未滿需求的兼職缺額。\n\n';
 const failures=reports.flatMap((r,i)=>r.runs.filter(x=>x.status!=='VALID').map(x=>({label:labels[i],...x})));
 for(const r of failures)out+=`- ${r.label} seed ${r.seed}：${r.error.code}，${r.error.message}。\n`;
 out+='\n## 舊版最終 → 新版最終：相同成功樣本\n\n下列差距先在每次班表內取五人最大值減最小值，再跨次平均；不是各人的跨次平均相減。工時為達成率差距的百分點。\n\n| 情境 | 共同成功樣本 | 非自願單節差距：舊 → 新 | 工時達成率差距：舊 → 新 |\n|---|---:|---:|---:|\n';
 reports.forEach((r,i)=>{const runs=paired(r,previous[i]),old=oldPaired(runs,previous[i]);out+=`| ${labels[i]} | ${runs.length} | ${fmt(measureSpread(old,'singles'))} → ${fmt(measureSpread(runs,'singles'))} 次 | ${fmt(measureSpread(old,'hours'))} → ${fmt(measureSpread(runs,'hours'))} 百分點 |\n`;});
 out+='\n公平性優先序完全保留；較高優先項改善時仍可能容許較低項退步，不能宣稱每項或每一組都變好。\n\n';
 out+='## 單節班總量：更平均的代價\n\n現有單節評分只比較人員差距 R 與離散程度 Q，沒有把全體單節總次數列入最小化。因此可以選擇讓原本單節少者多上單節，以縮小差距；本次未新增或調換優先序。以下列全體五人每月非自願單節總量的跨次平均，避免把「更平均」誤讀成「單節更少」。\n\n| 情境 | 舊版總次數 | 新版總次數 |\n|---|---:|---:|\n';
 reports.forEach((r,i)=>{const runs=paired(r,previous[i]),old=oldPaired(runs,previous[i]);const total=rows=>avg(rows.map(x=>x.final.measure.staff.reduce((n,p)=>n+p.involuntarySingle,0)));out+=`| ${labels[i]} | ${fmt(total(old))} | ${fmt(total(runs))} |\n`;});
 out+='\n週六 A3／B2 可以形成兩人 AB＋一人 A，也可以形成一人 AB＋三人單節。名額與總工時相同，後者可能更接近平日既有單節差距，卻增加單節總量。本版依既有評分接受這種取捨，不宣稱已同時減少總負擔。跨次員工工時平均仍不完全一致，FT004 在本批反而較高；不能把原先偏差的縮小或反轉視為已完全消除所有排序／約束影響。\n\n';
 out+='## 每人每週班型：新版初始 → 最終\n\n「初始」是新週六分配完成、尚未做最低覆蓋修補與公平性交換；「最終」為完整流程完成。AC 保留平均次數。以下只改報表口徑，不改引擎仍以每週 BC／AB 班型等評分的政策。\n\n';
 out+='- C／早班只計週一至五營業日，骨科與小兒合併判斷；週六另表。C 包含 AC、BC、單 C；早班為 AB、單 A、單 B，每天算一次，不包含 AC 的 A 或 BC 的 B。指定單節也計入這兩欄的實際出勤，與公平性單節豁免是不同用途。\n';
 out+='- 完整週：C 目標＝min(3，原始意願及固定小兒班允許的 C 天數)；早班目標＝min(原始允許早班天數，max(0，可上班日數－C目標))。自動排班結果不改目標。\n';
 out+='- 每次先算實際／目標，再平均比率；不把總次數除以總目標。零目標或未知資料以 N/A 排除；若只有部分樣本有分母，格內註明有效 n。N/A 不代表實際完全沒有排班。超過目標的比例不截成 100%。\n';
 out+='- 診所當週營業平日不足五天才是短週；個人請假不會把完整週變短週。短週 C／早班改呈現實際平均次數（不排除零次），不呈現達成率。第1～4週為11/02–07、11/09–14、11/16–21、11/23–28；第5週只有11/30。\n\n';
 reports.forEach((r,i)=>{
  const runs=r.runs.filter(x=>x.status==='VALID');if(!runs.length)return;
  out+=`### ${labels[i]}（${runs.length} 組）\n\n| 週別 | 員工 | AC 平均次數 | 平日 C 達成率／短週次數 | 平日早班達成率／短週次數 |\n|---|---|---:|---:|---:|\n`;
  const ids=runs[0].final.weekly.map(p=>p.id);
  for(const week of runs[0].final.weekly[0].weeks){
   for(const id of ids){
    const values=stage=>runs.map(run=>run[stage].weekly.find(p=>p.id===id).weeks.find(w=>w.week===week.week));
    const before=values('initial'),after=values('final');
    const ac=`${fmt(avg(before.map(w=>w.AC)))} → ${fmt(avg(after.map(w=>w.AC)))}`;
    const cell=kind=>formatWeeklyCell(before,after,kind);
    out+=`| 第${week.week}週${week.shortWeek?`（短週${week.openWeekdays}平日）`:''} | ${id} | ${ac} | ${cell('c')} | ${cell('early')} |\n`;
   }
  }
  out+='\n';
 });
 out+='## 每位員工最終月平均：舊版 → 新版\n\n這是個人跨次平均，仍需搭配每組班表內差距。連休情境的比率逐次平均，不等於平均 H／平均 C；連休者月休11天、基準152小時，其餘9天、基準168小時。\n\n';
 reports.forEach((r,i)=>{
  const runs=paired(r,previous[i]),old=oldPaired(runs,previous[i]);if(!runs.length)return;
  out+=`### ${labels[i]}（共同成功 ${runs.length} 組）\n\n| 員工 | 實際工時：舊 → 新 | 工時達成率：舊 → 新 | 非自願單節：舊 → 新 |\n|---|---:|---:|---:|\n`;
  for(const person of runs[0].final.measure.staff){
   const a=old.map(x=>x.final.measure.staff.find(p=>p.id===person.id)),b=runs.map(x=>x.final.measure.staff.find(p=>p.id===person.id));
   out+=`| ${person.id} | ${fmt(avg(a.map(p=>p.hours)))} → ${fmt(avg(b.map(p=>p.hours)))} | ${fmt(avg(a.map(p=>100*p.attainment)))}% → ${fmt(avg(b.map(p=>100*p.attainment)))}% | ${fmt(avg(a.map(p=>p.involuntarySingle)))} → ${fmt(avg(b.map(p=>p.involuntarySingle)))} |\n`;
  }
  out+='\n';
 });
 out+='## 週六首次分配結果\n\n以下是週六階段完成時每人的四個週六平均次數；尚未經後處理。未排班包含原始休假與自動輪空，不全是系統造成的休假。\n\n';
 reports.forEach((r,i)=>{
  const runs=r.runs.filter(x=>x.status==='VALID');if(!runs.length)return;
  out+=`### ${labels[i]}\n\n| 員工 | AB | 單 A | 單 B | 未排班 |\n|---|---:|---:|---:|---:|\n`;
  for(const person of runs[0].saturday.patternsAfter){const people=runs.map(x=>x.saturday.patternsAfter.find(p=>p.id===person.id));out+=`| ${person.id} | ${['AB','A','B','unassigned'].map(k=>fmt(avg(people.map(p=>p[k])))).join(' | ')} |\n`;}
  out+='\n';
 });
 out+='## 效率與搜尋界限\n\n週六每個候選採本日增量評分；每次週六階段完整月統計只做開始與結束兩次。新舊週六耗時在相同 Node 執行程序、相同輸入量測；完整流程另包含舊版初始班表重播與測試稽核，因此不是純正式引擎或線上 GAS 耗時。\n\n| 情境 | 舊週六平均 | 新週六平均 | 新週六 P95／最大 | 每月平均候選 | 新週六到限日期數 |\n|---|---:|---:|---:|---:|---:|\n';
 reports.forEach((r,i)=>{const runs=r.runs.filter(x=>x.saturday),times=runs.map(x=>x.saturday.elapsedMs).sort((a,b)=>a-b);out+=`| ${labels[i]} | ${fmt(avg(runs.map(x=>x.legacySaturdayMs)))}ms | ${fmt(avg(times))}ms | ${times[Math.ceil(times.length*.95)-1]}／${Math.max(...times)}ms | ${fmt(avg(runs.map(x=>x.saturday.days.reduce((n,d)=>n+d.evaluated,0))))} | ${runs.reduce((n,x)=>n+x.saturday.days.filter(d=>!d.complete).length,0)} |\n`;});
 out+='\n新週六每日期上限20,000候選、整階段2,000ms；本批是否完整搜尋以上表為準。只保證已處理當天候選的比較，不保證全月週六聯合最優。後處理仍沿用20,000候選／200接受／共享10秒，不包含雙班移轉。\n\n| 情境 | 公平性後處理到限組數 | 完整評估平均／最長 |\n|---|---:|---:|\n';
 reports.forEach((r,i)=>{out+=`| ${labels[i]} | ${r.fairnessSearchLimits} | ${fmt(r.elapsedMs.mean/1000)}／${fmt(r.elapsedMs.max/1000)}秒 |\n`;});
 out+='\n## 驗證與資料\n\n- 140 項單元／假 Sheet 測試全數通過；另外400組模擬逐案保留成功及失敗。\n';
 reports.forEach((r,i)=>{out+=`- [${labels[i]}結果](${newPrefix}${kinds[i]}-evaluation.json)；[相同輸入](${newPrefix}${kinds[i]}-inputs.json)；[舊版結果](${oldPrefix}${kinds[i]}-evaluation.json)。新結果有完整正式模組 hash 與輸入 hash。\n`;});
 out+='- 新版 `baseline-3-*` 為3組先導測試，不納入正式400組。\n\n重跑：\n\n```sh\nnode --test tests/*.test.cjs\nTZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario baseline\nTZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario full-only\nTZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario mixed\nTZ=Asia/Taipei node tests/evaluate-saturday-allocation.cjs --scenario week-off\nnode tests/summarize-saturday-allocation.cjs\n```\n';
 return out;
}
const root=path.join(__dirname,'results');
const archive=path.join(root,'summary-before-saturday-allocation.md');
if(!fs.existsSync(archive))fs.copyFileSync(path.join(root,'summary.md'),archive);
fs.writeFileSync(path.join(root,'summary.md'),render('saturday-allocation/',''));
fs.writeFileSync(path.join(root,'saturday-allocation','summary.md'),render('','../'));
console.log(path.join(root,'summary.md'));
