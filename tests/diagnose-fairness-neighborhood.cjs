/** Counterfactual candidates for diagnosis only; never writes or changes the production policy. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const findings=[];
for(const kind of ['full-only','baseline']){
 const cohort=require(`./results/${kind}-inputs.json`).fixtures;
 const saved=require(`./results/${kind}-evaluation.json`);
 for(const fixture of cohort.slice(0,3)){
  const loaded=engine(fixture.requests,{staff:fixture.staff});
  const {e,adjustments:a,fairness:f}=loaded;
  const initial=e.generateInitialSchedule('2026-11');
  const repaired=a.repair(initial,fixture.staff,{maxCandidates:20000,maxAccepted:200,timeLimitMs:60000});
  const apply=a.apply;
  const passes=[];
  let lastContext;
  a.apply=function(context,ops,...rest){
   if(lastContext!==context){passes.push({evaluated:0,transfers:0,swaps:0,firstRemoveDates:{},validTransfersWithBetterHours:0,blockedBySingles:0});lastContext=context;}
   const pass=passes.at(-1);pass.evaluated++;pass[ops.length===1?'transfers':'swaps']++;
   const date=ops[0].remove.date;pass.firstRemoveDates[date]=(pass.firstRemoveDates[date]||0)+1;
   const candidate=apply.call(this,context,ops,...rest);
   if(ops.length===1){
    const before=f.measure(context,fixture.staff).score,next=f.measure(candidate,fixture.staff).score;
    if(f.compareScores(next.slice(2,4),before.slice(2,4))<0){pass.validTransfersWithBetterHours++;if(f.compareScores(next.slice(0,2),before.slice(0,2))>0)pass.blockedBySingles++;}
   }
   return candidate;
  };
  const optimized=a.improve(repaired.context,fixture.staff,{maxCandidates:20000,maxAccepted:200,timeLimitMs:60000});
  a.apply=apply;
  assert.deepEqual(Array.from(optimized.report.after.score),saved.runs.find(r=>r.seed===fixture.seed).final.measure.score);
  const final=optimized.context,before=f.measure(final,fixture.staff);
  const bundles=[];
  for(const day of final.days.filter(d=>d.dayOfWeek===6&&d.isOpen))for(const donor of fixture.staff)for(const recipient of fixture.staff){
   if(donor.id===recipient.id)continue;
   if(!['A','B'].every(s=>day.slots[s].ORTHO.staff.includes(donor.id)))continue;
   if(Object.values(day.slots).some(stations=>Object.values(stations).some(slot=>slot.staff.includes(recipient.id))))continue;
   const ops=['A','B'].map(shift=>({remove:{date:day.date,shift,station:'ORTHO',id:donor.id},add:{date:day.date,shift,station:'ORTHO',id:recipient.id},source:'FAIRNESS_ADJUST'}));
   try{
    const candidate=a.apply(final,ops,fixture.staff,{requireMinimumCoverage:true}),after=f.measure(candidate,fixture.staff);
    if(f.compareScores(after.score,before.score)<0&&f.compareScores(after.score.slice(2,4),before.score.slice(2,4))<0&&f.compareScores(after.score.slice(0,2),before.score.slice(0,2))===0)bundles.push({date:day.date,from:donor.id,to:recipient.id,before:before.staff.map(p=>({id:p.id,hours:p.hours,singles:p.involuntarySingle})),after:after.staff.map(p=>({id:p.id,hours:p.hours,singles:p.involuntarySingle})),beforeScore:before.score,afterScore:after.score});
   }catch(error){if(error.code!=='INTERNAL_INVALID')throw error;}
  }
  const history=final.adjustmentHistory.slice(repaired.context.adjustmentHistory.length);
  findings.push({kind,seed:fixture.seed,passes,accepted:optimized.report.accepted,stopReason:optimized.report.stopReason,history,bundleWitnesses:bundles});
  console.log(kind,fixture.seed,'accepted',optimized.report.accepted,'passes',passes.map(p=>({n:p.evaluated,t:p.transfers,s:p.swaps,betterH:p.validTransfersWithBetterHours,blocked:p.blockedBySingles})),'valid missing bundle improvements',bundles.length);
 }
}
fs.writeFileSync(path.join(__dirname,'results','fairness-neighborhood-diagnosis.json'),JSON.stringify(findings,null,2)+'\n');
