/** Per-execution report. Uses the final in-memory roster, never historical averages. */
var ScheduleReport = (function() {
/** Reporting only: weekday C and non-C working-day targets never affect fairness policy. */
const key=(date,shift,id)=>JSON.stringify([date,shift,id]);
function averageRates(values){const valid=values.filter(v=>v!==null&&Number.isFinite(v));return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}
function assigned(day,id){return Object.keys(day.slots).filter(s=>Object.values(day.slots[s]).some(slot=>slot.staff.includes(id))).sort();}
function originalPatterns(context,day,id){
 const shifts=Object.keys(day.slots);
 const required=shifts.filter(s=>context.constraints.fixed[key(day.date,s,id)]||context.constraints.peds[key(day.date,s,id)]||day.slots[s].PEDS.staff.includes(id));
 const patterns=[];
 for(let mask=1;mask<(1<<shifts.length);mask++){
  const subset=shifts.filter((_,i)=>mask&(1<<i));
  if(subset.length<=2&&required.every(s=>subset.includes(s))&&!subset.some(s=>context.constraints.off[key(day.date,s,id)]))patterns.push(subset);
 }
 return patterns;
}
function summarizeWeeks(context,staff){
 const grouped=new Map();
 for(const day of context.days){
  const date=new Date(day.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-date.getUTCDay());
  const week=date.toISOString().slice(0,10);if(!grouped.has(week))grouped.set(week,[]);grouped.get(week).push(day);
 }
 const weeks=[...grouped.values()];
 return staff.map(person=>({id:person.id,weeks:weeks.map((days,index)=>{
  const weekdays=days.filter(d=>d.isOpen&&d.dayOfWeek>=1&&d.dayOfWeek<=5);
  const result={week:index+1,startDate:days[0].date,endDate:days[days.length-1].date,openWeekdays:weekdays.length,shortWeek:weekdays.length<5,AC:0,
   cActual:0,cTarget:0,cRate:null,earlyActual:0,earlyTarget:0,earlyRate:null,workingDays:0,cAvailableDays:0,earlyAvailableDays:0};
  for(const day of days.filter(d=>d.isOpen))if(assigned(day,person.id).join('')==='AC')result.AC++;
  for(const day of weekdays){
   const actual=assigned(day,person.id);
   if(actual.includes('C'))result.cActual++;
   if(['A','B','AB'].includes(actual.join('')))result.earlyActual++;
   const patterns=originalPatterns(context,day,person.id);
   if(patterns.length)result.workingDays++;
   if(patterns.some(p=>p.includes('C')))result.cAvailableDays++;
   if(patterns.some(p=>!p.includes('C')))result.earlyAvailableDays++;
  }
  result.cTarget=Math.min(3,result.cAvailableDays);
  result.earlyTarget=Math.min(result.earlyAvailableDays,Math.max(0,result.workingDays-result.cTarget));
  result.capacityKnown=Array.isArray(context.submittedStaffIds)&&context.submittedStaffIds.includes(person.id);
  if(result.capacityKnown&&result.cTarget>0)result.cRate=result.cActual/result.cTarget;
  if(result.capacityKnown&&result.earlyTarget>0)result.earlyRate=result.earlyActual/result.earlyTarget;
  return result;
 })}));
}

  function build(context) {
    const staff = context.staffList;
    const monthly = ScheduleFairness.measure(context, staff);
    const weekly = summarizeWeeks(context, staff);
    const voluntary = [];
    const saturday = staff.map(person => {
      const row = {id: person.id, AB: 0, A: 0, B: 0, unassigned: 0};
      context.days.filter(day => day.isOpen).forEach(day => {
        const work = ScheduleFairness.workContribution(context, day, person.id);
        if (work.voluntarySingle) voluntary.push({id: person.id, date: day.date, shift: work.pattern});
        if (day.dayOfWeek === 6) row[work.pattern || 'unassigned']++;
      });
      return row;
    });
    return {runId: context.runIdStr, staff: staff, monthly: monthly.staff, weekly: weekly, voluntary: voluntary, saturday: saturday};
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  }
  function table(headers, rows) {
    return '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><thead><tr>' +
      headers.map(h => '<th>' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(row => '<tr>' + row.map(v => '<td>' + escape(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }
  function percent(value) { return value === null ? 'N/A' : (value * 100).toFixed(1) + '%'; }
  function render(report) {
    const name = id => { const person = report.staff.find(p => p.id === id); return person.name || id; };
    const value = n => n === null ? 'N/A' : n;
    const rate = (w, kind) => percent(w[kind + 'Rate']) + '（' + w[kind + 'Actual'] + '/' + w[kind + 'Target'] + '）';
    return '<h1>' + escape(report.runId) + ' 排班完成報告</h1><p>本信僅統計本次排班的最終結果，非多次排班平均；每班以 4 小時計算，包含骨科與小兒科。</p>' +
      '<h2>每人當月統計</h2>' + table(['姓名', '實際工時', '預排工時', '月工時達成率', '非自願單節班次數', '自願單節班次數'],
        report.monthly.map(p => [name(p.id), p.hours, value(p.capacityHours), percent(p.attainment), p.involuntarySingle, p.voluntarySingle])) +
      '<p>預排工時：當月扣除休假後的工時，沿用 summary 應排工時定義；每個營業日以兩班（8 小時）為基礎，全天休扣 8 小時，指定單班且其餘時段休假扣 4 小時。月工時達成率＝實際工時 ÷ 預排工時。未提交意願、休假型態無法判定或分母為零時，相關數值顯示 N/A。</p>' +
      '<p>自願單節班：原始意願指定一班且其餘時段皆休假，最終僅上一班；其他僅上一班的工作日計為非自願單節班。</p>' +
      '<h2>自願單節班明細</h2>' + (report.voluntary.length ? table(['姓名', '日期', '班別'], report.voluntary.map(p => [name(p.id), p.date, p.shift])) : '<p>本次無自願單節班。</p>') +
      '<h2>每人每週班型</h2>' + table(['姓名', '週別／日期範圍', 'AC 次數', 'C 班達成率（實際/目標）', '早班達成率（實際/目標）'],
        report.weekly.flatMap(p => p.weeks.map(w => [name(p.id), '第 ' + w.week + ' 週 ' + w.startDate + '～' + w.endDate + (w.shortWeek ? '（短週）' : ''), w.AC, rate(w, 'c'), rate(w, 'early')]))) +
      '<p>以週日至週六分週，日期僅列當月範圍。AC 次數包含週六；C 與早班僅計平日。早班指只上 A、B 或 AB 的工作日。C 目標＝min(3, 原始意願與固定小兒班允許上 C 的天數)；早班目標＝min(可只上早班的天數, max(0, 可工作天數－C 目標))。達成率不封頂，可能超過 100%；短週另標示，分母為零或未提交意願時顯示 N/A。</p>' +
      '<h2>每人週六最終分配次數</h2>' + table(['姓名', 'AB', 'A', 'B', '未排班'], report.saturday.map(p => [name(p.id), p.AB, p.A, p.B, p.unassigned])) +
      '<p>僅計營業週六的最終班型，包含骨科與小兒科；未排班包含休假與系統未分配。</p>';
  }
  return {
    build: build,
    render: render,
    send: function(context) {
      const adminEmail = getRequiredScriptProperty_('ADMIN_EMAIL');
      const report = build(context);
      Notify.sendEmail(adminEmail, '【排班完成報告】' + report.runId, render(report));
    }
  };
})();
