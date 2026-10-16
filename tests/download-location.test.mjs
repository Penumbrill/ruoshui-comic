import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {StudioService} from '../server/service.mjs';import {rebaseInstallationPaths} from '../server/portable-paths.mjs';
test('model downloads stay under the active installation, including a relocated folder with Chinese and spaces',async t=>{
 const base=path.resolve('works/tests');await fs.mkdir(base,{recursive:true});const folder=await fs.mkdtemp(path.join(base,'download-location-')),old=path.join(folder,'旧 整合包'),next=path.join(folder,'新 漫画目录'),bytes=Buffer.from('local model location fixture');
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.close();assert(folder.startsWith(base+path.sep));await fs.rm(folder,{recursive:true,force:true});});
 let service=await new StudioService(old).init();const config={installationRoot:old,llm:{model:path.join(service.folder('llm'),'model-0.gguf')}};
 for(const [index,root]of [old,next].entries()){
  if(index){await service.writeChain;service.shutdown();assert.equal(path.dirname(await fs.realpath(old)),folder);assert.equal(path.dirname(next),folder);for(let attempt=0;;attempt++)try{await fs.rename(old,next);break;}catch(error){if(error.code!=='EPERM'||attempt>=12)throw error;await new Promise(resolve=>setTimeout(resolve,100));}rebaseInstallationPaths(config,next);service=await new StudioService(next).init();}
  const manifest=path.join(folder,'manifest.json'),targets=[`diffusion_models/model-${index}.safetensors`,`llm/model-${index}.gguf`];
  await fs.writeFile(manifest,JSON.stringify({downloads:{test:targets.map(target=>({target,url:`http://127.0.0.1:${server.address().port}/model`,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))}}));
  await new Promise((resolve,reject)=>{const child=spawn(path.resolve('runtime/python/python.exe'),['-I',path.resolve('assets/download_models.py'),manifest,service.folder('models'),'all','official'],{windowsHide:true,env:{...process.env,RUOSHUI_PROXY_MODE:'direct'}});let error='';child.stdout.on('data',()=>{});child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(error)));});
  for(const target of targets)assert.deepEqual(await fs.readFile(path.join(root,'runtime/ComfyUI/models',target)),bytes);
 }
 assert.equal(config.llm.model,path.join(next,'runtime/ComfyUI/models/llm/model-0.gguf'));assert.equal(await fs.access(old).then(()=>true,()=>false),false);
});
