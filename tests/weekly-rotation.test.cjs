const {test}=require('node:test');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const staff=ids=>ids.map(id=>({id:`FT00${id}`,name:`員工${id}`}));
const ids=list=>Array.from(list,s=>s.id.slice(-1)).join('');
test('five FT use the agreed paired forward/reverse sequence for ten weeks',()=>{
 const {e}=engine();const list=staff([5,3,1,4,2]);
 const expected=['12345','54321','23451','15432','34512','21543','45123','32154','51234','43215'];
 for(let week=0;week<10;week++)assert.equal(ids(e._getWeeklyStaffOrder(list,week)),expected[week]);
 assert.equal(ids(e._getWeeklyStaffOrder(list,10)),'12345');
 assert.equal(ids(list),'53142');
});
test('rotation adapts to four, one, and zero participating FT',()=>{
 const {e}=engine();const list=staff([4,2,1,3]);
 assert.deepEqual([0,1,2,3,4,5,6,7].map(w=>ids(e._getWeeklyStaffOrder(list,w))),['1234','4321','2341','1432','3412','2143','4123','3214']);
 assert.equal(ids(e._getWeeklyStaffOrder(staff([2]),9)),'2');
 assert.deepEqual(Array.from(e._getWeeklyStaffOrder([],9)),[]);
});
test('each completed pair of weeks gives every FT the same mean rank',()=>{
 const {e}=engine();const list=staff([1,2,3,4,5]);
 for(let w=0;w<10;w+=2){
  const forward=e._getWeeklyStaffOrder(list,w), reverse=e._getWeeklyStaffOrder(list,w+1);
  for(const person of list)assert.equal(forward.findIndex(s=>s.id===person.id)+reverse.findIndex(s=>s.id===person.id)+2,6);
 }
});
test('both weekday stages use identical paired rotation including the short final week',()=>{
 const {e}=engine();const calls=[];
 const original=e._getWeeklyStaffOrder;
 e._getWeeklyStaffOrder=function(list,w){const order=original.call(this,list,w);calls.push({week:w,order:ids(order)});return order;};
 e.generateSchedule('2026-11');
 const expected=['12345','54321','23451','15432','34512'].map((order,week)=>({week,order}));
 assert.deepEqual(calls,[...expected,...expected]);
});
