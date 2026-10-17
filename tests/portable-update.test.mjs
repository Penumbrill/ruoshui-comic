import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {rebaseInstallationPaths,managedFiles,resolveManagedFile} from '../server/portable-paths.mjs';import {ResumableTransfer} from '../server/transfers.mjs';import {assetsFromHtml,githubRelease} from '../server/github-release.mjs';import {allowedProgramPath,validateUpdateFiles,versionNewer,UpdateManager} from '../server/updates.mjs';import {StudioService} from '../server/service.mjs';import {AssistantManager} from '../server/assistant.mjs';
async function fixture(t){const base=path.resolve('works/tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'portable-update-'));t.after(async()=>{assert(root.startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});return root;}
test('moving an installation rebases its own paths while preserving unrelated explicit locations',()=>{
 const old=path.resolve('works/tests/old'),next=path.resolve('works/tests/new'),external=path.resolve('works/tests/external/model.gguf');const config={installationRoot:old,llm:{model:path.join(old,'runtime/ComfyUI/models/llm/test.gguf'),modelDirs:[path.join(old,'runtime/ComfyUI/models/llm'),path.dirname(external)]},text:'hello',external};
 rebaseInstallationPaths(config,next);assert.equal(config.llm.model,path.join(next,'runtime/ComfyUI/models/llm/test.gguf'));assert.equal(config.external,external);assert.equal(config.installationRoot,next);
});
test('independent assistant only lists managed models and file inventory covers non-safetensor resources',async t=>{
 const root=await fixture(t),service=await new StudioService(root).init(),model=path.join(service.folder('llm'),'test.gguf');await fs.writeFile(model,'model');const extra=path.join(service.folder('models'),'segmentation');await fs.mkdir(extra);await fs.writeFile(path.join(extra,'test.onnx'),'cutout');service.config.llm={modelDirs:[path.resolve('works')],model:path.resolve('elsewhere/test.gguf')};const assistant=await new AssistantManager(service).init();assert.deepEqual(service.config.llm.modelDirs,[service.folder('llm')]);assert.equal(service.config.llm.model,model);assert(assistant.executable().includes('llama-official'));
 const inventory=await managedFiles(service);assert(inventory.files.some(f=>f.name==='segmentation/test.onnx'));assert.equal(await resolveManagedFile(service,'models','llm/test.gguf'),await fs.realpath(model));await assert.rejects(resolveManagedFile(service,'models','../../../../package.json'));
});
test('official release page fallback retains asset digests when the API is rate limited',async()=>{
 const digest='a'.repeat(64),html=`<li><a href="/owner/repo/releases/download/v1.2.0/app.zip">file</a><span>sha256:${digest}</span></li>`;assert.equal(assetsFromHtml(html,'owner/repo','v1.2.0')[0].digest,'sha256:'+digest);let calls=0;const release=await githubRelease('owner/repo',{fetcher:async url=>{calls++;if(url.startsWith('https://api.'))return new Response('{}',{status:403});if(url.endsWith('/latest')){const r=new Response('<div data-test-selector="body-content"><p>Changes</p></div>');Object.defineProperty(r,'url',{value:'https://github.com/owner/repo/releases/tag/v1.2.0'});return r;}return new Response(html);}});assert.equal(calls,3);assert.equal(release.tag_name,'v1.2.0');assert.equal(release.body,'Changes');assert.equal(release.assets.length,1);
});
test('resumable download checks byte ranges and SHA256; a corrupt transfer never becomes a ready file',async t=>{
 const root=await fixture(t),file=path.join(root,'update.zip'),bytes=Buffer.from('complete-update-payload');await fs.writeFile(file+'.part',bytes.subarray(0,8));let requested;
 const transfer=new ResumableTransfer({fetcher:async(url,options)=>{requested=options.headers.Range;return new Response(bytes.subarray(8),{status:206,headers:{'content-range':`bytes 8-${bytes.length-1}/${bytes.length}`}});}});await transfer.download({url:'https://example.test/update',file,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});assert.equal(requested,'bytes=8-');assert.deepEqual(await fs.readFile(file),bytes);
 const bad=path.join(root,'bad.zip');const corrupt=new ResumableTransfer({fetcher:async()=>new Response('bad')});await assert.rejects(()=>corrupt.download({url:'https://example.test/bad',file:bad,size:3,sha256:'0'.repeat(64)}),/校验/);await assert.rejects(fs.stat(bad));assert((await fs.readdir(root)).some(n=>n.startsWith('bad.zip.part.invalid-')));
});
test('update allowlist protects creations, models, traversal and plugin data even with valid hashes',()=>{
 for(const name of ['version','runtime/ComfyUI/comfy/ldm/models/autoencoder.py','runtime/python/Lib/site-packages/transformers/models/qwen3/modeling_qwen3.py'])assert.equal(allowedProgramPath(name),true,name);
 for(const name of ['../works/a','works/a.png','runtime/ComfyUI/models/a.bin','runtime/ComfyUI/custom_nodes/plugin/user_data/db.json','resources/../works/x','C:/Windows/a','resources/model.gguf'])assert.equal(allowedProgramPath(name),false,name);
 const file={path:'resources/app.asar',sha256:'f'.repeat(64),size:12};assert(validateUpdateFiles({appId:'com.guangyingruoshui.comic',files:[file]}));assert.throws(()=>validateUpdateFiles({appId:'com.guangyingruoshui.comic',files:[file,{...file,path:'RESOURCES/APP.ASAR'}]}));assert(versionNewer('v0.2.0','0.1.0'));assert(!versionNewer('v0.1.0','0.2.0'));assert(!versionNewer('bad','0.1.0'));
});
test('a repository with no release is reported honestly without a fake update',async t=>{
 const root=await fixture(t),service=await new StudioService(root).init(),updates=await new UpdateManager(service,{fetchRelease:async()=>null}).init();const state=await updates.check();assert.equal(state.available,false);assert.match(state.message,/尚未发布/);await assert.rejects(()=>updates.download(),/没有可下载/);
});
test('automatic updates recognize the renamed program ZIP and legacy releases',async t=>{
 const root=await fixture(t),service=await new StudioService(root).init();
 for(const name of ['ruoshui-comic.update-win-x64.zip','ruoshui-comic-update-win-x64.zip']){
  const asset={name,size:123,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/Penumbrill/ruoshui-comic/releases/download/v0.2.0/'+name};
  const manager=await new UpdateManager(service,{fetchRelease:async()=>({tag_name:'v0.2.0',assets:[asset]})}).init();
  const state=await manager.check();assert.equal(state.available,true);assert.equal(state.files.length,1);assert.equal(state.files[0].name,name);assert.equal(state.files[0].url,asset.browser_download_url);
 }
});
