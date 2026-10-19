const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateScenarioFixture}=require('./support/scenario-fixtures.cjs');
const {toRequests}=require('./support/leave-model.cjs');
function capacity(summary){return 4*(25*2-summary.additionalLeaveUnits);}
function validate(fixture){
 assert.deepEqual(fixture.requests,toRequests(fixture.events));
 assert.equal(new Set(fixture.events.map(e=>`${e.staff_id}/${e.date}`)).size,fixture.events.length);
 for(const event of fixture.events){
  assert.notEqual(new Date(`${event.date}T12:00:00Z`).getUTCDay(),0);
  const requests=fixture.requests.filter(r=>r.staff_id===event.staff_id&&r.date===event.date);
  assert.equal(requests.filter(r=>r.type==='fixed').length,event.kind==='half'?1:0);
  assert.equal(requests.filter(r=>r.type==='off').length,event.kind==='half'?2:3);
 }
}
test('scenario fixtures repeat identically with same seed and vary across seeds',()=>{
 for(const kind of ['full-only','mixed','week-off']){
  assert.deepEqual(generateScenarioFixture(42,{kind}),generateScenarioFixture(42,{kind}));
  assert.notDeepEqual(generateScenarioFixture(42,{kind}).events,generateScenarioFixture(43,{kind}).events);
 }
});
test('100 full-only fixtures give everyone four full days, nine total leave days and 168-hour capacity',()=>{
 for(let seed=1;seed<=100;seed++){
  const f=generateScenarioFixture(seed,{kind:'full-only'});validate(f);
  for(const s of f.leaveSummary){assert.equal(s.fullDays,4);assert.equal(s.halfDays,0);assert.equal(s.totalLeaveDays,9);assert.equal(capacity(s),168);}
 }
});
test('100 mixed fixtures each contain full and half leave and preserve exactly eight half-day units',()=>{
 const fullCounts=new Set(),halfShifts=new Set();
 for(let seed=1;seed<=100;seed++){
  const f=generateScenarioFixture(seed,{kind:'mixed'});validate(f);
  for(const s of f.leaveSummary){assert.ok(s.fullDays>=1&&s.fullDays<=3);assert.ok(s.halfDays>=2);assert.equal(s.additionalLeaveUnits,8);assert.equal(s.totalLeaveDays,9);assert.equal(capacity(s),168);fullCounts.add(s.fullDays);}
  for(const e of f.events.filter(e=>e.kind==='half'))halfShifts.add(e.work[0]);
 }
 assert.deepEqual([...fullCounts].sort(),[1,2,3]);assert.deepEqual([...halfShifts].sort(),['A','B','C']);
});
test('100 week-off fixtures cover all employees and all four complete calendar weeks without resampling',()=>{
 const seen=new Map();
 for(let seed=1;seed<=100;seed++){
  const f=generateScenarioFixture(seed,{kind:'week-off'});validate(f);const w=f.scenario.weekOff;
  seen.set(`${w.staff_id}/${w.start}`,(seen.get(`${w.staff_id}/${w.start}`)||0)+1);
  const person=f.leaveSummary.find(s=>s.id===w.staff_id);
  assert.equal(person.fullDays,6);assert.equal(person.additionalLeaveUnits,12);assert.equal(person.totalLeaveDays,11);assert.equal(capacity(person),152);
  for(const s of f.leaveSummary.filter(s=>s.id!==w.staff_id)){assert.equal(s.totalLeaveDays,9);assert.equal(capacity(s),168);}
  assert.equal((Date.parse(w.end)-Date.parse(w.start))/86400000,6);
  assert.equal(new Date(`${w.start}T12:00:00Z`).getUTCDay(),0);
  const selected=f.events.filter(e=>e.staff_id===w.staff_id);
  assert.equal(selected.length,6);for(const event of selected)assert.ok(event.date>=w.start&&event.date<=w.end);
 }
 assert.equal(seen.size,20);for(const count of seen.values())assert.equal(count,5);
});
test('extraWeek uses four base full days outside the six-day week: no double-counting',()=>{
 for(let seed=1;seed<=100;seed++){
  const f=generateScenarioFixture(seed,{kind:'week-off',extraWeek:true});validate(f);const w=f.scenario.weekOff;
  const selected=f.events.filter(e=>e.staff_id===w.staff_id),summary=f.leaveSummary.find(s=>s.id===w.staff_id);
  assert.equal(selected.filter(e=>e.date>=w.start&&e.date<=w.end).length,6);
  assert.equal(selected.filter(e=>e.date<w.start||e.date>w.end).length,4);
  assert.equal(summary.fullDays,10);assert.equal(summary.totalLeaveDays,15);assert.equal(capacity(summary),120);
 }
});
test('unknown scenario names fail explicitly',()=>assert.throws(()=>generateScenarioFixture(1,{kind:'unknown'}),/Unknown scenario/));
