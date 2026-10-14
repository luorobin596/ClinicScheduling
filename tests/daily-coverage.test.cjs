const {test}=require('node:test');
const assert=require('node:assert/strict');
const {coverageFindings}=require('./support/daily-coverage.cjs');
function day(patterns,weekday=1,peds={}){
 const slots=Object.fromEntries((weekday===6?['A','B']:['A','B','C']).map(s=>[s,{ORTHO:{staff:Object.entries(patterns).filter(([,p])=>p.includes(s)).map(([id])=>id)},PEDS:{staff:peds[s]||[]}}]));
 return {date:'2026-11-02',dayOfWeek:weekday,isOpen:true,slots};
}
for(const pair of [['AB','AC'],['AB','BC'],['AC','BC']])test(`two different pairs ${pair.join('+')} cover a weekday`,()=>{
 assert.deepEqual(coverageFindings([day({FT001:pair[0],FT002:pair[1]})],{station:'ORTHO'}),[]);
});
test('two AB staff miss C; a third staff covering C resolves it',()=>{
 const issue=coverageFindings([day({FT001:'AB',FT002:'AB'})],{station:'ORTHO'});
 assert.equal(issue.length,1);assert.deepEqual(issue[0].missingShifts,['C']);
 assert.deepEqual(coverageFindings([day({FT001:'AB',FT002:'AB',FT003:'C'})],{station:'ORTHO'}),[]);
});
test('weekday requires two distinct employees, not a sum of shift slots',()=>{
 const issue=coverageFindings([day({FT001:'AB'})],{station:'ORTHO'});
 assert.equal(issue[0].staffCount,1);assert.equal(issue[0].minimumStaff,2);
});
test('Saturday needs one employee; no extra shift-coverage rule is invented',()=>{
 assert.deepEqual(coverageFindings([day({FT001:'A'},6)],{station:'ORTHO'}),[]);
 assert.equal(coverageFindings([day({},6)],{station:'ORTHO'})[0].staffCount,0);
});
test('closed days are exempt',()=>{
 assert.deepEqual(coverageFindings([{...day({}),isOpen:false}],{station:'ORTHO'}),[]);
});
test('station scope explicitly decides whether pediatric C covers missing orthopedic C',()=>{
 const d=day({FT001:'AB',FT002:'AB'},1,{C:['FT003']});
 assert.equal(coverageFindings([d],{station:'ORTHO'}).length,1);
 assert.deepEqual(coverageFindings([d],{station:'ALL'}),[]);
});

test('audit exposes the engine short-week B gap rather than hiding it as ordinary understaffing',()=>{
 const {engine}=require('./support/engine-harness.cjs');
 const context=engine([]).e.generateSchedule('2026-11');
 const findings=coverageFindings(context.days,{station:'ORTHO'});
 assert.ok(findings.some(f=>f.date==='2026-11-30'&&f.missingShifts.includes('B')));
});
