const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {engine} = require('./support/engine-harness.cjs');
const {summarizeWeeks} = require('./support/weekly-report.cjs');
const {toRequests} = require('./support/leave-model.cjs');

function fixture() {
  const sent = [];
  const staff = [{id:'FT001', name:'王<小明&'}, {id:'FT002', name:'李小姐'}];
  const h = engine([], {staff, globals:{
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>{assert.equal(key, 'ADMIN_EMAIL'); return 'admin@example.com';}})},
    Notify:{sendEmail:(...args) => sent.push(args)}
  }});
  vm.runInContext(fs.readFileSync('GAS/scheduling_report.js', 'utf8'), h.box);
  const c = h.e.createContext('2026-11');
  c.staffList = staff; c.submittedStaffIds = ['FT001'];
  c.days = c.days.filter(d => ['2026-11-02','2026-11-03','2026-11-07','2026-11-30'].includes(d.date));
  h.e._fillFixedShifts(c, {}, toRequests([{staff_id:'FT001',date:'2026-11-02',kind:'half',work:['A']}]));
  const add = (date,shift,id='FT001') => h.assignments.add(c.days.find(d=>d.date===date),shift,'ORTHO',id,'AUTO_TEST');
  add('2026-11-03','A'); add('2026-11-03','C'); add('2026-11-07','A'); add('2026-11-07','B');
  add('2026-11-30','C'); add('2026-11-30','A','FT002');
  return {h,c,sent};
}

test('report uses final roster and summary definitions, retaining unknown capacities', () => {
  const {h,c} = fixture(); const report = h.box.ScheduleReport.build(c);
  assert.equal(report.monthly[0].hours, 24);
  assert.equal(report.monthly[0].capacityHours, 28);
  assert.equal(report.monthly[0].attainment, 24/28);
  assert.equal(report.monthly[0].voluntarySingle, 1);
  assert.equal(report.monthly[0].involuntarySingle, 1);
  assert.equal(report.monthly[1].capacityHours, null);
  assert.equal(report.monthly[1].attainment, null);
  assert.deepEqual(JSON.parse(JSON.stringify(report.voluntary)), [{id:'FT001',date:'2026-11-02',shift:'A'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(report.saturday)), [
    {id:'FT001', AB:1, A:0, B:0, unassigned:0}, {id:'FT002', AB:0, A:0, B:0, unassigned:1}
  ]);
  const expected = summarizeWeeks(c,c.staffList);
  for (const p of report.weekly) for (const w of p.weeks) {
    const reference = expected.find(x=>x.id===p.id).weeks.find(x=>x.week===w.week);
    for (const key of Object.keys(reference)) assert.equal(w[key], reference[key], key);
  }
  const html = h.box.ScheduleReport.render(report);
  assert.ok(html.includes('王&lt;小明&amp;')); assert.ok(!html.includes('王<小明&'));
  for (const text of ['預排工時','85.7%','N/A','2026-11-30','短週','自願單節班明細','每人週六最終分配次數']) assert.ok(html.includes(text),text);
});
test('send addresses configured admin and recalculates each invocation', () => {
  const {h,c,sent} = fixture();
  h.box.ScheduleReport.send(c);
  h.assignments.add(c.days.find(d=>d.date==='2026-11-30'),'A','ORTHO','FT001','AUTO_TEST');
  h.box.ScheduleReport.send(c);
  assert.equal(sent.length,2); assert.equal(sent[0][0],'admin@example.com');
  assert.match(sent[0][1], /2026-11/); assert.notEqual(sent[0][2],sent[1][2]);
});
test('zero-capacity leave month has N/A attainment and an explicit empty voluntary section', () => {
  const {h,c} = fixture();
  const empty = h.e.createContext('2026-11');
  empty.staffList = c.staffList; empty.submittedStaffIds = c.staffList.map(p=>p.id);
  empty.days = empty.days.filter(d=>d.date==='2026-11-02');
  h.e._fillFixedShifts(empty, {}, toRequests(c.staffList.map(p=>({staff_id:p.id,date:'2026-11-02',kind:'full'}))));
  const report = h.box.ScheduleReport.build(empty);
  for (const p of report.monthly) {assert.equal(p.hours,0); assert.equal(p.capacityHours,0); assert.equal(p.attainment,null);}
  assert.match(h.box.ScheduleReport.render(report), /本次無自願單節班/);
});
test('missing ADMIN_EMAIL fails explicitly instead of claiming the report was mailed', () => {
  const {h,c,sent} = fixture();
  h.box.PropertiesService.getScriptProperties = () => ({getProperty:()=>''});
  assert.throws(()=>h.box.ScheduleReport.send(c), /ADMIN_EMAIL/);
  assert.equal(sent.length,0);
});
