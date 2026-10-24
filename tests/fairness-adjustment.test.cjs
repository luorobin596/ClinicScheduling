const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {toRequests}=require('./support/leave-model.cjs');
function fixture(events=[],ids=['FT001','FT002']) {
 const staff=ids.map(id=>({id,name:id})),requests=toRequests(events);
 const box=vm.createContext({console:{log(){},warn(){}},Session:{getScriptTimeZone:()=> 'Asia/Taipei'},Utilities:{formatDate:(d,z,p)=>p.replace('yyyy',d.getFullYear()).replace('MM',String(d.getMonth()+1).padStart(2,'0')).replace('dd',String(d.getDate()).padStart(2,'0'))},RepoStaff:{getAvailableStaff:()=>staff},RepoRequests:{getAllRequestsByRun:()=>requests}});
 for(const f of ['Config_system.js','scheduling_assignments.js','scheduling_fairness.js','scheduling_adjustments.js','scheduling_engine.js'])if(fs.existsSync(path.join(__dirname,'..','gas',f)))vm.runInContext(fs.readFileSync(path.join(__dirname,'..','gas',f),'utf8'),box);
 vm.runInContext("RulesConfig.loadDynamicConfig=()=>({closedDates:[],minDaysOff:9,monthlyHours:176,pedsAssignments:{}})",box);
 const context=box.SchedulingEngine.createContext('2026-11');context.submittedStaffIds=staff.map(s=>s.id);box.SchedulingEngine._fillFixedShifts(context,{},requests);
 const add=(date,shift,id,station='ORTHO')=>box.ScheduleAssignments.add(context.days.find(d=>d.date===date),shift,station,id,'AUTO_TEST',station==='PEDS'?'PEDS':'AUTO',station==='PEDS'?['PEDS']:[]);
 return {box,context,staff,add};
}
function person(result,id){return result.staff.find(p=>p.id===id);}
function counts(c){return c.days.flatMap(d=>Object.entries(d.slots).flatMap(([s,v])=>Object.entries(v).map(([station,x])=>[d.date,s,station,x.staff.length])));}

test('F01 voluntary half-day single excluded; pediatric single is involuntary; fixed pairs count weekly',()=>{
 const x=fixture([{staff_id:'FT001',date:'2026-11-03',kind:'half',work:['A']},{staff_id:'FT001',date:'2026-11-04',kind:'pair',work:['B','C']}]);
 x.add('2026-11-02','C','FT002','PEDS');
 const m=x.box.ScheduleFairness.measure(x.context,x.staff);
 assert.equal(person(m,'FT001').voluntarySingle,1);assert.equal(person(m,'FT001').involuntarySingle,0);
 assert.equal(person(m,'FT002').involuntarySingle,1);
 assert.equal(person(m,'FT001').weekly.reduce((n,w)=>n+w.BC,0),1);
});
test('F01b full/half/pair consume 2/1/0 half-day units; unfilled automatic slots do not reduce capacity',()=>{
 const x=fixture([{staff_id:'FT001',date:'2026-11-03',kind:'full'},{staff_id:'FT001',date:'2026-11-04',kind:'half',work:['A']},{staff_id:'FT001',date:'2026-11-05',kind:'pair',work:['A','C']}]);
 const before=x.box.ScheduleFairness.measure(x.context,x.staff);assert.equal(person(before,'FT001').capacityHours,188);assert.equal(person(before,'FT002').capacityHours,200);
 x.add('2026-11-06','A','FT001');
 assert.equal(person(x.box.ScheduleFairness.measure(x.context,x.staff),'FT001').capacityHours,188);
});
test('F01b zero capacity reports N/A rather than zero percent',()=>{
 const dates=Array.from({length:30},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`).filter(d=>new Date(`${d}T12:00:00`).getDay()!==0);
 const x=fixture(dates.map(date=>({staff_id:'FT001',date,kind:'full'})));
 const p=person(x.box.ScheduleFairness.measure(x.context,x.staff),'FT001');assert.equal(p.capacityHours,0);assert.equal(p.attainment,null);
});
test('F02 lexicographic comparator cannot trade worse single-day fairness for lower hours/AC; tolerance stable',()=>{
 const {box}=fixture();const cmp=box.ScheduleFairness.compareScores;
 assert.ok(cmp([2,0,0,0,0],[1,100,100,100,100])>0);
 assert.ok(cmp([1,0,0.2,0,0],[1,0,0.1,999,999])>0);
 assert.equal(cmp([1,1e-12],[1,0]),0);
});
test('F02 equal monthly AC totals still expose different weekly fairness',()=>{
 const x=fixture();for(const d of ['2026-11-02','2026-11-03'])for(const s of ['A','C'])x.add(d,s,'FT001');
 for(const d of ['2026-11-09','2026-11-10'])for(const s of ['A','C'])x.add(d,s,'FT002');
 const unfair=x.box.ScheduleFairness.measure(x.context,x.staff);
 const y=fixture();for(const [d,id] of [['2026-11-02','FT001'],['2026-11-03','FT002'],['2026-11-09','FT001'],['2026-11-10','FT002']])for(const s of ['A','C'])y.add(d,s,id);
 const fair=y.box.ScheduleFairness.measure(y.context,y.staff);
 assert.ok(x.box.ScheduleFairness.compareScores(fair.score,unfair.score)<0);
});
test('F03 improve keeps each station headcount, locked choices and minimum coverage while improving score',()=>{
 const x=fixture([],['FT001','FT002','FT003']);
 x.context.days=x.context.days.filter(d=>['2026-11-02','2026-11-03'].includes(d.date));
 for(const d of x.context.days){x.add(d.date,'A','FT001');x.add(d.date,'B','FT002');x.add(d.date,'C','FT002');}
 const before=x.box.ScheduleFairness.measure(x.context,x.staff),original=JSON.stringify(x.context);
 const result=x.box.ScheduleAdjustments.improve(x.context,x.staff,{maxCandidates:2000,maxAccepted:20,timeLimitMs:10000,now:()=>0});
 assert.equal(JSON.stringify(x.context),original);assert.deepEqual(counts(result.context),counts(x.context));
 assert.ok(x.box.ScheduleFairness.compareScores(x.box.ScheduleFairness.measure(result.context,x.staff).score,before.score)<0);
 assert.equal(x.box.ScheduleAdjustments.coverage(result.context).length,0);
 assert.ok(result.context.adjustmentHistory.length>0);
 for(const h of result.context.adjustmentHistory){
  assert.equal(h.beforeSources.length,h.operations.length);assert.equal(h.afterSources.length,h.operations.length);
  for(let i=0;i<h.operations.length;i++){
   assert.ok(['AUTO_TEST','FAIRNESS_ADJUST'].includes(h.beforeSources[i]));
   assert.equal(h.afterSources[i],'FAIRNESS_ADJUST');
   assert.equal(h.operations[i].source,'FAIRNESS_ADJUST');
  }
 }
 const adjusted=result.context.days.flatMap(d=>Object.values(d.slots).flatMap(s=>Object.values(s.ORTHO.assignmentMeta))).filter(m=>m.source==='FAIRNESS_ADJUST');
 assert.ok(adjusted.length>0);assert.ok(adjusted.every(m=>m.originalSource==='AUTO_TEST'));
});
test('F03 exhausted fairness budget retains lawful incumbent and reports stop',()=>{
 const x=fixture();x.context.days=x.context.days.filter(d=>d.date==='2026-11-02');x.add('2026-11-02','A','FT001');x.add('2026-11-02','B','FT002');x.add('2026-11-02','C','FT002');
 const result=x.box.ScheduleAdjustments.improve(x.context,x.staff,{maxCandidates:0,maxAccepted:0,timeLimitMs:10000,now:()=>0});
 assert.deepEqual(counts(result.context),counts(x.context));assert.ok(result.report);assert.match(JSON.stringify(result.report),/LIMIT|budget|limit/i);
});
test('F01b capacity 168/144 with 140/120 actual hours has identical attainment',()=>{
 const open=Array.from({length:30},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`).filter(d=>new Date(`${d}T12:00:00`).getDay()!==0);
 const events=[...open.slice(0,4).map(date=>({staff_id:'FT001',date,kind:'full'})),...open.slice(0,7).map(date=>({staff_id:'FT002',date,kind:'full'}))];
 const x=fixture(events);
 for(const [id,start,target] of [['FT001',4,35],['FT002',7,30]]){
  let assigned=0;for(const date of open.slice(start))for(const shift of ['A','B'])if(assigned<target){x.add(date,shift,id);assigned++;}
 }
 const m=x.box.ScheduleFairness.measure(x.context,x.staff),a=person(m,'FT001'),b=person(m,'FT002');
 assert.equal(a.capacityHours,168);assert.equal(b.capacityHours,144);assert.equal(a.hours,140);assert.equal(b.hours,120);assert.ok(Math.abs(a.attainment-b.attainment)<1e-9);assert.equal(m.score[2],0);
});
test('F01b zero capacity with actual work throws inconsistency rather than hiding it from fairness',()=>{
 const dates=Array.from({length:30},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`).filter(d=>new Date(`${d}T12:00:00`).getDay()!==0);
 const x=fixture(dates.map(date=>({staff_id:'FT001',date,kind:'full'})));x.add('2026-11-02','A','FT001');
 assert.throws(()=>x.box.ScheduleFairness.measure(x.context,x.staff));
});
test('F01b missing submission markers and requests means unknown capacity, never assumed zero leave',()=>{
 const x=fixture();delete x.context.submittedStaffIds;
 assert.equal(x.context.requests.length,0);
 const result=x.box.ScheduleFairness.measure(x.context,x.staff);
 for(const p of result.staff){assert.equal(p.capacityKnown,false);assert.equal(p.capacityHours,null);assert.equal(p.attainment,null);}
 assert.equal(result.warnings.length,x.staff.length);assert.ok(result.warnings.every(w=>w.code==='CAPACITY_UNKNOWN'));
});
