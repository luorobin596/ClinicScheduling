// Offline baseline: real engine/config, synthetic staff and requests, no Google writes.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const results = [];
for (let seed = 1; seed <= 30; seed++) for (const withPeds of [false, true]) {
  const staff = Array.from({length:5}, (_, i) => ({id:`FT00${i+1}`,name:`測試員工${i+1}`}));
  let state = seed;
  const random = () => { state = (Math.imul(state,1664525)+1013904223) >>> 0; return state / 4294967296; };
  const requests = [], requestedHalfDays = [];
  // Default assumption: five Sundays count toward nine days; choose eight additional half-days.
  // Each A/B/C shift counts as half a day, per user definition.
  for (const person of staff) {
    const halves = [];
    for (let d=1; d<=30; d++) {
      const weekday = new Date(2026,10,d).getDay();
      if (!weekday) continue;
      const date = `2026-11-${String(d).padStart(2,'0')}`;
      for (const shift of (weekday===6?['A','B']:['A','B','C'])) halves.push({date,shifts:[shift]});
    }
    for (let i=halves.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [halves[i],halves[j]]=[halves[j],halves[i]]; }
    const selected=[], perDate={};
    for (const half of halves) { if ((perDate[half.date]||0)>=2) continue; if (person.id==='FT003' && requests.some(r=>r.staff_id==='FT002' && r.date===half.date && r.shift===half.shifts[0])) continue; selected.push(half); perDate[half.date]=(perDate[half.date]||0)+1; if(selected.length===8) break; }
    requestedHalfDays.push({id:person.id,sundays:5,additionalHalfDays:8,requestedDayEquivalent:9,selected});
    for (const half of selected) for (const shift of half.shifts) requests.push({staff_id:person.id,date:half.date,shift,type:'off'});
  }
  const sandbox = vm.createContext({
    console:{log(){},warn(){},error(){}},
    Session:{getScriptTimeZone:()=> 'Asia/Taipei'},
    Utilities:{formatDate:(date, zone, pattern)=> {
      const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
      const get = key=>parts.find(p=>p.type===key).value;
      return pattern.replace('yyyy',get('year')).replace('MM',get('month')).replace('dd',get('day'));
    }},
    RepoStaff:{getAvailableStaff:()=>staff.map(s=>({...s}))},
    RepoRequests:{getAllRequestsByRun:()=>requests}
  });
  for (const file of ['Config_system.js','scheduling_engine.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox,{filename:file});
  vm.runInContext(`RulesConfig.loadDynamicConfig = () => ({targetMonth:'2026-11',closedDates:[],monthlyHours:176,minDaysOff:9,pedsAssignments:${withPeds?"{PEDS_PATTERN_1:'FT003',PEDS_PATTERN_2:'FT002'}":"{}"}});
    SchedulingEngine.saveToScheduleOutput = () => {};`,sandbox);
  const context = vm.runInContext("SchedulingEngine.generateSchedule('2026-11')",sandbox);
  const summary = staff.map(s=>({id:s.id,shifts:0,hours:0,workDays:0,offDays:0,A:0,B:0,C:0,pedsShifts:0,singleDays:0}));
  const gaps=[], overstaffed=[], violations=[], leaveViolations=[], rows=[];
  for(const day of context.days){
    for(const s of summary){
      const assigned=[];
      for(const [shift,stations] of Object.entries(day.slots)){
        for(const [station,slot] of Object.entries(stations)) if(slot.staff.includes(s.id)){
          assigned.push(shift); if(requests.some(r=>r.staff_id===s.id && r.date===day.date && r.shift===shift)) leaveViolations.push({id:s.id,date:day.date,shift,station}); s.shifts++;s[shift]++;s.hours+=4;if(station==='PEDS')s.pedsShifts++;
        }
      }
      if(assigned.length){s.workDays++;if(assigned.length===1)s.singleDays++;}else s.offDays++;
      if(assigned.length>2 || new Set(assigned).size!==assigned.length)violations.push({date:day.date,id:s.id,assigned});
      rows.push([withPeds?'example-peds':'ortho-only',day.date,s.id,assigned.sort().join('')||'OFF']);
    }
    for(const [shift,stations] of Object.entries(day.slots)){
      const req = vm.runInContext(`RulesConfig.SHIFTS.${day.dayOfWeek===6?'SATURDAY':'WEEKDAY'}.${shift}.req_total`,sandbox);
      const ortho=stations.ORTHO.staff.length,peds=stations.PEDS.staff.length;
      if(ortho<req)gaps.push({date:day.date,shift,ortho,required: req,peds});
      if(ortho>req)overstaffed.push({date:day.date,shift,ortho,peds,combinedLimit:req});
      for(const [station,slot] of Object.entries(stations))if(slot.staff.length>4)violations.push({date:day.date,shift,station,outputTruncation:slot.staff.length});
    }
  }
  results.push({seed,requestedHalfDays,leaveViolations,scenario:withPeds?'示例小兒科：FT003 pattern1、FT002 pattern2':'五人純骨科',settings:{month:'2026-11',minDaysOff:9,monthlyHours:176,noRequests:false,noExtraHolidays:true},openDays:context.days.filter(d=>d.isOpen).length,summary,gaps,overstaffed,violations,rows});
}
fs.writeFileSync(path.join(__dirname,'five-ft-corrected-random-leave-2026-11.json'),JSON.stringify(results,null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'five-ft-corrected-random-leave-2026-11.csv'),'scenario,date,staff_id,shifts\n'+results.flatMap(r=>r.rows.map(row=>row.join(','))).join('\n')+'\n');

for(const scenario of [...new Set(results.map(r=>r.scenario))]) {
 const runs=results.filter(r=>r.scenario===scenario);
 const range=key=>[Math.min(...runs.map(key)),Math.max(...runs.map(key))];
 console.log(JSON.stringify({scenario,runs:runs.length,gapPersonShifts:range(r=>r.gaps.reduce((s,g)=>s+g.required-g.ortho,0)),overstaffedRuns:runs.filter(r=>r.overstaffed.length).length,leaveViolationRuns:runs.filter(r=>r.leaveViolations.length).length,dailyViolationRuns:runs.filter(r=>r.violations.length).length,hours:range(r=>Math.min(...r.summary.map(s=>s.hours))).concat(range(r=>Math.max(...r.summary.map(s=>s.hours)))),first: runs[0].summary,firstLeaveViolations:runs[0].leaveViolations},null,2));
}
