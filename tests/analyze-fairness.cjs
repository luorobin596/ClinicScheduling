// Human leave model v3 with orthopedic minimum coverage. Offline only: real engine; fake Google reads and no output writes.
const fs=require('node:fs');
const path=require('node:path');
const {engine}=require('./support/engine-harness.cjs');
const {generateLeaveFixture,classifySingle}=require('./support/leave-model.cjs');
const {coverageFindings,potentialCoverageDays}=require('./support/daily-coverage.cjs');
const metrics=['hours','involuntarySingle','voluntarySingle','AC','BC','AB'];
const stats=values=>values.length?{min:Math.min(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values)}:null;
function analyze(fixture,context){
 const summary=fixture.staff.map(s=>({id:s.id,shifts:0,hours:0,workDays:0,offDays:0,involuntarySingle:0,voluntarySingle:0,pediatricInvoluntarySingle:0,AC:0,BC:0,AB:0,weekly:[]}));
 const violations=[];
 for(const day of context.days){
  for(const [shift,stations]of Object.entries(day.slots)){
   const cap=day.dayOfWeek===6&&shift==='B'?2:3;
   if(stations.ORTHO.staff.length>cap)violations.push({type:'overstaffed',date:day.date,shift});
   const all=Object.values(stations).flatMap(s=>Array.from(s.staff));
   if(new Set(all).size!==all.length)violations.push({type:'double-station',date:day.date,shift});
   for(const id of all)if(fixture.requests.some(r=>r.staff_id===id&&r.date===day.date&&r.shift===shift&&r.type==='off'))violations.push({type:'leave',date:day.date,shift,id});
  }
  for(const person of summary){
   const assigned=Object.keys(day.slots).filter(s=>Object.values(day.slots[s]).some(slot=>slot.staff.includes(person.id))).sort();
   const event=fixture.events.find(e=>e.staff_id===person.id&&e.date===day.date);
   if(event && assigned.join('')!==(event.work||[]).slice().sort().join(''))violations.push({type:'selection-mismatch',id:person.id,date:day.date});
   if(assigned.length>2)violations.push({type:'daily-limit',id:person.id,date:day.date});
   person.shifts+=assigned.length;person.hours+=assigned.length*4;
   person[assigned.length?'workDays':'offDays']++;
   const week=Math.floor((Number(day.date.slice(-2))-1)/7); // Nov 2026 starts on Sunday.
   if(!person.weekly[week])person.weekly[week]={week:week+1,AC:0,BC:0,AB:0,weekdayAC:0,weekdayBC:0,weekdayAB:0};
   const pattern=assigned.join('');
   if(['AC','BC','AB'].includes(pattern)){
    person[pattern]++;person.weekly[week][pattern]++;
    if(day.dayOfWeek!==6)person.weekly[week][`weekday${pattern}`]++;
   }
   const single=classifySingle(person.id,day.date,assigned,fixture.events);
   if(single){
    person[single]++;
    if(single==='involuntarySingle'&&day.slots[assigned[0]].PEDS.staff.includes(person.id))person.pediatricInvoluntarySingle++;
   }
  }
 }
 return {seed:fixture.seed,leaveSummary:fixture.leaveSummary,events:fixture.events,summary,violations,minimumCoverageFindings:coverageFindings(context.days,{station:'ORTHO'})};
}
function scenario(pairSelectionsPerStaff){
 const runs=[],inputConflicts=[];
 for(let seed=1;seed<=2000&&runs.length<100;seed++){
  const fixture=generateLeaveFixture(seed,{pairSelectionsPerStaff});
  let context;
  try{
   const {e,rules}=engine(fixture.requests);
   const initialized=e.createContext('2026-11');
   e._fillFixedShifts(initialized,rules,fixture.requests);
   const unavailable=coverageFindings(potentialCoverageDays(initialized,fixture.staff,e),{station:'ORTHO'});
   if(unavailable.length){inputConflicts.push({seed,message:'骨科最低覆蓋可用人力不足',days:unavailable});continue;}
   context=e.generateSchedule('2026-11');
  }
  catch(error){
   if(!/^(小兒代班衝突|骨科固定班超額)：/.test(error.message))throw error;
   inputConflicts.push({seed,message:error.message});continue;
  }
  runs.push(analyze(fixture,context));
 }
 if(runs.length!==100)throw new Error('Could not obtain 100 coordinated fixtures');
 const byStaff=runs[0].summary.map((s,i)=>({id:s.id,...Object.fromEntries(metrics.map(m=>[m,stats(runs.map(r=>r.summary[i][m]))]))}));
 const monthlySpread=Object.fromEntries(metrics.map(m=>[m,stats(runs.map(r=>Math.max(...r.summary.map(s=>s[m]))-Math.min(...r.summary.map(s=>s[m]))))]));
 const fullWeekSpread=Object.fromEntries(['AC','BC','AB'].map(m=>[m,stats(runs.flatMap(r=>[0,1,2,3].map(w=>Math.max(...r.summary.map(s=>s.weekly[w][`weekday${m}`]))-Math.min(...r.summary.map(s=>s.weekly[w][`weekday${m}`])))))]));
 const fullDayDistribution={};
 for(const r of runs)for(const s of r.leaveSummary)fullDayDistribution[s.fullDays]=(fullDayDistribution[s.fullDays]||0)+1;
 return {pairSelectionsPerStaff,attempted:runs.length+inputConflicts.length,successful:runs.length,minimumCoveragePassedRuns:runs.filter(r=>!r.minimumCoverageFindings.length).length,inputConflicts,fullDayDistribution,byStaff,monthlySpread,fullWeekSpread,violationRuns:runs.filter(r=>r.violations.length).length,coverageViolationRuns:runs.filter(r=>r.minimumCoverageFindings.length).length,coverageViolationDays:runs.reduce((n,r)=>n+r.minimumCoverageFindings.length,0),runs};
}
module.exports={analyze,scenario};
if(require.main===module){
const report={modelVersion:3,conditions:{month:'2026-11',minimumCoverage:{station:'ORTHO',weekday:{staff:2,shifts:['A','B','C']},saturday:{staff:1,additionalShiftRequirement:false}},totalLeaveDays:9,sundayDays:5,additionalLeaveUnits:8,half:'1 fixed shift; other two off; costs 1 unit',full:'ABC off; costs 2 units',pair:'2 fixed shifts; remaining shift off; costs 0 units; included in pair fairness',pedsAssignments:{PEDS_PATTERN_1:'FT003',PEDS_PATTERN_2:'FT002'},distributionAssumption:'fullDays sampled uniformly 0..4; rest halfDays=8-2*fullDays; not an observed clinic distribution',sampling:'first 100 inputs passing necessary availability screening and engine execution per scenario; successful means execution completed, not minimum coverage passed; all coverage failures are retained; fairness includes these failing schedules and is diagnostic only',weeklyComparison:'four full weeks; weekdays only; monthly pairs include Saturdays'},scenarios:[scenario(0),scenario(1)]};
fs.writeFileSync(path.join(__dirname,'fairness-human-leave-coverage-2026-11.json'),JSON.stringify(report,null,2)+'\n');
for(const s of report.scenarios)console.log(JSON.stringify({...s,runs:undefined,inputConflicts:{total:s.inputConflicts.length,pediatric:s.inputConflicts.filter(x=>x.message.startsWith('小兒')).length,fixedOverload:s.inputConflicts.filter(x=>x.message.startsWith('骨科固定')).length,minimumCoverage:s.inputConflicts.filter(x=>x.message.startsWith('骨科最低')).length}},null,2));
}
