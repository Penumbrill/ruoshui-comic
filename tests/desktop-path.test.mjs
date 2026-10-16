import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {createRequire}from'node:module';
const{runtimePath,manageUserPath}=createRequire(import.meta.url)('../electron/user-path.cjs');
test('desktop runtime automatically prepends its own tools and keeps inherited PATH entries',()=>{
 const root=path.resolve('works/tests/example-app'),environment={PATH:root+'\\;C:\\Windows\\System32;C:\\Tools'};
 const own=runtimePath(root,environment,()=>true);assert.equal(own.length,4);assert(environment.PATH.startsWith(own.join(';')+';'));assert(environment.PATH.endsWith('C:\\Windows\\System32;C:\\Tools'));assert.equal(runtimePath(root,environment,()=>true).length,4);assert.equal(environment.PATH.split(';').filter(e=>e.toLowerCase()===root.toLowerCase()).length,1);
});
test('desktop PATH repair uses fixed script arguments and reads actual registration status',async()=>{
 const calls=[],root='E:\\漫画 工作室',script='C:\\app\\manage-user-path.ps1',runner=async(file,args,options)=>{calls.push({file,args,options});return{stdout:args.includes('Status')?'\ufeff{"registered":true}':'done'};};
 const result=await manageUserPath({root,script,action:'repair',runner,environment:{PATH:'C:\\Windows'}});assert.equal(result.registered,true);assert.equal(calls.length,2);assert(calls[0].args.includes('Add'));assert.deepEqual(calls[0].args.slice(-2),['-Target',root]);assert.equal(calls[0].options.windowsHide,true);await assert.rejects(manageUserPath({root,script,action:'invalid',runner}),/PATH/);
});
