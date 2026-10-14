// Offline baseline: real engine/config, synthetic staff and requests, no Google writes.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const results = [];
for (const withPeds of [false, true]) {
  const staff = Array.from({length:5}, (_, i) => ({id:`FT00${i+1}`,name:`測試員工${i+1}`}));
  const sandbox = vm.createContext({
    console:{log(){},warn(){},error(){}},
    Session:{getScriptTimeZone:()=> 'Asia/Taipei'},
    Utilities:{formatDate:(date, zone, pattern)=> {
      const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
      const get = key=>parts.find(p=>p.type===key).value;
      return pattern.replace('yyyy',get('year')).replace('MM',get('month')).replace('dd',get('day'));
    }},
    RepoStaff:{getAvailableStaff:()=>staff.map(s=>({...s}))},
    RepoRequests:{getAllRequestsByRun:()=>[]}
  });
  for (const file of ['Config_system.js','scheduling_engine.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox,{filename:file});
  vm.runInContext(`RulesConfig.loadDynamicConfig = () => ({targetMonth:'2026-11',closedDates:[],monthlyHours:176,minDaysOff:9,pedsAssignments:${withPeds?"{PEDS_PATTERN_1:'FT003',PEDS_PATTERN_2:'FT004'}":"{}"}});
    SchedulingEngine.saveToScheduleOutput = () => {};`,sandbox);
  const context = vm.runInContext("SchedulingEngine.generateSchedule('2026-11')",sandbox);
  const summary = staff.map(s=>({id:s.id,shifts:0,hours:0,workDays:0,offDays:0,A:0,B:0,C:0,pedsShifts:0,singleDays:0}));
  const gaps=[], overstaffed=[], violations=[], rows=[];
  for(const day of context.days){
    for(const s of summary){
      const assigned=[];
      for(const [shift,stations] of Object.entries(day.slots)){
        for(const [station,slot] of Object.entries(stations)) if(slot.staff.includes(s.id)){
          assigned.push(shift);s.shifts++;s[shift]++;s.hours+=4;if(station==='PEDS')s.pedsShifts++;
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
      if(ortho+peds>req)overstaffed.push({date:day.date,shift,ortho,peds,combinedLimit:req});
      for(const [station,slot] of Object.entries(stations))if(slot.staff.length>4)violations.push({date:day.date,shift,station,outputTruncation:slot.staff.length});
    }
  }
  results.push({scenario:withPeds?'示例小兒科：FT003 pattern1、FT004 pattern2':'五人純骨科',settings:{month:'2026-11',minDaysOff:9,monthlyHours:176,noRequests:true,noExtraHolidays:true},openDays:context.days.filter(d=>d.isOpen).length,summary,gaps,overstaffed,violations,rows});
}
fs.writeFileSync(path.join(__dirname,'five-ft-2026-11.json'),JSON.stringify(results,null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'five-ft-2026-11.csv'),'scenario,date,staff_id,shifts\n'+results.flatMap(r=>r.rows.map(row=>row.join(','))).join('\n')+'\n');
for(const r of results)console.log(JSON.stringify({...r,rows:undefined,gaps:r.gaps.length,overstaffed:r.overstaffed.length},null,2));
