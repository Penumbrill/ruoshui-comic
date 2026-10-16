import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {comicFolderName,comicExportPath} from '../server/comic-exports.mjs';
import {StudioService} from '../server/service.mjs';

test('project names become safe Windows export folders without traversing directories',()=>{
 const base=path.resolve('works/exports');
 for(const name of ['森林野餐','../外部/目录','CON','NUL.txt','...','  ','故事:第一话?']){
  const result=comicExportPath(base,name,'page-1.png');
  assert.equal(path.dirname(result.folder),base);
  assert.equal(path.dirname(result.path),result.folder);
  assert(!/[<>:"/\\|?*]/.test(comicFolderName(name)));
 }
 assert.equal(comicFolderName('森林野餐'),'森林野餐');
 assert.equal(comicFolderName('CON'),'漫画_CON');
});

test('comic pages export into one named project folder and other exports keep their original location',async t=>{
 const base=path.resolve('works/tests');await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'comic-export-')),service=await new StudioService(root).init();
 t.after(async()=>{service.shutdown();await service.writeChain;assert(root.startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const bytes=Buffer.from('export-payload'),base64=bytes.toString('base64');
 for(const name of ['森林野餐-1.png','森林野餐-2.png']){
  const result=await service.exportFile({name,base64,kind:'comic',projectName:'森林野餐'});
  assert.equal(path.dirname(result.path),path.join(root,'works/exports/森林野餐'));
  assert.deepEqual(await fs.readFile(result.path),bytes);
 }
 const other=await service.exportFile({name:'另一个项目-1.png',base64,kind:'comic',projectName:'另一个项目'});
 assert.equal(path.basename(path.dirname(other.path)),'另一个项目');
 assert.equal(service.config.comicExportFolders[encodeURIComponent('森林野餐')],path.join(root,'works/exports/森林野餐'));
 const generic=await service.exportFile({name:'提示词.txt',base64});assert.equal(path.dirname(generic.path),path.join(root,'works/exports'));
 const restored=await new StudioService(root).init();assert.equal(restored.config.comicExportFolders[encodeURIComponent('另一个项目')],path.dirname(other.path));restored.shutdown();
});
