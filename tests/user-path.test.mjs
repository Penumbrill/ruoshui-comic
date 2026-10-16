import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import{spawn}from'node:child_process';
async function plan(mode,target,existing,tracked=''){
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const code=`[Console]::OutputEncoding=[Text.Encoding]::UTF8; & ${quote(path.resolve('assets/manage-user-path.ps1'))} -PlanOnly -Mode ${mode} -Target ${quote(target)} -ExistingPath ${quote(existing)} -TrackedPath ${quote(tracked)}`;
 return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',code],{windowsHide:true});let out='',error='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>error+=b);p.on('error',reject);p.on('close',c=>c===0?resolve(JSON.parse(out.replace(/^\ufeff/,''))):reject(Error(error)));});
}
test('installer PATH preserves existing entries, avoids duplicates and removes only its own entry',async()=>{
 const target='E:\\漫画 软件\\若水',existing='%USERPROFILE%\\bin;C:\\Windows\\System32';
 const added=await plan('Add',target,existing);assert.equal(added.path,existing+';'+target);assert.equal(added.trackedPath,target);assert.equal(added.changed,true);
 const again=await plan('Add',target+'\\',added.path,target);assert.equal(again.path,added.path);assert.equal(again.changed,false);
 const removed=await plan('Remove',target,added.path,target);assert.equal(removed.path,existing);assert.equal(removed.changed,true);assert.equal(removed.trackedPath,'');
 const preexisting=await plan('Add',target,added.path);assert.equal(preexisting.trackedPath,'');const preserved=await plan('Remove',target,preexisting.path);assert.equal(preserved.path,added.path);assert.equal(preserved.changed,false);
 const moved=await plan('Add','D:\\若水',added.path,target);assert.equal(moved.path,existing+';D:\\若水');assert.equal(moved.trackedPath,'D:\\若水');
});
