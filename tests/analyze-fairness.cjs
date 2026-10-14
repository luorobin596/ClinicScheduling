// Offline baseline: real engine/config, synthetic staff and requests, no Google writes.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const results = [];
for (let seed = 1; seed <= 100; seed++) for (const withPeds of [true]) {
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
  const weeks = sandbox.SchedulingEngine._groupDaysByWeek(context.days);
  for (const person of summary) {
    Object.assign(person,{AC:0,BC:0,AB:0,unrequestedSingle:0,leaveForcedSingle:0,weekly:[]});
    weeks.forEach((days, index)=>{
      const w={week:index+1,dates:[days[0].date,days.at(-1).date],weekdays:days.filter(d=>d.isOpen && d.dayOfWeek!==6).length,AC:0,BC:0,AB:0};
      for(const day of days){
        const assigned=Object.keys(day.slots).filter(shift=>Object.values(day.slots[shift]).some(slot=>slot.staff.includes(person.id))).sort();
        const pattern=assigned.join('');
        if(['AC','BC','AB'].includes(pattern)){person[pattern]++;w[pattern]++;}
        if(assigned.length===1){
          const possible=Object.keys(day.slots);
          const other=possible.filter(s=>s!==assigned[0]);
          const forced=other.every(shift=>requests.some(r=>r.staff_id===person.id && r.date===day.date && r.shift===shift && r.type==='off'));
          person[forced?'leaveForcedSingle':'unrequestedSingle']++;
        }
      }
      person.weekly.push(w);
    });
  }
  results.push({seed,requestedHalfDays,leaveViolations,scenario:withPeds?'示例小兒科：FT003 pattern1、FT002 pattern2':'五人純骨科',settings:{month:'2026-11',minDaysOff:9,monthlyHours:176,noRequests:false,noExtraHolidays:true},openDays:context.days.filter(d=>d.isOpen).length,summary,gaps,overstaffed,violations,rows});
}

const metrics=['hours','singleDays','unrequestedSingle','leaveForcedSingle','AC','BC','AB'];
const stats=values=>({min:Math.min(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values)});
const byStaff=results[0].summary.map((s,i)=>({id:s.id,...Object.fromEntries(metrics.map(m=>[m,stats(results.map(r=>r.summary[i][m]))]))}));
const spread=Object.fromEntries(metrics.map(m=>[m,stats(results.map(r=>Math.max(...r.summary.map(s=>s[m]))-Math.min(...r.summary.map(s=>s[m]))))]));
const fullWeeks=results.flatMap(r=>r.summary[0].weekly.map((w,i)=>({r,i,w})).filter(x=>x.w.weekdays===5));
const weeklySpread=Object.fromEntries(['AC','BC','AB'].map(m=>[m,stats(fullWeeks.map(({r,i})=>Math.max(...r.summary.map(s=>s.weekly[i][m]))-Math.min(...r.summary.map(s=>s.weekly[i][m]))))]));
const report={conditions:'2026-11; five FT; FT003 pattern1, FT002 pattern2; 5 Sundays + 8 requested shift leaves per staff; no fixed-shift requests; 100 seeds identical to regression inputs; no writes to Sheets',byStaff,monthlySpread:spread,fullWeekSpread:weeklySpread,sample:results[0].summary,checks:{overstaffed:results.filter(r=>r.overstaffed.length).length,leaveViolations:results.filter(r=>r.leaveViolations.length).length},runs:results};
fs.writeFileSync(path.join(__dirname,'fairness-2026-11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,runs:undefined},null,2));
