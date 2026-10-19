const {toRequests}=require('./leave-model.cjs');

// These are intent fixtures, not successful-schedule samplers. All conflicts remain visible.
function generateScenarioFixture(seed,{kind='mixed',extraWeek=false}={}) {
 if(!['full-only','mixed','week-off'].includes(kind))throw new Error(`Unknown scenario: ${kind}`);
 let state=seed>>>0;
 const random=()=>{state=(state+0x6D2B79F5)>>>0;let t=Math.imul(state^(state>>>15),1|state);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
 const shuffle=values=>{const result=values.slice();for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
 const staff=Array.from({length:5},(_,i)=>({id:`FT00${i+1}`,name:`測試員工${i+1}`}));
 const days=Array.from({length:30},(_,i)=>({date:`2026-11-${String(i+1).padStart(2,'0')}`,weekday:new Date(Date.UTC(2026,10,i+1)).getUTCDay()}));
 const open=days.filter(d=>d.weekday!==0),events=[],leaveSummary=[];
 const index=((Math.trunc(seed)-1)%5+5)%5,weekIndex=((Math.floor((Math.trunc(seed)-1)/5))%4+4)%4;
 const weekStart=1+7*weekIndex,weekDays=days.filter((d,i)=>i+1>=weekStart&&i+1<weekStart+7),weekOpen=weekDays.filter(d=>d.weekday!==0);
 for(let i=0;i<staff.length;i++) {
  const id=staff[i].id,personEvents=[];
  if(kind==='week-off'&&i===index){
   for(const day of weekOpen)personEvents.push({staff_id:id,date:day.date,kind:'full'});
   if(extraWeek){
    const outside=shuffle(open.filter(d=>!weekOpen.some(w=>w.date===d.date)));
    for(const day of outside.slice(0,4))personEvents.push({staff_id:id,date:day.date,kind:'full'});
   }
  } else {
   const available=shuffle(open),fullDays=kind==='mixed'?1+Math.floor(random()*3):4,halfDays=8-2*fullDays;
   let cursor=0;
   for(let n=0;n<fullDays;n++)personEvents.push({staff_id:id,date:available[cursor++].date,kind:'full'});
   for(let n=0;n<halfDays;n++){
    const day=available[cursor++],shifts=day.weekday===6?['A','B']:['A','B','C'];
    personEvents.push({staff_id:id,date:day.date,kind:'half',work:[shifts[Math.floor(random()*shifts.length)]]});
   }
  }
  const fullDays=personEvents.filter(e=>e.kind==='full').length,halfDays=personEvents.filter(e=>e.kind==='half').length;
  events.push(...personEvents);
  leaveSummary.push({id,sundays:5,fullDays,halfDays,additionalLeaveUnits:fullDays*2+halfDays,totalLeaveDays:5+fullDays+halfDays/2});
 }
 const result={seed,staff,events,requests:toRequests(events),leaveSummary,scenario:{kind,extraWeek:!!extraWeek}};
 if(kind==='week-off')result.scenario.weekOff={staff_id:staff[index].id,start:weekDays[0].date,end:weekDays[6].date};
 return result;
}
module.exports={generateScenarioFixture,generator:generateScenarioFixture};
