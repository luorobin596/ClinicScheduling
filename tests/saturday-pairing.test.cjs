const {test}=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const {toRequests}=require('./support/leave-model.cjs');
const date='2026-11-07';
const options={maxCandidatesPerDay:20000,timeLimitMs:100000,now:()=>0};
function fixture(events=[],ids=['FT001','FT002','FT003','FT004','FT005']){
 const staff=ids.map(id=>({id,name:id})),x=engine(toRequests(events),{staff,settings:{pedsAssignments:{}}});
 x.e._assignSaturdayShifts=()=>{};
 const context=x.e.generateInitialSchedule('2026-11');
 context.days=context.days.filter(d=>d.dayOfWeek!==6||d.date===date);
 return {...x,context,staff,allocator:x.box.SaturdayAllocator};
}
function day(context){return context.days.find(d=>d.date===date);}
function pairs(context){const d=day(context);return d.slots.A.ORTHO.staff.filter(id=>d.slots.B.ORTHO.staff.includes(id));}
function position(shift,id){return {date,shift,station:'ORTHO',id};}
function allocate(x,extra={}){return x.allocator.allocate(x.context,x.staff,{...options,...extra});}

test('SP01 free five employees preserve A3/B2 with maximum two AB and evaluate only 30 max-pair plans',()=>{
 const x=fixture(),before=JSON.stringify(x.context),seen=[];
 const result=allocate(x,{onCandidate:event=>seen.push(event.plan)}),report=result.report.days[0];
 assert.equal(report.maxAB,2);assert.equal(report.actualAB,2);assert.equal(report.minSingles,1);assert.equal(report.evaluated,30);assert.equal(report.complete,true);
 assert.equal(seen.length,30);for(const p of seen)assert.equal(p.A.filter(id=>p.B.includes(id)).length,2);
 assert.equal(pairs(result.context).length,2);assert.equal(day(result.context).slots.A.ORTHO.staff.length,3);assert.equal(day(result.context).slots.B.ORTHO.staff.length,2);
 assert.ok(result.context.saturdayPairingRules&&result.context.saturdayPairingRules[date]);assert.equal(JSON.stringify(x.context),before);
});

test('SP02 candidate budget of one can stop fairness search but cannot relax maximum AB structure',()=>{
 const x=fixture(),result=allocate(x,{maxCandidatesPerDay:1}),report=result.report.days[0];
 assert.equal(report.maxAB,2);assert.equal(report.actualAB,2);assert.equal(report.minSingles,1);assert.equal(report.evaluated,1);
 assert.equal(report.complete,false);assert.equal(report.stopReason,'CANDIDATE_LIMIT');assert.equal(pairs(result.context).length,2);
});

test('SP03 one AB-eligible employee plus two A-only and one B-only gives maximum one pair, not two',()=>{
 const x=fixture([{staff_id:'FT002',date,kind:'half',work:['A']},{staff_id:'FT003',date,kind:'half',work:['A']},{staff_id:'FT004',date,kind:'half',work:['B']}],['FT001','FT002','FT003','FT004']);
 const result=allocate(x),report=result.report.days[0];assert.equal(report.targets.A,3);assert.equal(report.targets.B,2);
 assert.equal(report.maxAB,1);assert.equal(report.actualAB,1);assert.equal(report.minSingles,3);assert.deepEqual(Array.from(pairs(result.context)),['FT001']);
});

test('SP04 disjoint A-only and B-only original choices allow zero AB without false infeasibility',()=>{
 const events=['FT001','FT002','FT003'].map(staff_id=>({staff_id,date,kind:'half',work:['A']})).concat(['FT004','FT005'].map(staff_id=>({staff_id,date,kind:'half',work:['B']})));
 const x=fixture(events),result=allocate(x),report=result.report.days[0];
 assert.equal(report.maxAB,0);assert.equal(report.actualAB,0);assert.equal(report.minSingles,5);assert.equal(report.evaluated,1);assert.equal(pairs(result.context).length,0);
});

test('SP05 fixed B-only staff occupy both B slots: other free AB-eligible staff cannot be treated as attainable pairs',()=>{
 const x=fixture(['FT001','FT002'].map(staff_id=>({staff_id,date,kind:'half',work:['B']}))),result=allocate(x),report=result.report.days[0];
 assert.equal(report.targets.A,3);assert.equal(report.targets.B,2);assert.equal(report.maxAB,0);assert.equal(report.actualAB,0);assert.equal(report.minSingles,5);
 for(const id of ['FT001','FT002'])assert.deepEqual(JSON.parse(JSON.stringify(day(result.context).slots.B.ORTHO.assignmentMeta[id])),JSON.parse(JSON.stringify(day(x.context).slots.B.ORTHO.assignmentMeta[id])));
 assert.deepEqual(Array.from(day(result.context).slots.B.ORTHO.staff).sort(),['FT001','FT002']);
});

test('SP06 postprocessing cannot transfer B from AB donor to an empty person while headcounts stay equal',()=>{
 const x=fixture(),context=allocate(x).context,d=day(context),donor=pairs(context)[0],recipient=x.staff.find(p=>!d.slots.A.ORTHO.staff.includes(p.id)&&!d.slots.B.ORTHO.staff.includes(p.id)).id;
 const before=JSON.stringify(context),operation={remove:position('B',donor),add:position('B',recipient),source:'FAIRNESS_ADJUST'};
 assert.throws(()=>x.adjustments.apply(context,[operation],x.staff,{requireMinimumCoverage:false}),e=>e.code==='INTERNAL_INVALID');assert.equal(JSON.stringify(context),before);
});

test('SP07 maximum-pair rule allows changing AB ownership without reducing attainable pair count',()=>{
 const x=fixture(),context=allocate(x).context,d=day(context),donor=pairs(context)[0],recipient=d.slots.A.ORTHO.staff.find(id=>!d.slots.B.ORTHO.staff.includes(id));
 const operation={remove:position('B',donor),add:position('B',recipient),source:'FAIRNESS_ADJUST'};
 const candidate=x.adjustments.apply(context,[operation],x.staff,{requireMinimumCoverage:false});
 assert.equal(pairs(candidate).length,2);assert.ok(pairs(candidate).includes(recipient));assert.ok(!pairs(candidate).includes(donor));
});

test('SP08 changed headcounts recompute attainable maximum: removing unpaired A is legal at A2/B2',()=>{
 const x=fixture(),context=allocate(x).context,d=day(context),single=d.slots.A.ORTHO.staff.find(id=>!d.slots.B.ORTHO.staff.includes(id));
 const candidate=x.adjustments.apply(context,[{remove:position('A',single),source:'COVERAGE_REPAIR'}],x.staff,{requireMinimumCoverage:false});
 assert.equal(day(candidate).slots.A.ORTHO.staff.length,2);assert.equal(day(candidate).slots.B.ORTHO.staff.length,2);assert.equal(pairs(candidate).length,2);
});

test('SP09 changed headcounts cannot freeze actual autos as eligibility: removing paired A must still preserve two possible AB',()=>{
 const x=fixture(),context=allocate(x).context,donor=pairs(context)[0],before=JSON.stringify(context);
 assert.throws(()=>x.adjustments.apply(context,[{remove:position('A',donor),source:'COVERAGE_REPAIR'}],x.staff,{requireMinimumCoverage:false}),e=>e.code==='INTERNAL_INVALID');
 assert.equal(JSON.stringify(context),before);
});

test('SP10 pairing DP table matches independent exhaustive person-pattern oracle under fixed/off/pediatric constraints',()=>{
 const ids=['FT001','FT002','FT003'];
 for(const profile of [['free','free','free'],['halfB','free','free'],['pedsA','halfA','free'],['AB','full','free'],['pedsA','pedsB','AB']]){
  const events=profile.flatMap((kind,i)=>kind==='full'?[{staff_id:ids[i],date,kind:'full'}]:kind==='AB'?[{staff_id:ids[i],date,kind:'pair',work:['A','B']}]:kind.startsWith('half')?[{staff_id:ids[i],date,kind:'half',work:[kind.slice(-1)]}]:[]);
  const x=fixture(events,ids),d=day(x.context);
  profile.forEach((kind,i)=>{if(kind.startsWith('peds'))x.assignments.add(d,kind.slice(-1),'PEDS',ids[i],'PEDS_FIXED','PEDS',['PEDS']);});
  const table={},patterns=[[],['A'],['B'],['A','B']];
  for(const p0 of patterns)for(const p1 of patterns)for(const p2 of patterns){
   const work=[p0,p1,p2];let valid=true;
   for(let i=0;i<ids.length;i++){
    const peds=['A','B'].filter(s=>d.slots[s].PEDS.staff.includes(ids[i]));
    const req=toRequests(events).filter(r=>r.staff_id===ids[i]);
    if(work[i].length+peds.length>2||work[i].some(s=>peds.includes(s))||req.some(r=>r.type==='fixed'&&!work[i].includes(r.shift))||req.some(r=>r.type==='off'&&work[i].includes(r.shift)))valid=false;
   }
   const a=work.filter(p=>p.includes('A')).length,b=work.filter(p=>p.includes('B')).length;
   if(!valid||a>3||b>2)continue;
   const key=`${a}:${b}`,ab=work.filter(p=>p.length===2).length;table[key]=Math.max(table[key]??-1,ab);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(x.allocator.pairingRule(x.context,d,x.staff).maxByCounts)),table,profile.join(','));
  if(profile.every(k=>k==='free')){
   x.assignments.add(d,'A','ORTHO','FT001','AUTO_SAT_A');
   assert.deepEqual(JSON.parse(JSON.stringify(x.allocator.pairingRule(x.context,d,x.staff).maxByCounts)),table,'existing auto staff must not narrow original eligibility');
  }
 }
});

test('SP11 caller cannot bypass touched-Saturday pairing guard by supplying an empty saturdayDates option',()=>{
 const x=fixture(),context=allocate(x).context,d=day(context),donor=pairs(context)[0],recipient=x.staff.find(p=>!d.slots.A.ORTHO.staff.includes(p.id)).id;
 assert.throws(()=>x.adjustments.apply(context,[{remove:position('B',donor),add:position('B',recipient),source:'FAIRNESS_ADJUST'}],x.staff,{requireMinimumCoverage:false,saturdayDates:[]}),e=>e.code==='INTERNAL_INVALID');
});
