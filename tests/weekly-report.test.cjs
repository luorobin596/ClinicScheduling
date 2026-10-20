const {test}=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const {toRequests}=require('./support/leave-model.cjs');
const ID='FT001';
const dates=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
function fixture(events=[],selected=dates){
 const h=engine();const c=h.e.createContext('2026-11');c.days=c.days.filter(d=>selected.includes(d.date));
 c.submittedStaffIds=[ID];h.e._fillFixedShifts(c,{},toRequests(events));
 const add=(date,shift,station='ORTHO')=>h.assignments.add(c.days.find(d=>d.date===date),shift,station,ID,'AUTO_TEST',station==='PEDS'?'PEDS_FIXED':'AUTO',station==='PEDS'?['PEDS_FIXED']:[]);
 const peds=(date,shift)=>{add(date,shift,'PEDS');c.constraints.peds[h.assignments.key(date,shift,ID)]=true;};
 const report=()=>require('./support/weekly-report.cjs').summarizeWeeks(c,[{id:ID}]);
 return {c,add,peds,report};
}
function week(x,index=0){const rows=x.report();assert.equal(rows.length,1);assert.equal(rows[0].id,ID);return rows[0].weeks[index];}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);}

test('weekly report: half-day A plus four C-available days targets C3 and early2',()=>{
 const x=fixture([{staff_id:ID,date:dates[0],kind:'half',work:['A']}]);const w=week(x);
 assert.equal(w.openWeekdays,5);assert.equal(w.shortWeek,false);assert.equal(w.workingDays,5);
 assert.equal(w.cAvailableDays,4);assert.equal(w.cTarget,3);assert.equal(w.earlyAvailableDays,5);assert.equal(w.earlyTarget,2);
 assert.equal(w.earlyActual,1);near(w.earlyRate,0.5);assert.equal(w.cActual,0);assert.equal(w.cRate,0);
});
test('weekly report: three available workdays target C3 and early0 without treating personal leave as clinic short week',()=>{
 const x=fixture(dates.slice(3).map(date=>({staff_id:ID,date,kind:'full'})));const w=week(x);
 assert.equal(w.openWeekdays,5);assert.equal(w.shortWeek,false);assert.equal(w.workingDays,3);assert.equal(w.cAvailableDays,3);
 assert.equal(w.cTarget,3);assert.equal(w.earlyTarget,0);assert.equal(w.earlyRate,null);
});
test('weekly report: personally fixed C singles cannot be counted as early opportunities',()=>{
 const x=fixture(dates.map(date=>({staff_id:ID,date,kind:'half',work:['C']})));const w=week(x);
 assert.equal(w.workingDays,5);assert.equal(w.cAvailableDays,5);assert.equal(w.cActual,5);assert.equal(w.cTarget,3);
 assert.equal(w.earlyAvailableDays,0);assert.equal(w.earlyTarget,0);assert.equal(w.earlyActual,0);assert.equal(w.earlyRate,null);near(w.cRate,5/3);
});
test('weekly report: actual early counts A, B, AB once each; AC, BC, C are not early',()=>{
 const x=fixture();x.add(dates[0],'A');x.add(dates[1],'B');x.add(dates[2],'A');x.add(dates[2],'B');
 x.add(dates[3],'A');x.add(dates[3],'C');x.add(dates[4],'B');x.add(dates[4],'C');
 const w=week(x);assert.equal(w.earlyActual,3);assert.equal(w.cActual,2);assert.equal(w.AC,1);near(w.cRate,2/3);near(w.earlyRate,3/2);
});
test('weekly report: cross-station AC includes pediatric C and excludes that date from early opportunities',()=>{
 const x=fixture();x.add(dates[0],'A');x.peds(dates[0],'C');const w=week(x);
 assert.equal(w.AC,1);assert.equal(w.cActual,1);assert.equal(w.earlyActual,0);assert.equal(w.earlyAvailableDays,4);
 assert.equal(w.cAvailableDays,5);assert.equal(w.cTarget,3);assert.equal(w.earlyTarget,2);
});
test('weekly report: pediatric A+B locks consume both daily assignments and prevent C availability',()=>{
 const x=fixture();x.peds(dates[0],'A');x.peds(dates[0],'B');const w=week(x);
 assert.equal(w.cAvailableDays,4);assert.equal(w.cTarget,3);assert.equal(w.earlyActual,1);assert.equal(w.earlyAvailableDays,5);
});
test('weekly report: Saturday is excluded from weekday actual and target totals',()=>{
 const x=fixture([],dates.concat('2026-11-07'));x.add('2026-11-07','A');x.add('2026-11-07','B');const w=week(x);
 assert.equal(w.openWeekdays,5);assert.equal(w.workingDays,5);assert.equal(w.cTarget,3);assert.equal(w.earlyTarget,2);
 assert.equal(w.earlyActual,0);assert.equal(w.cActual,0);assert.equal(w.AC,0);
});
test('weekly report: short final week exposes actual counts and a short-week marker',()=>{
 const x=fixture([],['2026-11-30']);x.add('2026-11-30','B');const w=week(x);
 assert.equal(w.openWeekdays,1);assert.equal(w.shortWeek,true);assert.equal(w.workingDays,1);assert.equal(w.cTarget,1);
 assert.equal(w.earlyTarget,0);assert.equal(w.earlyActual,1);assert.equal(w.earlyRate,null);
});
test('weekly report: unknown submission retains actuals but never presents guessed attainment',()=>{
 const x=fixture();delete x.c.submittedStaffIds;x.add(dates[0],'C');const w=week(x);
 assert.equal(w.cActual,1);assert.equal(w.earlyActual,0);assert.equal(w.cRate,null);assert.equal(w.earlyRate,null);
});
test('weekly report: automatic roster changes cannot change original availability targets',()=>{
 const x=fixture();const before=week(x);for(const date of dates){x.add(date,'A');x.add(date,'C');}const after=week(x);
 for(const key of ['workingDays','cAvailableDays','earlyAvailableDays','cTarget','earlyTarget'])assert.equal(after[key],before[key],key);
 assert.equal(after.cActual,5);assert.equal(after.AC,5);assert.equal(after.earlyActual,0);
});
test('weekly report: average rates exclude N/A and average sample ratios rather than pooled counts',()=>{
 const {averageRates}=require('./support/weekly-report.cjs');
 assert.equal(averageRates([null,null]),null);assert.equal(averageRates([]),null);
 near(averageRates([null,1/1,1/3]),2/3);assert.notEqual(averageRates([1/1,1/3]),2/4);
 assert.equal(averageRates([0,null]),0);
});
test('weekly report: clinic holiday makes a calendar week short and excludes holiday assignments/opportunities',()=>{
 const x=fixture();const holiday=x.c.days.find(d=>d.date===dates[2]);
 holiday.isOpen=false;holiday.isHoliday=true;holiday.slots={};
 x.add(dates[0],'C');const w=week(x);
 assert.equal(w.openWeekdays,4);assert.equal(w.shortWeek,true);assert.equal(w.workingDays,4);
 assert.equal(w.cAvailableDays,4);assert.equal(w.cTarget,3);assert.equal(w.earlyTarget,1);assert.equal(w.cActual,1);
});
test('weekly report: pediatric A or B alone permits C pairing and also permits a non-C work pattern',()=>{
 for(const shift of ['A','B']){
  const x=fixture();x.peds(dates[0],shift);const w=week(x);
  assert.equal(w.cAvailableDays,5);assert.equal(w.earlyAvailableDays,5);assert.equal(w.workingDays,5);
  assert.equal(w.cTarget,3);assert.equal(w.earlyTarget,2);assert.equal(w.earlyActual,1);
 }
});
test('weekly report: all full-day leave yields zero targets with N/A rather than zero attainment',()=>{
 const x=fixture(dates.map(date=>({staff_id:ID,date,kind:'full'})));const w=week(x);
 assert.equal(w.openWeekdays,5);assert.equal(w.shortWeek,false);assert.equal(w.workingDays,0);
 assert.equal(w.cTarget,0);assert.equal(w.earlyTarget,0);assert.equal(w.cRate,null);assert.equal(w.earlyRate,null);
});
test('weekly report: another staff submission does not make this employee capacity known',()=>{
 const x=fixture();x.c.submittedStaffIds=['FT002'];x.add(dates[0],'B');const w=week(x);
 assert.equal(w.earlyActual,1);assert.equal(w.cRate,null);assert.equal(w.earlyRate,null);
});

test('weekly report rendering uses N/A for zero target and explains partial valid samples',()=>{
 const {formatWeeklyCell}=require('./support/weekly-report.cjs');
 assert.equal(formatWeeklyCell([{shortWeek:false,cRate:null}],[{shortWeek:false,cRate:null}],'c'),'N/A → N/A');
 assert.equal(formatWeeklyCell([{shortWeek:false,cRate:null},{shortWeek:false,cRate:0.5}],[{shortWeek:false,cRate:null},{shortWeek:false,cRate:1}],'c'),'50.0%（n=1/2） → 100.0%（n=1/2）');
});
test('weekly report rendering uses actual counts for a short week and rates for a complete personal-leave week',()=>{
 const {formatWeeklyCell}=require('./support/weekly-report.cjs');
 assert.equal(formatWeeklyCell([{shortWeek:true,earlyActual:1,earlyRate:null}],[{shortWeek:true,earlyActual:2,earlyRate:null}],'early'),'1.00 → 2.00 次');
 assert.equal(formatWeeklyCell([{shortWeek:false,cActual:1,cRate:1/3}],[{shortWeek:false,cActual:3,cRate:1}],'c'),'33.3% → 100.0%');
});
