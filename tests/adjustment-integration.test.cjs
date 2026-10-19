const {test}=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const {fakeSheets}=require('./support/fake-sheets.cjs');
const {toRequests}=require('./support/leave-model.cjs');
const staff=['FT001','FT002'].map(id=>({id,name:id}));
const search={maxCandidates:1000,maxAccepted:20,timeLimitMs:10000,now:()=>0};
function finalEngine(requests=[],fake=fakeSheets()) {
 const harness=engine(requests,{final:true,save:true,spreadsheet:fake.spreadsheet,staff,settings:{pedsAssignments:{}}});
 const create=harness.e.createContext.bind(harness.e);
 harness.e.createContext=runId=>{const c=create(runId);c.days=c.days.filter(d=>d.date==='2026-11-30');return c;};
 return {...harness,fake};
}
function outputRows(fake){return fake.operations.filter(o=>o.type==='write').flatMap(o=>o.values);}

test('I01 real final pipeline repairs short-week missing B before first backend write',()=>{
 const x=finalEngine();
 const initial=x.e.generateInitialSchedule('2026-11');assert.equal(initial.days[0].slots.B.ORTHO.staff.length,0);assert.equal(x.fake.operations.length,0);
 const originalGetRange=x.fake.sheet.getRange.bind(x.fake.sheet);
 x.fake.sheet.getRange=(...args)=>{const range=originalGetRange(...args),set=range.setValues.bind(range);range.setValues=rows=>{
  const orthopedic=rows.filter(r=>r[12]==='ORTHO');
  assert.ok(orthopedic.find(r=>r[2]==='B'&&r.slice(3,7).some(Boolean)),'B must be staffed when the first write occurs');
  return set(rows);
 };return range;};
 const result=x.e.generateSchedule('2026-11',search);
 assert.equal(x.adjustments.coverage(result).length,0);assert.equal(x.requestReads(),2);
 const rows=outputRows(x.fake);assert.equal(rows.length,3);
 for(const row of rows){assert.equal(row.length,16);assert.equal(row[0],'2026-11');assert.equal(row[12],'ORTHO');}
 const b=rows.find(r=>r[2]==='B');assert.ok(b.slice(3,7).some(Boolean));assert.ok(result.adjustmentReport);
});

test('I01 genuinely unavailable minimum coverage rejects before clearing or writing old schedule',()=>{
 const fake=fakeSheets([['header'],['description'],['2026-11','old preserved record']]);
 const requests=toRequests(staff.map(s=>({staff_id:s.id,date:'2026-11-30',kind:'full'})));
 const x=finalEngine(requests,fake),before=JSON.stringify(fake.rows);
 assert.throws(()=>x.e.generateSchedule('2026-11',search),e=>['COVERAGE_UNRESOLVED','INPUT_CONFLICT'].includes(e.code));
 assert.equal(fake.operations.length,0);assert.equal(JSON.stringify(fake.rows),before);
});

test('I01 missing person provenance is rejected before any destructive Sheet operation',()=>{
 const fake=fakeSheets([['header'],['description'],['2026-11','old preserved record']]),x=finalEngine([],fake);
 const initial=x.e.generateInitialSchedule.bind(x.e);
 x.e.generateInitialSchedule=runId=>{const c=initial(runId);const slot=c.days[0].slots.A.ORTHO;delete slot.assignmentMeta[slot.staff[0]];return c;};
 assert.throws(()=>x.e.generateSchedule('2026-11',search),e=>e.code==='INTERNAL_INVALID');assert.equal(fake.operations.length,0);
});

test('I01 persistence failure reports BACKEND_WRITE and retains old target rows for diagnosis',()=>{
 const oldTarget=['2026-11','2026-11-30','A','OLD_STAFF','','','','',2,'LEGACY','','','ORTHO','system','old timestamp','old note'];
 const fake=fakeSheets([['header'],['description'],['2026-10','other month untouched'],oldTarget]);
 const originalGetRange=fake.sheet.getRange.bind(fake.sheet);
 fake.sheet.getRange=(...args)=>{const range=originalGetRange(...args);range.setValues=()=>{throw new Error('simulated Sheets write failure');};return range;};
 const x=finalEngine([],fake);
 assert.throws(()=>x.e.generateSchedule('2026-11',search),error=>{
  assert.equal(error.code,'PERSISTENCE_FAILED');assert.equal(error.details.stage,'BACKEND_WRITE');
  assert.ok(JSON.stringify(error.details.oldRows).includes('OLD_STAFF'),'old target schedule snapshot must be available after partial write');
  return true;
 });
 assert.ok(fake.rows.some(r=>r[0]==='2026-10'));
});
