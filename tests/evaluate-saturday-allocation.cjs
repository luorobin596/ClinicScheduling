/** Offline evaluation: freeze feasible inputs BEFORE running repair; retain every failure. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {engine}=require('./support/engine-harness.cjs');
const {summarizeWeeks}=require('./support/weekly-report.cjs');
const {generateScenarioFixture}=require('./support/scenario-fixtures.cjs');
const {coverageFindings}=require('./support/daily-coverage.cjs');
const args=process.argv.slice(2);
const arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const kind=arg('--scenario','baseline');
const limit=Number(arg('--limit','100'));
const outputDir=path.join(__dirname,'results','saturday-allocation');
fs.mkdirSync(outputDir,{recursive:true});
const hash=data=>crypto.createHash('sha256').update(typeof data==='string'?data:JSON.stringify(data)).digest('hex');
const stats=values=>values.length?{mean:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),max:Math.max(...values)}:null;
const diff=values=>values.length?Math.max(...values)-Math.min(...values):0;
function measurements(measure){
 return {involuntarySingle:diff(measure.staff.map(p=>p.involuntarySingle)),
  attainmentPercentagePoints:diff(measure.staff.filter(p=>p.attainment!==null).map(p=>p.attainment*100)),
  rawHours:diff(measure.staff.map(p=>p.hours)),weeklyACWorst:measure.score[4],weeklyACSum:measure.score[5],weeklyBCABWorst:measure.score[7],weeklyBCABSum:measure.score[8]};
}
function initialFor(fixture){
 const loaded=engine(fixture.requests,{staff:fixture.staff});
 const original=loaded.e._assignSaturdayShifts;
 let beforeSaturday;
 loaded.e._assignSaturdayShifts=function(context,...args){beforeSaturday=JSON.stringify(context.days.filter(d=>d.dayOfWeek!==6));return original.call(this,context,...args);};
 const context=loaded.e.generateInitialSchedule('2026-11');
 const legacy=engine(fixture.requests,{staff:fixture.staff,saturdayVersion:'checkpoint'});
 const oldSat=legacy.e._assignSaturdayShifts;
 let legacyBefore,legacySaturdayMs;
 legacy.e._assignSaturdayShifts=function(context,...args){legacyBefore=JSON.stringify(context.days.filter(d=>d.dayOfWeek!==6));const start=Date.now();const value=oldSat.call(this,context,...args);legacySaturdayMs=Date.now()-start;return value;};
 const oldInitial=legacy.e.generateInitialSchedule('2026-11');
 const legacyInitial=legacy.fairness.measure(oldInitial,fixture.staff);
 assert.equal(beforeSaturday,legacyBefore,'Weekday initial allocations changed');
 assert.deepEqual(Array.from(legacyInitial.score),oldEvaluation.runs.find(r=>r.seed===fixture.seed).initial.measure.score,'Shared fairness definition changed');
 return {loaded,context,legacySaturdayMs,legacyInitial};
}
const oldEvaluation=require(`./results/${kind}-evaluation.json`);
const oldInputs=JSON.parse(fs.readFileSync(path.join(__dirname,'results',`${kind}-inputs.json`),'utf8'));
assert.equal(hash(oldInputs.fixtures),oldInputs.inputHash,'Frozen input hash mismatch');
const fixtures=oldInputs.fixtures.slice(0,limit),rejected=oldInputs.rejected;

function audit(initial,final,fixture){
 assert.equal(coverageFindings(final.days,{station:'ORTHO'}).length,0);
 for(const event of fixture.events){
  const day=final.days.find(d=>d.date===event.date);
  const assigned=Object.keys(day.slots).filter(s=>Object.values(day.slots[s]).some(slot=>slot.staff.includes(event.staff_id))).sort();
  assert.deepEqual(assigned.slice(),(event.work||[]).slice().sort(),`chosen ${event.staff_id} ${event.date}`);
 }
 for(const before of initial.days)for(const [shift,slots]of Object.entries(before.slots)){
  const after=final.days.find(d=>d.date===before.date).slots[shift];
  assert.deepEqual(Array.from(after.PEDS.staff),Array.from(slots.PEDS.staff),'Pediatric assignment moved');
 }
 for(const day of final.days){
  const totals={};
  for(const [shift,slots]of Object.entries(day.slots)){
   const all=[...slots.ORTHO.staff,...slots.PEDS.staff];
   assert.equal(new Set(all).size,all.length);
   assert.ok(slots.ORTHO.staff.length<=(day.dayOfWeek===6&&shift==='B'?2:3));
   for(const id of all){totals[id]=(totals[id]||0)+1;assert.ok(totals[id]<=2);}
  }
 }
}

// Persist the entire chosen cohort before evaluating, so optimization failures cannot be replaced.
const suffix=limit===100?'':`-${limit}`;
const cohortFile=path.join(outputDir,`${kind}${suffix}-inputs.json`);
fs.writeFileSync(cohortFile,JSON.stringify({kind,inputHash:hash(fixtures),rejected,fixtures},null,2)+'\n');
const runs=[];
for(const [index,fixture]of fixtures.entries()){
 const start=Date.now();
 const run={seed:fixture.seed,events:fixture.events,leaveSummary:fixture.leaveSummary,scenario:fixture.scenario};
 try{
  const {loaded,context,legacySaturdayMs,legacyInitial}=initialFor(fixture);const {adjustments,fairness}=loaded;
  run.legacySaturdayMs=legacySaturdayMs;run.legacyInitial=legacyInitial;
  run.saturday=context.saturdayAllocationReport;
  assert.ok(run.saturday.days.every(day=>day.complete),'Five-person Saturday enumeration must complete');
  assert.ok(run.saturday.days.every(day=>day.actual.A===day.targets.A&&day.actual.B===day.targets.B));

  run.initial={measure:fairness.measure(context,fixture.staff),weekly:summarizeWeeks(context,fixture.staff),coverage:adjustments.coverage(context)};
  const opts={maxCandidates:20000,maxAccepted:200,timeLimitMs:10000,deadline:Date.now()+10000};
  const repaired=adjustments.repair(context,fixture.staff,opts);
  run.repaired={measure:fairness.measure(repaired.context,fixture.staff),weekly:summarizeWeeks(repaired.context,fixture.staff),report:repaired.report};
  const final=adjustments.improve(repaired.context,fixture.staff,opts);
  adjustments.validate(final.context,fixture.staff,{requireMinimumCoverage:true});
  audit(context,final.context,fixture);
  assert.ok(fairness.compareScores(final.report.after.score,run.repaired.measure.score)<=0);
  // Fairness must preserve repaired per-slot headcounts, independently of the optimizer.
  for(let d=0;d<final.context.days.length;d++)for(const shift of Object.keys(final.context.days[d].slots))for(const station of ['ORTHO','PEDS'])assert.equal(final.context.days[d].slots[shift][station].staff.length,repaired.context.days[d].slots[shift][station].staff.length);
  run.final={measure:final.report.after,weekly:summarizeWeeks(final.context,fixture.staff),report:final.report,coverage:adjustments.coverage(final.context),rosterHash:hash(final.context.days.map(d=>({date:d.date,slots:d.slots})))};
  run.status='VALID';
 }catch(error){run.status='FAILED';run.error={code:error.code||'TEST_ASSERTION',message:error.message,details:error.details};}
 run.elapsedMs=Date.now()-start;runs.push(run);
 if((index+1)%10===0)process.stdout.write(`${kind}: ${index+1}/${limit}, failures ${runs.filter(x=>x.status==='FAILED').length}\n`);
}
const valid=runs.filter(r=>r.status==='VALID');
const metrics=['involuntarySingle','attainmentPercentagePoints','rawHours','weeklyACWorst','weeklyACSum','weeklyBCABWorst','weeklyBCABSum'];
const stages={};
for(const stage of ['initial','repaired','final'])stages[stage]=Object.fromEntries(metrics.map(metric=>[metric,stats(runs.filter(r=>r[stage]).map(r=>measurements(r[stage].measure)[metric]))]));
const report={kind,month:'2026-11',baselineCommit:'ced9647',engineHash:hash(['Config_system.js','scheduling_engine.js','scheduling_assignments.js','scheduling_fairness.js','scheduling_adjustments.js','scheduling_saturday.js'].map(f=>fs.readFileSync(path.join(__dirname,'..','gas',f),'utf8')).join('\n')),inputHash:hash(fixtures),sampleCount:limit,inputRejected:rejected.length,successful:valid.length,failed:runs.length-valid.length,initialCoverageFailed:runs.filter(r=>r.initial&&r.initial.coverage.length).length,elapsedMs:stats(runs.map(r=>r.elapsedMs)),saturdayElapsedMs:stats(runs.filter(r=>r.saturday).map(r=>r.saturday.elapsedMs)),legacySaturdayElapsedMs:stats(runs.filter(r=>r.legacySaturdayMs!==undefined).map(r=>r.legacySaturdayMs)),fairnessSearchLimits:valid.filter(r=>/LIMIT/.test(r.final.report.stopReason)).length,stages,runs};
fs.writeFileSync(path.join(outputDir,`${kind}${suffix}-evaluation.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,runs:undefined},null,2));
