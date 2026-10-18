import {execFileSync} from 'node:child_process';
// Builds assets only. Publishing is a separate, explicitly authorized operation.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {allowedProgramPath} from '../server/updates.mjs';
const root=path.resolve(import.meta.dirname,'..');
if(!process.argv.includes('--approved'))throw Error('Release build requires explicit authorization');
const resume=process.argv.find(a=>a.startsWith('--resume='))?.slice(9);
const output=path.join(path.dirname(root),'manhua-发布'),stage=resume?path.resolve(resume):path.join(root,'works/build/online-'+crypto.randomUUID());
if(!stage.startsWith(path.join(root,'works/build/online-')))throw Error('Invalid build staging folder');
await fs.mkdir(stage,{recursive:true});
async function run(file,args, cwd=root,env={}){await new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd,env:{...process.env,...env},windowsHide:true,stdio:'inherit'});p.once('error',reject);p.once('close',code=>code===0?resolve():reject(Error('Build step failed: '+path.basename(file))));});}
if(!resume){await run(process.execPath,['node_modules/vite/bin/vite.js','build','--emptyOutDir']);await run(process.execPath,['node_modules/electron-builder/cli.js','--win','dir','--publish=never','--config.directories.output='+stage]);}
const app=path.join(stage,'win-unpacked'),files=[];
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'))).version,build={appId:'com.guangyingruoshui.comic',version,tag:'v'+version,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),builtAt:new Date().toISOString()};
if(!/^[a-f0-9]{40}$/.test(build.commit))throw Error('Invalid source commit');
await fs.writeFile(path.join(app,'ruoshui-build.json'),JSON.stringify(build,null,2));
if(resume)for(const [source,dest]of [['README.md','使用说明.md'],['README.en.md','README.en.md'],['LICENSE','LICENSE.txt'],['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md']])await fs.copyFile(path.join(root,source),path.join(app,dest));
if(await fs.stat(path.join(app,'ruoshui-comic.exe')).then(s=>s.isFile()).catch(()=>false))await fs.rm(path.join(app,'若水漫画.exe'),{force:true});
async function walk(folder,base=''){for(const e of await fs.readdir(folder,{withFileTypes:true})){const name=base+e.name,full=path.join(folder,e.name);if(e.isSymbolicLink()){
 if(/^runtime\/ComfyUI\/custom_nodes\/weilin-comfyui-tools\/(?:user_data(?:_old)?|lora_userdatas|translate_userdatas|random_tag)$/.test(name)){await fs.rmdir(full);continue;}throw Error('Linked release path: '+name);
 }if(e.isDirectory()){if(['__pycache__','cache','downloads','.git'].includes(e.name))continue;await walk(full,name+'/');}else if(e.isFile()){if(!allowedProgramPath(name)||/\.(pth|pyc)$/i.test(name))throw Error('Disallowed release path: '+name);files.push({path:name,size:(await fs.stat(full)).size});}}}
await walk(app);const oldManifest=files.findIndex(f=>f.path==='ruoshui-update.json');if(oldManifest>=0)files.splice(oldManifest,1);let next=0;
async function hash(file){const h=crypto.createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
await Promise.all(Array.from({length:8},async()=>{for(;;){const i=next++;if(i>=files.length)break;files[i].sha256=await hash(path.join(app,files[i].path));}}));

// The regular updater refreshes program files. Runtime ZIPs remain separate install assets.
const core=files.filter(f=>!f.path.startsWith('runtime/'));
await fs.writeFile(path.join(app,'ruoshui-update.json'),JSON.stringify({appId:'com.guangyingruoshui.comic',version,build,files:core},null,2));
core.push({path:'ruoshui-update.json',size:(await fs.stat(path.join(app,'ruoshui-update.json'))).size});
const groups=[{name:'ruoshui-comic.update-win-x64.zip',files:core}];let group;
for(const file of files.filter(f=>f.path.startsWith('runtime/')).sort((a,b)=>a.path.localeCompare(b.path))){if(!group||group.bytes+file.size>1400000000){group={name:'ruoshui-runtime-win-x64-'+String(groups.length).padStart(2,'0')+'.zip',files:[],bytes:0};groups.push(group);}group.files.push(file);group.bytes+=file.size;}
const portable=path.join(output,'纯净整合包'),installer=path.join(output,'安装版');await fs.mkdir(portable,{recursive:true});await fs.mkdir(installer,{recursive:true});
const compressor=path.join(root,'node_modules/electron-winstaller/vendor/7z.exe'),packages=[];
// Program-only rebuilds may reuse the already verified, unchanged runtime ZIPs.
const reuseRuntime=process.argv.includes('--reuse-runtime-zips');
if(reuseRuntime&&!resume)throw Error('Runtime ZIP reuse requires an existing verified staging directory');
const priorPackages=reuseRuntime?JSON.parse(await fs.readFile(path.join(stage,'release-packages.json'),'utf8')).packages:[];
for(const group of groups){
 if(reuseRuntime&&group.name.startsWith('ruoshui-runtime-')){
  const zip=path.join(stage,group.name),previous=priorPackages.find(p=>p.name===group.name),previousPaths=(await fs.readFile(path.join(stage,group.name+'.list'),'utf8')).split('\n');
  if(!previous||JSON.stringify(previousPaths)!==JSON.stringify(group.files.map(f=>f.path))||(await fs.stat(zip)).size!==previous.size||await hash(zip)!==previous.sha256)throw Error('Cached runtime ZIP verification failed');
  packages.push(previous);await fs.copyFile(zip,path.join(portable,group.name));continue;
 }
 const list=path.join(stage,group.name+'.list');await fs.writeFile(list,group.files.map(f=>f.path).join('\n'));const zip=path.join(stage,group.name);await fs.rm(zip,{force:true});await run(compressor,['a','-tzip','-mx=5','-scsUTF-8',zip,'@'+list],app);const size=(await fs.stat(zip)).size;if(size>=2147483648)throw Error('Release asset exceeds GitHub limit');await run(compressor,['t',zip]);packages.push({name:group.name,size,sha256:await hash(zip)});await fs.copyFile(zip,path.join(portable,group.name));}
const manifest={appId:'com.guangyingruoshui.comic',repository:'Penumbrill/ruoshui-comic',tag:'v'+version,packages};
const manifestPath=path.join(stage,'release-packages.json');await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
// Keep guide files in their own directory: merging all release ZIPs must not
// overwrite program documentation or trigger duplicate-file prompts.
const guideRoot=path.join(stage,'guide'),guide=path.join(guideRoot,'安装说明');await fs.mkdir(guide,{recursive:true});
for(const name of ['README.md','README.en.md','LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(root,name),path.join(guide,name));
await fs.cp(path.join(root,'docs/images'),path.join(guide,'docs/images'),{recursive:true});
await fs.copyFile(manifestPath,path.join(guide,'release-packages.json'));await fs.copyFile(path.join(root,'scripts/download-release.ps1'),path.join(guide,'download-release.ps1'));
await fs.copyFile(path.join(root,'assets/release-transfer.cs'),path.join(guide,'release-transfer.cs'));
await fs.rm(path.join(guide,'校验整合包.cmd'),{force:true});
await fs.writeFile(path.join(guide,'verify-packages.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-release.ps1" -Target "%~dp0.." -Manifest "%~dp0release-packages.json" -VerifyOnly\r\npause\r\n');
const guideZip=path.join(stage,'ruoshui-setup-guide.zip');await fs.rm(guideZip,{force:true});await run(compressor,['a','-tzip',guideZip,'安装说明'],guideRoot);await fs.copyFile(guideZip,path.join(portable,'ruoshui-setup-guide.zip'));
const require=createRequire(import.meta.url),{getMakeNsisPath}=require('app-builder-lib/out/toolsets/windows.js');const nsis=await getMakeNsisPath(null,{...JSON.parse(await fs.readFile(path.join(root,'package.json'))).build.nsis.customNsisBinary,version:'1.0.0'});
const exe=path.join(stage,'ruoshui-comic.exe');await run(nsis.path,['-INPUTCHARSET','UTF8','-DPROJECT_ROOT='+root,'-DOUTPUT_EXE='+exe,'-DPACKAGE_MANIFEST='+manifestPath,path.join(root,'scripts/online-installer.nsi')],root,nsis.env);await fs.copyFile(exe,path.join(installer,'ruoshui-comic.exe'));
await fs.writeFile(path.join(root,'works/logs/online-release-result.json'),JSON.stringify({stage,app,manifest,installer:{size:(await fs.stat(exe)).size,sha256:await hash(exe)},files:files.length,unpackedBytes:files.reduce((n,f)=>n+f.size,0)},null,2));
await fs.rm(path.join(portable,'ruoshui-comic-update-win-x64.zip'),{force:true});
console.log('Release assets ready: '+output);
