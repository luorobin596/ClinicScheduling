// Human leave intent is separate from blocked scheduling slots.
const SHIFTS = ['A','B','C'];
function leaveUnits(event) {
  if(event.kind==='half')return 1;
  if(event.kind==='full')return 2;
  if(event.kind==='pair')return 0;
  throw new Error(`Unknown leave kind: ${event.kind}`);
}
function toRequests(events) {
  return events.flatMap(event=>{
    leaveUnits(event);
    const work=event.work||[];
    if(event.kind==='half' && work.length!==1)throw new Error('Half-day leave requires one chosen work shift');
    if(event.kind==='pair' && (work.length!==2 || new Set(work).size!==2))throw new Error('Pair selection requires two distinct shifts');
    if(event.kind==='full' && work.length)throw new Error('Full-day leave cannot include work');
    if(work.some(s=>!SHIFTS.includes(s)))throw new Error('Unknown work shift');
    return SHIFTS.map(shift=>({staff_id:event.staff_id,date:event.date,shift,type:work.includes(shift)?'fixed':'off'}));
  });
}
function classifySingle(id,date,assigned,events) {
  if(assigned.length!==1)return null;
  return events.some(e=>e.staff_id===id && e.date===date && e.kind==='half' && e.work[0]===assigned[0])?'voluntarySingle':'involuntarySingle';
}
function generateLeaveFixture(seed, {pairSelectionsPerStaff=0}={}) {
  let state=seed>>>0;
  const random=()=>{
    state=(state+0x6D2B79F5)>>>0;
    let t=Math.imul(state^(state>>>15),1|state);
    t^=t+Math.imul(t^(t>>>7),61|t);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
  const staff=Array.from({length:5},(_,i)=>({id:`FT00${i+1}`,name:`測試員工${i+1}`}));
  const days=Array.from({length:30},(_,i)=>({date:`2026-11-${String(i+1).padStart(2,'0')}`,weekday:new Date(Date.UTC(2026,10,i+1)).getUTCDay()}));
  const events=[],leaveSummary=[];
  for(const person of staff){
    const available=days.filter(d=>d.weekday!==0);
    for(let i=available.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[available[i],available[j]]=[available[j],available[i]];}
    // No observed clinic distribution was supplied: sample fullDays uniformly from 0..4.
    const fullDays=Math.floor(random()*5), halfDays=8-fullDays*2;
    let index=0;
    for(let i=0;i<fullDays;i++)events.push({staff_id:person.id,date:available[index++].date,kind:'full'});
    for(let i=0;i<halfDays;i++){
      const day=available[index++], shifts=day.weekday===6?['A','B']:SHIFTS;
      events.push({staff_id:person.id,date:day.date,kind:'half',work:[shifts[Math.floor(random()*shifts.length)]]});
    }
    for(let i=0;i<pairSelectionsPerStaff;i++){
      const day=available[index++];
      const pairs=day.weekday===6?['AB']:['AB','BC','AC'];
      events.push({staff_id:person.id,date:day.date,kind:'pair',work:pairs[Math.floor(random()*pairs.length)].split('')});
    }
    leaveSummary.push({id:person.id,sundays:5,fullDays,halfDays,additionalLeaveUnits:fullDays*2+halfDays,totalLeaveDays:5+fullDays+halfDays/2});
  }
  return {seed,staff,events,requests:toRequests(events),leaveSummary};
}
module.exports={leaveUnits,toRequests,classifySingle,generateLeaveFixture};
