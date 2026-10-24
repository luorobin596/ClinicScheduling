const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function engine(requests = [], options = {}) {
  const staff=options.staff || [1,2,3,4,5].map(i=>({id:`FT00${i}`,name:`員工${i}`}));
  let requestReads=0;
  const box = vm.createContext({console:{log(){},warn(){},error(){}},Session:{getScriptTimeZone:()=> 'Asia/Taipei'},Utilities:{formatDate:(d,z,p)=>{const v=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));return p.replace('yyyy',v.year).replace('MM',v.month).replace('dd',v.day);}},RepoStaff:{getAvailableStaff:()=>staff},RepoRequests:{getAllRequestsByRun:()=>{requestReads++;return Object.assign(requests.slice(), {submittedStaffIds: options.submittedStaffIds === undefined ? staff.map(s=>s.id) : options.submittedStaffIds});}},getDbSpreadsheet:()=>options.spreadsheet,...options.globals});
  for(const file of ['Config_system.js','scheduling_assignments.js','scheduling_fairness.js','scheduling_adjustments.js','scheduling_saturday.js','scheduling_engine.js']){
    const filename=path.join(__dirname,'..','..','gas',file);
    if(fs.existsSync(filename))vm.runInContext(fs.readFileSync(filename,'utf8'),box,{filename:file});
  }
  box.__settings={closedDates:[],minDaysOff:9,monthlyHours:176,pedsAssignments:{PEDS_PATTERN_1:'FT003',PEDS_PATTERN_2:'FT002'},...options.settings};
  vm.runInContext('RulesConfig.loadDynamicConfig=()=>__settings;',box);
  if(!options.save)vm.runInContext('SchedulingEngine.saveToScheduleOutput=()=>{};',box);
  box.getDbSpreadsheet=()=>options.spreadsheet;
  const e=box.SchedulingEngine;
  if(options.saturdayVersion === 'checkpoint') {
    const legacy = require('../fixtures/saturday-before-allocation.cjs');
    vm.runInContext('SchedulingEngine._assignSaturdayShifts = ' + legacy + ';', box);
  }
  if(e.generateInitialSchedule){
    e.generateFinalSchedule=e.generateSchedule.bind(e);
    if(options.initialOnly!==false && options.final!==true)e.generateSchedule=(runId)=>e.generateInitialSchedule(runId);
  }
  return {e,rules:box.RulesConfig.getPedsRules(),assignments:box.ScheduleAssignments,fairness:box.ScheduleFairness,adjustments:box.ScheduleAdjustments,box,requestReads:()=>requestReads};
}
module.exports={engine};
