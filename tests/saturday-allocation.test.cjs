const {test}=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const {toRequests}=require('./support/leave-model.cjs');
const date='2026-11-07';
const options={maxCandidatesPerDay:20000,timeLimitMs:100000,now:()=>0};
function fixture(events=[],ids=['FT001','FT002','FT003','FT004','FT005']){
 const staff=ids.map(id=>({id,name:id}));
 const x=engine(toRequests(events),{staff,settings:{pedsAssignments:{}}});
 x.e._assignSaturdayShifts=()=>{};
 const context=x.e.generateInitialSchedule('2026-11');
 // Retain weekday evidence and calendar week boundaries, with only one Saturday to allocate.
 context.days=context.days.filter(d=>d.dayOfWeek!==6||d.date===date);
 return {...x,context,staff,allocator:x.box.SaturdayAllocator};
}
function roster(c){const day=c.days.find(d=>d.date===date);return {A:Array.from(day.slots.A.ORTHO.staff).sort(),B:Array.from(day.slots.B.ORTHO.staff).sort()};}
function planScore(x,context,plan,targetDate=date){
 const copy=JSON.parse(JSON.stringify(context)),day=copy.days.find(d=>d.date===targetDate);
 for(const shift of ['A','B'])day.slots[shift].ORTHO.staff=Array.from(plan[shift]);
 return Array.from(x.fairness.measure(copy,x.staff).score);
}
function combinations(values,count){if(count===0)return [[]];return values.flatMap((v,i)=>combinations(values.slice(i+1),count-1).map(t=>[v,...t]));}
function sameScore(x,a,b){assert.equal(x.fairness.compareScores(a,b),0,`different scores: ${a} versus ${b}`);}

test('SA01 five fully available employees generate exactly 30 maximum-pair A3/B2 plans',()=>{
 const x=fixture(),seen=new Set(),before=JSON.stringify(x.context);
 assert.ok(x.allocator,'SaturdayAllocator must be loaded');
 const result=x.allocator.allocate(x.context,x.staff,{...options,onCandidate:event=>{
  assert.equal(event.date,date);assert.equal(event.plan.A.length,3);assert.equal(event.plan.B.length,2);
  seen.add(JSON.stringify({A:Array.from(event.plan.A).sort(),B:Array.from(event.plan.B).sort()}));
 }});
 assert.equal(seen.size,30);assert.equal(result.report.days.length,1);
 assert.equal(result.report.days[0].evaluated,30);assert.equal(result.report.days[0].complete,true);
 assert.equal(result.report.days[0].targets.A,3);assert.equal(result.report.days[0].targets.B,2);
 assert.equal(roster(result.context).A.length,3);assert.equal(roster(result.context).B.length,2);
 assert.equal(JSON.stringify(x.context),before);
});

test('SA02 fixed AB is included in eligibility, retained once, and keeps original metadata',()=>{
 const x=fixture([{staff_id:'FT001',date,kind:'pair',work:['A','B']}]);
 const result=x.allocator.allocate(x.context,x.staff,options),day=result.context.days.find(d=>d.date===date);
 assert.equal(result.report.days[0].evaluated,12);
 for(const s of ['A','B']){
  assert.equal(day.slots[s].ORTHO.staff.filter(id=>id==='FT001').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(day.slots[s].ORTHO.assignmentMeta.FT001)),JSON.parse(JSON.stringify(x.context.days.find(d=>d.date===date).slots[s].ORTHO.assignmentMeta.FT001)));
 }
});

test('SA02 insufficient supply fills available targets, respects voluntary half day, and never forces unavailable staff',()=>{
 const x=fixture([{staff_id:'FT001',date,kind:'pair',work:['A','B']},{staff_id:'FT002',date,kind:'half',work:['A']},...['FT003','FT004','FT005'].map(staff_id=>({staff_id,date,kind:'full'}))]);
 const result=x.allocator.allocate(x.context,x.staff,options),actual=roster(result.context);
 assert.deepEqual(actual,{A:['FT001','FT002'],B:['FT001']});
 assert.equal(result.report.days[0].targets.A,2);assert.equal(result.report.days[0].targets.B,1);assert.equal(result.report.days[0].evaluated,1);
});

test('SA02 no eligible orthopedic employee is diagnosed without modifying the original context',()=>{
 const x=fixture(['FT001','FT002','FT003','FT004','FT005'].map(staff_id=>({staff_id,date,kind:'full'}))),before=JSON.stringify(x.context);
 assert.throws(()=>x.allocator.allocate(x.context,x.staff,options),e=>e.code==='INPUT_CONFLICT'||e.code==='SATURDAY_TARGET_UNREACHABLE');
 assert.equal(JSON.stringify(x.context),before);
});

test('SA03 SA05 each incremental candidate equals a full month oracle, and selected plan has minimal full score',()=>{
 const x=fixture([{staff_id:'FT001',date:'2026-11-05',kind:'half',work:['C']},{staff_id:'FT003',date:'2026-11-16',kind:'pair',work:['A','C']}]);
 // Pediatric single is work, not a voluntary single. Also retains future fixed work in the baseline.
 x.assignments.add(x.context.days.find(d=>d.date==='2026-11-30'),'A','PEDS','FT001','AUTO_TEST','PEDS',['PEDS']);
 // Use a dedicated future open day and clear a conflicting auto A if present.
 const pedsDay=x.context.days.find(d=>d.date==='2026-11-30');
 if(pedsDay.slots.A.ORTHO.staff.includes('FT001')){
  pedsDay.slots.A.ORTHO.staff.splice(pedsDay.slots.A.ORTHO.staff.indexOf('FT001'),1);delete pedsDay.slots.A.ORTHO.assignmentMeta.FT001;
 }
 const result=x.allocator.allocate(x.context,x.staff,{...options,onCandidate:event=>sameScore(x,Array.from(event.score),planScore(x,x.context,event.plan,event.date))});
 const ids=x.staff.map(p=>p.id).sort(),oracle=[];
 for(const A of combinations(ids,3))for(const B of combinations(ids,2))if(A.filter(id=>B.includes(id)).length===2)oracle.push(planScore(x,x.context,{A,B}));
 oracle.sort((a,b)=>x.fairness.compareScores(a,b));
 sameScore(x,Array.from(result.report.days[0].score),oracle[0]);sameScore(x,planScore(x,x.context,roster(result.context)),oracle[0]);
});

test('SA06 staff row reordering cannot affect plans, score, or calendar-week tie order',()=>{
 const ids=['FT001','FT002','FT003','FT004','FT005'],a=fixture([],ids),b=fixture([],ids.slice().reverse());
 const one=a.allocator.allocate(a.context,a.staff,options),two=b.allocator.allocate(b.context,b.staff,options);
 assert.deepEqual(roster(one.context),roster(two.context));sameScore(a,one.report.days[0].score,two.report.days[0].score);
 const week=a.e._groupDaysByWeek(a.context.days).findIndex(days=>days.some(d=>d.date===date));
 const expected=a.e._getWeeklyStaffOrder(a.staff,week).map(p=>p.id);
 const actual=Array.from(one.report.days[0].order,p=>typeof p==='string'?p:p.id);
 assert.deepEqual(actual,Array.from(expected));
});

test('SA07 candidate-limited allocation returns a legal complete daily plan and explicit incomplete enumeration',()=>{
 const x=fixture(),before=JSON.stringify(x.context),result=x.allocator.allocate(x.context,x.staff,{...options,maxCandidatesPerDay:1});
 assert.equal(result.report.days[0].evaluated,1);assert.equal(result.report.days[0].complete,false);assert.equal(result.report.days[0].stopReason,'CANDIDATE_LIMIT');
 assert.equal(roster(result.context).A.length,3);assert.equal(roster(result.context).B.length,2);assert.equal(JSON.stringify(x.context),before);
});

test('SA07 timeout before any complete plan throws SEARCH_LIMIT and leaves original context unchanged',()=>{
 const x=fixture(),before=JSON.stringify(x.context);let clock=0;
 assert.throws(()=>x.allocator.allocate(x.context,x.staff,{...options,timeLimitMs:0,now:()=>clock++}),e=>e.code==='SEARCH_LIMIT'&&!!e.details);
 assert.equal(JSON.stringify(x.context),before);
});

test('SA05 incremental scores handle zero capacity and unknown submissions exactly like full measure',()=>{
 const allOpen=Array.from({length:30},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`).filter(d=>new Date(`${d}T12:00:00Z`).getUTCDay()!==0);
 const x=fixture(allOpen.map(date=>({staff_id:'FT005',date,kind:'full'})));
 x.context.submittedStaffIds=x.context.submittedStaffIds.filter(id=>id!=='FT004');
 let evaluated=0;
 const result=x.allocator.allocate(x.context,x.staff,{...options,onCandidate:event=>{evaluated++;sameScore(x,Array.from(event.score),planScore(x,x.context,event.plan,event.date));}});
 assert.equal(evaluated,12);assert.ok(!roster(result.context).A.includes('FT005'));assert.ok(!roster(result.context).B.includes('FT005'));
 const measure=x.fairness.measure(result.context,x.staff);
 assert.equal(measure.staff.find(p=>p.id==='FT005').attainment,null);
 assert.ok(measure.warnings.some(w=>w.id==='FT004'&&w.code==='CAPACITY_UNKNOWN'));
});

test('SA07 later-date timeout never commits an earlier Saturday result to the original context',()=>{
 const x=engine([],{settings:{pedsAssignments:{}}});x.e._assignSaturdayShifts=()=>{};
 const context=x.e.generateInitialSchedule('2026-11'),before=JSON.stringify(context),staff=context.staffList;
 let clock=0,events=0;
 assert.throws(()=>x.box.SaturdayAllocator.allocate(context,staff,{...options,timeLimitMs:1000,now:()=>clock,onCandidate:()=>{events++;if(events===30)clock=1000;}}),e=>e.code==='SEARCH_LIMIT'&&!!e.details);
 assert.equal(JSON.stringify(context),before);assert.equal(events,30);
});

test('SA08 initial pipeline preserves every weekday assignment before repair',()=>{
 const fixture=require('./support/leave-model.cjs').generateLeaveFixture(1);
 const old=engine(fixture.requests,{saturdayVersion:'checkpoint'}).e.generateInitialSchedule('2026-11');
 const current=engine(fixture.requests).e.generateInitialSchedule('2026-11');
 const weekdays=c=>c.days.filter(d=>d.dayOfWeek!==6).map(d=>({date:d.date,slots:d.slots}));
 assert.deepEqual(JSON.parse(JSON.stringify(weekdays(current))),JSON.parse(JSON.stringify(weekdays(old))));
 assert.equal(current.saturdayAllocationReport.days.length,4);
 assert.ok(current.saturdayAllocationReport.days.every(d=>d.complete));
});

test('SA04 single fairness remains above hours, including dispersion before attainment',()=>{
 const {fairness}=engine();
 assert.equal(fairness.compareScores([0,0,0.2,1],[1,4,0.01,0]),-1);
 assert.equal(fairness.compareScores([1,4,0.2,1],[1,6,0.01,0]),-1);
});

test('SA01 dynamic FT counts produce legal plan counts without a hardcoded five-person assumption',()=>{
 for(const [size,expected]of [[1,1],[3,3],[6,60]]){
  const x=fixture([],Array.from({length:size},(_,i)=>`FT00${i+1}`));
  const result=x.allocator.allocate(x.context,x.staff,options),day=result.report.days[0];
  assert.equal(day.evaluated,expected);assert.equal(day.complete,true);
  assert.equal(roster(result.context).A.length,Math.min(size,3));assert.equal(roster(result.context).B.length,Math.min(size,2));
 }
});

test('SA02 SA05 Saturday pediatric occupancy removes only that same orthopedic shift and contributes to each full score',()=>{
 const x=fixture(),day=x.context.days.find(d=>d.date===date);
 x.assignments.add(day,'A','PEDS','FT001','PEDS_TEST','PEDS',['PEDS']);
 let evaluated=0;
 const result=x.allocator.allocate(x.context,x.staff,{...options,onCandidate:event=>{
  evaluated++;assert.ok(!event.plan.A.includes('FT001'));
  sameScore(x,Array.from(event.score),planScore(x,x.context,event.plan,event.date));
 }});
 assert.equal(evaluated,12);assert.equal(result.report.days[0].targets.A,3);assert.equal(result.report.days[0].targets.B,2);
 assert.deepEqual(Array.from(result.context.days.find(d=>d.date===date).slots.A.PEDS.staff),['FT001']);
 assert.equal(result.context.days.find(d=>d.date===date).slots.A.PEDS.assignmentMeta.FT001.source,'PEDS_TEST');
});
