const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toRequests,leaveUnits,generateLeaveFixture,classifySingle}=require('./support/leave-model.cjs');
test('half-day leave costs one unit: one fixed shift and two blocked shifts',()=>{
 const event={staff_id:'FT001',date:'2026-11-03',kind:'half',work:['B']};
 assert.equal(leaveUnits(event),1);
 assert.deepEqual(toRequests([event]).map(r=>[r.shift,r.type]),[['A','off'],['B','fixed'],['C','off']]);
});
test('full-day leave costs two units but blocks all three shifts',()=>{
 const event={staff_id:'FT001',date:'2026-11-03',kind:'full'};
 assert.equal(leaveUnits(event),2);
 assert.deepEqual(toRequests([event]).map(r=>[r.shift,r.type]),[['A','off'],['B','off'],['C','off']]);
});
for(const pair of ['AB','BC','AC'])test(`specified ${pair} costs no leave and counts in pair fairness`,()=>{
 const event={staff_id:'FT001',date:'2026-11-03',kind:'pair',work:pair.split('')};
 assert.equal(leaveUnits(event),0);
 assert.deepEqual(toRequests([event]).filter(r=>r.type==='fixed').map(r=>r.shift),pair.split(''));
 assert.equal(toRequests([event]).filter(r=>r.type==='off').length,1);
});
test('only the matching half-day selection exempts a single, not pediatric fixed source',()=>{
 const events=[{staff_id:'FT001',date:'2026-11-03',kind:'half',work:['A']}];
 assert.equal(classifySingle('FT001','2026-11-03',['A'],events),'voluntarySingle');
 assert.equal(classifySingle('FT003','2026-11-03',['C'],events),'involuntarySingle');
 assert.equal(classifySingle('FT001','2026-11-03',['C'],events),'involuntarySingle');
 assert.equal(classifySingle('FT001','2026-11-03',['A','B'],events),null);
});
test('100 deterministic fixtures have exactly 8 leave units each and cover whole/half mixes',()=>{
 const compositions=new Set();
 for(let seed=1;seed<=100;seed++){
  const f=generateLeaveFixture(seed);assert.deepEqual(generateLeaveFixture(seed),f);
  for(const id of f.staff.map(s=>s.id)){
   const events=f.events.filter(e=>e.staff_id===id);
   assert.equal(events.reduce((sum,e)=>sum+leaveUnits(e),0),8);
   assert.equal(new Set(events.map(e=>e.date)).size,events.length);
   assert.ok(events.every(e=>new Date(`${e.date}T12:00:00+08:00`).getUTCDay()!==0));
   compositions.add(events.filter(e=>e.kind==='full').length);
  }
 }
 assert.deepEqual([...compositions].sort(),[0,1,2,3,4]);
});

const {analyze}=require('./analyze-fairness.cjs');
for(const pair of ['AB','BC','AC'])test(`analysis includes voluntary ${pair} in pair fairness without charging leave`,()=>{
 const event={staff_id:'FT001',date:'2026-11-03',kind:'pair',work:pair.split('')};
 const slots=Object.fromEntries(['A','B','C'].map(shift=>[shift,{ORTHO:{staff:pair.includes(shift)?['FT001']:[]},PEDS:{staff:[]}}]));
 const result=analyze({seed:1,staff:[{id:'FT001'}],events:[event],requests:toRequests([event]),leaveSummary:[]},{days:[{date:event.date,dayOfWeek:2,slots}]});
 assert.equal(result.summary[0][pair],1);assert.equal(result.summary[0].hours,8);assert.equal(result.violations.length,0);
});
test('analysis counts a pediatric single as involuntary while excluding a human half-day single',()=>{
 const event={staff_id:'FT001',date:'2026-11-03',kind:'half',work:['A']};
 const slots=Object.fromEntries(['A','B','C'].map(shift=>[shift,{ORTHO:{staff:shift==='A'?['FT001']:[]},PEDS:{staff:shift==='C'?['FT003']:[]}}]));
 const result=analyze({seed:1,staff:[{id:'FT001'},{id:'FT003'}],events:[event],requests:toRequests([event]),leaveSummary:[]},{days:[{date:event.date,dayOfWeek:2,slots}]});
 assert.equal(result.summary[0].voluntarySingle,1);assert.equal(result.summary[0].involuntarySingle,0);
 assert.equal(result.summary[1].involuntarySingle,1);assert.equal(result.summary[1].pediatricInvoluntarySingle,1);
});
