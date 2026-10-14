const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function engine(requests = []) {
  const box = vm.createContext({console:{log(){},warn(){}},Session:{getScriptTimeZone:()=> 'Asia/Taipei'},Utilities:{formatDate:(d,z,p)=>{const v=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));return p.replace('yyyy',v.year).replace('MM',v.month).replace('dd',v.day);}},RepoStaff:{getAvailableStaff:()=>[1,2,3,4,5].map(i=>({id:`FT00${i}`,name:`員工${i}`}))},RepoRequests:{getAllRequestsByRun:()=>requests}});
  for(const file of ['Config_system.js','scheduling_engine.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','..',file),'utf8'),box);
  vm.runInContext("RulesConfig.loadDynamicConfig=()=>({closedDates:[],minDaysOff:9,monthlyHours:176,pedsAssignments:{PEDS_PATTERN_1:'FT003',PEDS_PATTERN_2:'FT002'}}); SchedulingEngine.saveToScheduleOutput=()=>{};",box);
  return {e:box.SchedulingEngine, rules:box.RulesConfig.getPedsRules()};
}
module.exports={engine};
