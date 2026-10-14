const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function engine(requests = []) {
  const box = vm.createContext({console:{log(){},warn(){}},Session:{getScriptTimeZone:()=> 'Asia/Taipei'},Utilities:{formatDate:(d,z,p)=>{const v=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));return p.replace('yyyy',v.year).replace('MM',v.month).replace('dd',v.day);}},RepoStaff:{getAvailableStaff:()=>[1,2,3,4,5].map(i=>({id:`FT00${i}`,name:`員工${i}`}))},RepoRequests:{getAllRequestsByRun:()=>requests}});
  for(const file of ['Config_system.js','scheduling_engine.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),box);
  vm.runInContext("RulesConfig.loadDynamicConfig=()=>({closedDates:[],minDaysOff:9,monthlyHours:176,pedsAssignments:{PEDS_PATTERN_1:'FT003',PEDS_PATTERN_2:'FT002'}}); SchedulingEngine.saveToScheduleOutput=()=>{};",box);
  return {e:box.SchedulingEngine, rules:box.RulesConfig.getPedsRules()};
}
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

test('all orthopedic shifts respect configured caps across 100 random leave months',()=>{
 for(let seed=1;seed<=100;seed++){
  let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const requests=[];
  for(let i=1;i<=5;i++){
   const staff_id=`FT00${i}`, candidates=[];
   for(let d=1;d<=30;d++){
    const weekday=new Date(2026,10,d).getDay();if(!weekday)continue;
    for(const shift of weekday===6?['A','B']:['A','B','C'])candidates.push({staff_id,date:`2026-11-${String(d).padStart(2,'0')}`,shift,type:'off'});
   }
   for(let j=candidates.length-1;j>0;j--){const k=Math.floor(random()*(j+1));[candidates[j],candidates[k]]=[candidates[k],candidates[j]];}
   const dates={};let chosen=0;
   for(const r of candidates){
    if((dates[r.date]||0)>=2)continue;
    if(i===3 && requests.some(q=>q.staff_id==='FT002' && q.date===r.date && q.shift===r.shift))continue;
    requests.push(r);dates[r.date]=(dates[r.date]||0)+1;if(++chosen===8)break;
   }
   assert.equal(chosen,8);
  }
  const context=engine(requests).e.generateSchedule('2026-11');
  for(const day of context.days)for(const [shift,stations]of Object.entries(day.slots)){
   const cap=day.dayOfWeek===6&&shift==='B'?2:3;
   assert.ok(stations.ORTHO.staff.length<=cap,`seed ${seed}, ${day.date} ${shift}`);
   for(const station of Object.values(stations))for(const id of station.staff){
    assert.ok(!requests.some(r=>r.staff_id===id && r.date===day.date && r.shift===shift),`leave conflict: seed ${seed}, ${day.date} ${shift} ${id}`);
   }
   assert.equal(new Set([...stations.ORTHO.staff,...stations.PEDS.staff]).size,stations.ORTHO.staff.length+stations.PEDS.staff.length);
  }
 }
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
