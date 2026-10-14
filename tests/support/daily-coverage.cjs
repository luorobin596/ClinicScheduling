// Minimum coverage is separate from desired headcount (weekday 3 per shift).
function coverageFindings(days,{station}){
 if(!['ORTHO','ALL'].includes(station))throw new Error('An explicit coverage station is required');
 const findings=[];
 for(const day of days){
  if(!day.isOpen)continue;
  const staff=new Set(),covered=new Set();
  for(const [shift,slots]of Object.entries(day.slots)){
   const ids=station==='ORTHO'?slots.ORTHO.staff:[...slots.ORTHO.staff,...slots.PEDS.staff];
   if(ids.length)covered.add(shift);
   ids.forEach(id=>staff.add(id));
  }
  const minimumStaff=day.dayOfWeek===6?1:2;
  const missingShifts=day.dayOfWeek===6?[]:['A','B','C'].filter(s=>!covered.has(s));
  if(staff.size<minimumStaff || missingShifts.length)findings.push({date:day.date,station,minimumStaff,staffCount:staff.size,staffIds:[...staff],missingShifts});
 }
 return findings;
}
function potentialCoverageDays(context,staff,engine){
 // Necessary availability screen, not a solver: actual output is audited separately.
 return context.days.map(day=>{
  if(!day.isOpen)return day;
  const fixedCount=id=>Object.values(day.slots).filter(slot=>slot.ORTHO.staff.includes(id)||slot.PEDS.staff.includes(id)).length;
  const slots=Object.fromEntries(Object.entries(day.slots).map(([shift,slot])=>{
   const candidates=staff.filter(s=>fixedCount(s.id)<2 && engine._isStaffAvailableForShift(day,s.id,shift)).map(s=>s.id);
   return [shift,{ORTHO:{staff:[...slot.ORTHO.staff,...candidates]},PEDS:slot.PEDS}];
  }));
  return {...day,slots};
 });
}
module.exports={coverageFindings,potentialCoverageDays};
