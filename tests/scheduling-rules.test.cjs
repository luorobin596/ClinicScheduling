const {test} = require('node:test');
const assert = require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const {generateLeaveFixture}=require('./support/leave-model.cjs');
function initialized(requests=[]){const {e,rules}=engine(requests);const c=e.createContext('2026-11');e._fillFixedShifts(c,rules,requests);return {e,c};}
test('AC assignment never exceeds the three-person orthopedic limit',()=>{
  const {e,c}=initialized();e._assignWeekdayShifts(c);
  for(const d of c.days)for(const [s,slot]of Object.entries(d.slots))assert.ok(slot.ORTHO.staff.length<=3,`${d.date} ${s}: ${slot.ORTHO.staff.length}`);
});
test('pediatrics does not consume the orthopedic third position',()=>{
 const {e,c}=initialized();const d=c.days.find(d=>d.date==='2026-11-02');
 d.slots.C.ORTHO.staff=['FT001','FT004'];
 e._assignWeekdayShifts({days:[d]});
 assert.equal(d.slots.C.PEDS.staff.length,1);assert.equal(d.slots.C.ORTHO.staff.length,3);
});
test('FT002 covers FT003 Monday pediatric leave',()=>{
 const {c}=initialized([{staff_id:'FT003',date:'2026-11-02',shift:'C',type:'off'}]);
 assert.deepEqual(Array.from(c.days.find(d=>d.date==='2026-11-02').slots.C.PEDS.staff),['FT002']);
});
test('overlapping pediatric leave is rejected',()=>{
 assert.throws(()=>initialized(['FT002','FT003'].map(staff_id=>({staff_id,date:'2026-11-02',shift:'C',type:'off'}))),/2026-11-02.*C/);
});
test('Saturday fixed orthopedic assignments count toward capacity',()=>{
 const {e,c}=initialized([{staff_id:'FT005',date:'2026-11-07',shift:'A',type:'fixed'}]);
 e._assignSaturdayShifts(c,{});
 const d=c.days.find(d=>d.date==='2026-11-07');assert.equal(d.slots.A.ORTHO.staff.length,3);assert.equal(d.slots.B.ORTHO.staff.length,2);
});

test('fixed orthopedic requests cannot exceed configured capacity',()=>{
 assert.throws(()=>initialized([1,2,3,4].map(i=>({staff_id:`FT00${i}`,date:'2026-11-03',shift:'A',type:'fixed'}))),/2026-11-03.*A/);
});

for (const [date, shift, limit] of [
 ['2026-11-03','A',3], ['2026-11-03','B',3], ['2026-11-03','C',3],
 ['2026-11-07','A',3], ['2026-11-07','B',2]
]) test(`${date} ${shift}: full fixed roster stays at ${limit}; one extra is rejected`,()=>{
 const requests=Array.from({length:limit},(_,i)=>({staff_id:`FT00${i+1}`,date,shift,type:'fixed'}));
 const {e}=engine(requests);const context=e.generateSchedule('2026-11');
 assert.equal(context.days.find(d=>d.date===date).slots[shift].ORTHO.staff.length,limit);
 assert.throws(()=>engine([...requests,{staff_id:`FT00${limit+1}`,date,shift,type:'fixed'}]).e.generateSchedule('2026-11'),new RegExp(`${date}.*${shift}`));
});

test('100 coordinated human leave models obey limits and chosen shifts',()=>{
 let successes=0, conflicts=0;
 for(let seed=1;seed<=2000 && successes<100;seed++){
  const fixture=generateLeaveFixture(seed);
  let context;
  try { context=engine(fixture.requests).e.generateSchedule('2026-11'); }
  catch(error){
   if(!/^(小兒代班衝突|骨科固定班超額)：/.test(error.message))throw error;
   conflicts++;continue; // Recorded infeasible inputs, never alter selected intent.
  }
  successes++;
  for(const day of context.days)for(const [shift,stations]of Object.entries(day.slots)){
   const cap=day.dayOfWeek===6&&shift==='B'?2:3;
   assert.ok(stations.ORTHO.staff.length<=cap,`seed ${seed}, ${day.date} ${shift}`);
   for(const station of Object.values(stations))for(const id of station.staff){
    assert.ok(!fixture.requests.some(r=>r.staff_id===id && r.date===day.date && r.shift===shift && r.type==='off'));
   }
   assert.equal(new Set([...stations.ORTHO.staff,...stations.PEDS.staff]).size,stations.ORTHO.staff.length+stations.PEDS.staff.length);
  }
  for(const event of fixture.events){
   const day=context.days.find(d=>d.date===event.date);
   const actual=Object.keys(day.slots).filter(s=>Object.values(day.slots[s]).some(slot=>slot.staff.includes(event.staff_id))).sort();
   assert.deepEqual(actual,event.work?event.work.slice().sort():[],`seed ${seed} ${event.staff_id} ${event.date} ${event.kind}`);
  }
 }
 assert.equal(successes,100);
 assert.ok(conflicts>0); // Conflicting random intentions require coordination.
});

test('already full weekday A/B/C rosters receive no additional automatic assignments',()=>{
 const {e,rules}=engine();
 // Existing global configuration is the engine's source of truth.
 const context=e.createContext('2026-11');e._fillFixedShifts(context,rules,[]);
 // Full rosters in every weekday shift must never receive another assignment.
 for(const d of context.days)if(d.isOpen && d.dayOfWeek!==6)for(const slot of Object.values(d.slots))slot.ORTHO.staff=['X1','X2','X3'];
 e._assignWeekdayShifts(context);e._assignWeekdayBShifts(context);
 for(const d of context.days)if(d.isOpen && d.dayOfWeek!==6)for(const slot of Object.values(d.slots))assert.equal(slot.ORTHO.staff.length,3);
});
