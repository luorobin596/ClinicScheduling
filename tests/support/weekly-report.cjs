/** Reporting only: weekday C and non-C working-day targets never affect fairness policy. */
const key=(date,shift,id)=>JSON.stringify([date,shift,id]);
function averageRates(values){const valid=values.filter(v=>v!==null&&Number.isFinite(v));return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}
function assigned(day,id){return Object.keys(day.slots).filter(s=>Object.values(day.slots[s]).some(slot=>slot.staff.includes(id))).sort();}
function originalPatterns(context,day,id){
 const shifts=Object.keys(day.slots);
 const required=shifts.filter(s=>context.constraints.fixed[key(day.date,s,id)]||context.constraints.peds[key(day.date,s,id)]||day.slots[s].PEDS.staff.includes(id));
 const patterns=[];
 for(let mask=1;mask<(1<<shifts.length);mask++){
  const subset=shifts.filter((_,i)=>mask&(1<<i));
  if(subset.length<=2&&required.every(s=>subset.includes(s))&&!subset.some(s=>context.constraints.off[key(day.date,s,id)]))patterns.push(subset);
 }
 return patterns;
}
function summarizeWeeks(context,staff){
 const grouped=new Map();
 for(const day of context.days){
  const date=new Date(day.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-date.getUTCDay());
  const week=date.toISOString().slice(0,10);if(!grouped.has(week))grouped.set(week,[]);grouped.get(week).push(day);
 }
 const weeks=[...grouped.values()];
 return staff.map(person=>({id:person.id,weeks:weeks.map((days,index)=>{
  const weekdays=days.filter(d=>d.isOpen&&d.dayOfWeek>=1&&d.dayOfWeek<=5);
  const result={week:index+1,openWeekdays:weekdays.length,shortWeek:weekdays.length<5,AC:0,
   cActual:0,cTarget:0,cRate:null,earlyActual:0,earlyTarget:0,earlyRate:null,workingDays:0,cAvailableDays:0,earlyAvailableDays:0};
  for(const day of days.filter(d=>d.isOpen))if(assigned(day,person.id).join('')==='AC')result.AC++;
  for(const day of weekdays){
   const actual=assigned(day,person.id);
   if(actual.includes('C'))result.cActual++;
   if(['A','B','AB'].includes(actual.join('')))result.earlyActual++;
   const patterns=originalPatterns(context,day,person.id);
   if(patterns.length)result.workingDays++;
   if(patterns.some(p=>p.includes('C')))result.cAvailableDays++;
   if(patterns.some(p=>!p.includes('C')))result.earlyAvailableDays++;
  }
  result.cTarget=Math.min(3,result.cAvailableDays);
  result.earlyTarget=Math.min(result.earlyAvailableDays,Math.max(0,result.workingDays-result.cTarget));
  result.capacityKnown=Array.isArray(context.submittedStaffIds)&&context.submittedStaffIds.includes(person.id);
  if(result.capacityKnown&&result.cTarget>0)result.cRate=result.cActual/result.cTarget;
  if(result.capacityKnown&&result.earlyTarget>0)result.earlyRate=result.earlyActual/result.earlyTarget;
  return result;
 })}));
}
function formatWeeklyCell(before,after,kind){
 const mean=values=>values.reduce((n,v)=>n+v,0)/values.length;
 if(before[0].shortWeek)return `${mean(before.map(w=>w[kind+'Actual'])).toFixed(2)} → ${mean(after.map(w=>w[kind+'Actual'])).toFixed(2)} 次`;
 const format=rows=>{
  const values=rows.map(w=>w[kind+'Rate']),valid=values.filter(v=>v!==null&&Number.isFinite(v)),average=averageRates(values);
  return average===null?'N/A':`${(average*100).toFixed(1)}%${valid.length===values.length?'':`（n=${valid.length}/${values.length}）`}`;
 };
 return `${format(before)} → ${format(after)}`;
}
module.exports={summarizeWeeks,averageRates,formatWeeklyCell};
