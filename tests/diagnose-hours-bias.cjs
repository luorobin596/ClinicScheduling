/** Read-only runtime instrumentation; no production rules or saved benchmark evidence changed. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const kinds=['baseline','full-only','mixed','week-off'];
const stages=['fixed','weekdayCA','weekdayB','saturday'];
const methods=['_fillFixedShifts','_assignWeekdayShifts','_assignWeekdayBShifts','_assignSaturdayShifts'];
const avg=a=>a.reduce((n,v)=>n+v,0)/a.length;
function initial(fixture,mode){
 const loaded=engine(fixture.requests,{staff:fixture.staff});
 const result={stages:{}};
 methods.forEach((name,index)=>{
  const original=loaded.e[name];
  loaded.e[name]=function(context,...args){
   const staff=context.staffList;
   if(name==='_assignSaturdayShifts'&&mode==='swapSaturdayTies')context.staffList=[staff[3],staff[1],staff[2],staff[0],staff[4]];
   const value=original.call(this,context,...args);
   if(name==='_assignWeekdayBShifts')result.weekdays=this._groupDaysByWeek(context.days).map(days=>staff.map(person=>({id:person.id,hours:days.filter(d=>d.dayOfWeek!==6).reduce((n,d)=>n+Object.values(d.slots).reduce((a,slots)=>a+Object.values(slots).filter(slot=>slot.staff.includes(person.id)).length*4,0),0),bHours:days.filter(d=>d.dayOfWeek!==6&&d.slots.B).reduce((n,d)=>n+Object.values(d.slots.B).filter(slot=>slot.staff.includes(person.id)).length*4,0)})));
   context.staffList=staff;
   result.stages[stages[index]]=JSON.parse(JSON.stringify(loaded.fairness.measure(context,staff)));
   return value;
  };
 });
 const context=loaded.e.generateInitialSchedule('2026-11');
 result.sources={};
 for(const day of context.days)for(const [shift,stations] of Object.entries(day.slots))for(const [station,slot]of Object.entries(stations))for(const id of slot.staff){
  const source=slot.assignmentMeta[id].source;
  const key=source==='AUTO_A_AC_LOCK'?'AC':source==='AUTO_A_PHASE3'?'A':source==='AUTO_C_PHASE1'?'C':source.startsWith('AUTO_B_')?'B':source.startsWith('AUTO_SAT_')?'SAT':'FIXED';
  result.sources[id]||={};result.sources[id][key]=(result.sources[id][key]||0)+4;
 }
 return result;
}
const reports=[];
for(const kind of kinds){
 const cohort=require(`./results/${kind}-inputs.json`).fixtures;
 const saved=require(`./results/${kind}-evaluation.json`);
 const valid=saved.runs.filter(r=>r.status==='VALID');
 const measured=cohort.filter(f=>valid.some(r=>r.seed===f.seed)).map(f=>({seed:f.seed,normal:initial(f),swapped:initial(f,'swapSaturdayTies')}));
 for(const run of measured){
  const savedRun=valid.find(r=>r.seed===run.seed);
  assert.deepEqual(run.normal.stages.saturday.score,savedRun.initial.measure.score);
 }
 const ids=cohort[0].staff.map(p=>p.id);
 const table={};
 for(const stage of [...stages,'repaired','final']){
  const measures=stage==='repaired'||stage==='final'?valid.map(r=>r[stage].measure):measured.map(r=>r.normal.stages[stage]);
  table[stage]=ids.map(id=>({id,hours:avg(measures.map(m=>m.staff.find(p=>p.id===id).hours)),attainment:avg(measures.map(m=>m.staff.find(p=>p.id===id).attainment))*100,singles:avg(measures.map(m=>m.staff.find(p=>p.id===id).involuntarySingle))}));
 }
 const sourceHours=ids.map(id=>({id,...Object.fromEntries(['FIXED','C','AC','A','B','SAT'].map(s=>[s,avg(measured.map(r=>r.normal.sources[id]?.[s]||0))]))}));
 const swappedSaturday=ids.map(id=>({id,hours:avg(measured.map(r=>r.swapped.stages.saturday.staff.find(p=>p.id===id).hours)),attainment:avg(measured.map(r=>r.swapped.stages.saturday.staff.find(p=>p.id===id).attainment))*100}));
 const weeklyWeekdayHours=measured[0].normal.weekdays.map((_,w)=>ids.map(id=>({id,hours:avg(measured.map(r=>r.normal.weekdays[w].find(p=>p.id===id).hours)),bHours:avg(measured.map(r=>r.normal.weekdays[w].find(p=>p.id===id).bHours))})));
 reports.push({kind,n:valid.length,table,sourceHours,swappedSaturday,weeklyWeekdayHours});
}
fs.writeFileSync(path.join(__dirname,'results','hours-bias-diagnosis.json'),JSON.stringify(reports,null,2)+'\n');
for(const r of reports){console.log(r.kind,r.n);for(const [stage,staff]of Object.entries(r.table))console.log(stage,staff.map(p=>`${p.id}:${p.hours.toFixed(2)}h/${p.attainment.toFixed(2)}%`).join(' '));console.log('sources',JSON.stringify(r.sourceHours));console.log('swap Saturday tie order',JSON.stringify(r.swappedSaturday));}
