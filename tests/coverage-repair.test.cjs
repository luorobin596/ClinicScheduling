const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {toRequests}=require('./support/leave-model.cjs');
function fixture(events=[],ids=['FT001','FT002']) {
 const staff=ids.map(id=>({id,name:id})),requests=toRequests(events);
 const box=vm.createContext({console:{log(){},warn(){}},Session:{getScriptTimeZone:()=> 'Asia/Taipei'},Utilities:{formatDate:(d,z,p)=>p.replace('yyyy',d.getFullYear()).replace('MM',String(d.getMonth()+1).padStart(2,'0')).replace('dd',String(d.getDate()).padStart(2,'0'))},RepoStaff:{getAvailableStaff:()=>staff},RepoRequests:{getAllRequestsByRun:()=>requests}});
 for(const f of ['Config_system.js','scheduling_assignments.js','scheduling_fairness.js','scheduling_adjustments.js','scheduling_engine.js'])if(fs.existsSync(path.join(__dirname,'..',f)))vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),box);
 vm.runInContext("RulesConfig.loadDynamicConfig=()=>({closedDates:[],minDaysOff:9,monthlyHours:176,pedsAssignments:{}})",box);
 const context=box.SchedulingEngine.createContext('2026-11');context.submittedStaffIds=staff.map(s=>s.id);box.SchedulingEngine._fillFixedShifts(context,{},requests);
 const add=(date,shift,id,station='ORTHO')=>box.ScheduleAssignments.add(context.days.find(d=>d.date===date),shift,station,id,'AUTO_TEST',station==='PEDS'?'PEDS':'AUTO',station==='PEDS'?['PEDS']:[]);
 return {box,context,staff,add};
}

function oneDay(x,date='2026-11-30'){x.context.days=x.context.days.filter(d=>d.date===date);return x;}
function action(date,from,to,id){return {remove:from?{date,shift:from,station:'ORTHO',id}:undefined,add:to?{date,shift:to,station:'ORTHO',id}:undefined,source:'COVERAGE_REPAIR'};}
function count(c){return c.days.reduce((n,d)=>n+Object.values(d.slots).reduce((v,s)=>v+s.ORTHO.staff.length+s.PEDS.staff.length,0),0);}
const options={maxCandidates:5000,maxAccepted:20,timeLimitMs:10000,now:()=>0};
test('R01 pediatric-only shift does not cover orthopedic minimum; stage flag controls coverage check',()=>{
 const x=oneDay(fixture());x.add('2026-11-30','A','FT001');x.add('2026-11-30','C','FT002','PEDS');
 const f=x.box.ScheduleAdjustments.coverage(x.context);assert.equal(f.length,1);assert.deepEqual(Array.from(f[0].missingShifts),['B','C']);assert.equal(f[0].staffShortage,1);
 assert.doesNotThrow(()=>x.box.ScheduleAdjustments.validate(x.context,x.staff,{requireMinimumCoverage:false}));
 assert.throws(()=>x.box.ScheduleAdjustments.validate(x.context,x.staff,{requireMinimumCoverage:true}));
});
test('R01 Saturday requires one orthopedic person, not separate A and B coverage',()=>{
 const x=oneDay(fixture(),'2026-11-07');x.add('2026-11-07','A','FT001');assert.equal(x.box.ScheduleAdjustments.coverage(x.context).length,0);
});
test('R01 validator rejects third daily shift and simultaneous orthopedic/pediatric duplication',()=>{
 const x=oneDay(fixture());for(const s of ['A','B','C'])x.add('2026-11-30',s,'FT001');
 assert.throws(()=>x.box.ScheduleAdjustments.validate(x.context,x.staff,{requireMinimumCoverage:false}));
 const y=oneDay(fixture());y.add('2026-11-30','A','FT001');y.add('2026-11-30','A','FT001','PEDS');
 assert.throws(()=>y.box.ScheduleAdjustments.validate(y.context,y.staff,{requireMinimumCoverage:false}));
});
test('R02 valid move returns independent candidate and does not mutate original constraints',()=>{
 const x=oneDay(fixture());x.add('2026-11-30','A','FT001');x.add('2026-11-30','C','FT001');x.add('2026-11-30','A','FT002');x.add('2026-11-30','C','FT002');
 const before=JSON.stringify(x.context),candidate=x.box.ScheduleAdjustments.apply(x.context,[action('2026-11-30','A','B','FT001')],x.staff,{requireMinimumCoverage:true});
 assert.equal(JSON.stringify(x.context),before);assert.notEqual(candidate,x.context);assert.ok(candidate.days[0].slots.B.ORTHO.staff.includes('FT001'));
});
test('R02 rejected fixed move leaves original context byte-for-byte unchanged',()=>{
 const x=oneDay(fixture([{staff_id:'FT001',date:'2026-11-30',kind:'pair',work:['A','C']}]));const original=JSON.stringify(x.context);
 assert.throws(()=>x.box.ScheduleAdjustments.apply(x.context,[action('2026-11-30','A','B','FT001')],x.staff,{}));assert.equal(JSON.stringify(x.context),original);
});
test('R03 short-week AC rosters repair B through same-day move without increasing shifts',()=>{
 const x=oneDay(fixture());for(const id of ['FT001','FT002'])for(const s of ['A','C'])x.add('2026-11-30',s,id);
 const result=x.box.ScheduleAdjustments.repair(x.context,x.staff,options);
 assert.equal(x.box.ScheduleAdjustments.coverage(result.context).length,0);assert.equal(count(result.context),count(x.context));
});
test('R03 two AB rosters repair missing C without deleting existing A/B coverage',()=>{
 const x=oneDay(fixture());for(const id of ['FT001','FT002'])for(const s of ['A','B'])x.add('2026-11-30',s,id);
 const result=x.box.ScheduleAdjustments.repair(x.context,x.staff,options);assert.equal(x.box.ScheduleAdjustments.coverage(result.context).length,0);assert.equal(count(result.context),4);
});
test('R03 already covered day needs no coverage modifications',()=>{
 const x=oneDay(fixture());x.add('2026-11-30','A','FT001');x.add('2026-11-30','B','FT002');x.add('2026-11-30','C','FT002');
 const result=x.box.ScheduleAdjustments.repair(x.context,x.staff,options);assert.equal(JSON.stringify(result.context.days),JSON.stringify(x.context.days));
});
test('R04 atomic two-operation swap can restore a fixed-size fully occupied roster',()=>{
 const x=oneDay(fixture());for(const id of ['FT001','FT002'])for(const s of ['A','C'])x.add('2026-11-30',s,id);
 const before=JSON.stringify(x.context);
 const result=x.box.ScheduleAdjustments.apply(x.context,[action('2026-11-30','A','B','FT001'),action('2026-11-30','C','A','FT001')],x.staff,{requireMinimumCoverage:true});
 assert.equal(count(result),4);assert.equal(JSON.stringify(x.context),before);assert.ok(result.days[0].slots.A.ORTHO.staff.includes('FT001'));assert.ok(result.days[0].slots.B.ORTHO.staff.includes('FT001'));
});
test('R04 cross-day move may not remove sole remaining donor coverage',()=>{
 const x=fixture();x.context.days=x.context.days.filter(d=>['2026-11-02','2026-11-03'].includes(d.date));
 for(const d of x.context.days){x.add(d.date,'A','FT001');x.add(d.date,'B','FT002');x.add(d.date,'C','FT002');}
 const move={remove:{date:'2026-11-02',shift:'A',station:'ORTHO',id:'FT001'},add:{date:'2026-11-03',shift:'B',station:'ORTHO',id:'FT001'},source:'COVERAGE_REPAIR'};
 assert.throws(()=>x.box.ScheduleAdjustments.apply(x.context,[move],x.staff,{requireMinimumCoverage:true}));
});
test('R05 Saturday empty roster uses one added shift as backup, not a forced AB pair',()=>{
 const x=oneDay(fixture(),'2026-11-07');const result=x.box.ScheduleAdjustments.repair(x.context,x.staff,options);
 assert.equal(x.box.ScheduleAdjustments.coverage(result.context).length,0);assert.equal(count(result.context),1);
});
test('R05 exhausted repair budget throws SEARCH_LIMIT and keeps original unchanged',()=>{
 const x=oneDay(fixture()),before=JSON.stringify(x.context);
 assert.throws(()=>x.box.ScheduleAdjustments.repair(x.context,x.staff,{...options,maxCandidates:0}),e=>e.code==='SEARCH_LIMIT'&&!!e.details);
 assert.equal(JSON.stringify(x.context),before);
});
test('R05 all employees on full leave reports unresolved coverage without claiming success',()=>{
 const x=oneDay(fixture(['FT001','FT002'].map(staff_id=>({staff_id,date:'2026-11-30',kind:'full'}))));
 assert.throws(()=>x.box.ScheduleAdjustments.repair(x.context,x.staff,options),e=>['COVERAGE_UNRESOLVED','INPUT_CONFLICT'].includes(e.code));
});
test('R05 injectable clock safely interrupts incomplete coverage search',()=>{
 const x=oneDay(fixture());let clock=0;
 assert.throws(()=>x.box.ScheduleAdjustments.repair(x.context,x.staff,{...options,timeLimitMs:1,now:()=>clock++}),e=>e.code==='SEARCH_LIMIT'&&!!e.details);
});

test('R01 two remaining staff each with a pediatric shift cannot cover three orthopedic shifts',()=>{
 const x=oneDay(fixture());
 x.add('2026-11-30','B','FT001','PEDS');x.add('2026-11-30','C','FT002','PEDS');
 assert.throws(()=>x.box.ScheduleAdjustments.repair(x.context,x.staff,options),e=>e.code==='INPUT_CONFLICT'&&e.details.date==='2026-11-30');
});
test('R04 repair uses a cross-day donor when every same-day move breaks coverage or availability',()=>{
 const x=fixture([{staff_id:'FT003',date:'2026-11-02',kind:'full'}],['FT001','FT002','FT003']);
 x.context.days=x.context.days.filter(d=>['2026-11-02','2026-11-03'].includes(d.date));
 // On the problem day FT001 is already at the two-shift limit (ORTHO A + PEDS C).
 // FT002 is the sole orthopedic C; FT003 cannot work. A/C cannot move without a new gap.
 x.add('2026-11-02','A','FT001');x.add('2026-11-02','C','FT001','PEDS');x.add('2026-11-02','C','FT002');
 // The next day has a spare A, while B/C are covered by FT001.
 for(const id of ['FT002','FT003'])x.add('2026-11-03','A',id);
 x.add('2026-11-03','B','FT001');x.add('2026-11-03','C','FT001');
 const original=JSON.stringify(x.context),total=count(x.context);
 const result=x.box.ScheduleAdjustments.repair(x.context,x.staff,options);
 assert.equal(x.box.ScheduleAdjustments.coverage(result.context).length,0);assert.equal(count(result.context),total);assert.equal(JSON.stringify(x.context),original);
 const repaired=result.context.days.find(d=>d.date==='2026-11-02');
 assert.deepEqual(Array.from(repaired.slots.B.ORTHO.staff),['FT002']);
 assert.ok(result.context.days.find(d=>d.date==='2026-11-03').slots.A.ORTHO.staff.includes('FT003'));
 assert.ok(result.context.adjustmentHistory.some(h=>h.operations.some(op=>op.remove&&op.add&&op.remove.date!==op.add.date)));
});
