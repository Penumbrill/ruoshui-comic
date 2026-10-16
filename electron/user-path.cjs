const path=require('node:path');
const fs=require('node:fs');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
function runtimePath(root,environment=process.env,exists=fs.existsSync){
 const candidates=[root,path.join(root,'runtime/python'),path.join(root,'runtime/python/Scripts'),path.join(root,'runtime/llama-official')].filter(exists);
 const names=new Set(),entries=[...candidates,...String(environment.PATH||environment.Path||'').split(';')].filter(entry=>{const key=entry.trim().replace(/[\\/]+$/,'').toLowerCase();if(!key||names.has(key))return false;names.add(key);return true;});
 environment.PATH=entries.join(';');return candidates;
}
async function manageUserPath({root,script,action='status',runner=execute,environment=process.env}){
 if(!['status','repair','remove'].includes(action))throw Error('未知 PATH 操作');
 if(action!=='status')await runner('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode',action==='remove'?'Remove':'Add','-Target',root],{windowsHide:true,timeout:20000});
 const result=await runner('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode','Status','-Target',root],{windowsHide:true,timeout:10000});
 return{...JSON.parse(result.stdout.replace(/^\ufeff/,'')),root,available:true,runtimeEntries:runtimePath(root,environment)};
}
module.exports={runtimePath,manageUserPath};
