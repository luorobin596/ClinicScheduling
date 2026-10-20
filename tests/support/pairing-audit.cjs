/** Independent brute-force oracle for small offline cohorts; no production DP or cache. */
const assert=require('node:assert/strict');
const key=(date,shift,id)=>JSON.stringify([date,shift,id]);
function* choose(ids,count,start=0,prefix=[]){
 if(!count){yield prefix;return;}
 for(let i=start;i<=ids.length-count;i++)yield* choose(ids,count-1,i+1,prefix.concat(ids[i]));
}
function auditPairing(context,staff){
 const ids=staff.map(p=>p.id),reports=[];
 for(const day of context.days.filter(d=>d.isOpen&&d.dayOfWeek===6)){
  const actual={A:Array.from(day.slots.A.ORTHO.staff),B:Array.from(day.slots.B.ORTHO.staff)};
  let maximum=-1;
  for(const A of choose(ids,actual.A.length))for(const B of choose(ids,actual.B.length)){
   const plan={A,B};
   const valid=ids.every(id=>{
    let count=0;
    for(const shift of ['A','B']){
     const ortho=plan[shift].includes(id),peds=day.slots[shift].PEDS.staff.includes(id);
     if(ortho&&peds)return false;
     if((ortho||peds)&&context.constraints.off[key(day.date,shift,id)])return false;
     if(context.constraints.fixed[key(day.date,shift,id)]&&!ortho&&!peds)return false;
     count+=Number(ortho)+Number(peds);
    }
    return count<=2;
   });
   if(valid)maximum=Math.max(maximum,A.filter(id=>B.includes(id)).length);
  }
  const actualAB=actual.A.filter(id=>actual.B.includes(id)).length;
  assert.ok(maximum>=0,`${day.date}: no legal plan for current headcounts`);
  assert.equal(actualAB,maximum,`${day.date}: Saturday AB structure was split`);
  reports.push({date:day.date,counts:{A:actual.A.length,B:actual.B.length},maxAB:maximum,actualAB,roster:actual});
 }
 return reports;
}
module.exports={auditPairing};
