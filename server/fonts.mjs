import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {atomicJson,readJson} from './service.mjs';
import {fontFamilyNames} from '../shared/font-names.mjs';
const exec=promisify(execFile);let systemCache;
export async function systemFonts(){
 if(systemCache)return systemCache;
 systemCache=(async()=>{if(process.platform!=='win32')return [];let names=[];try{const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Drawing;$f=New-Object System.Drawing.Text.InstalledFontCollection;@($f.Families|ForEach-Object {$_.Name})|ConvertTo-Json -Compress";const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:2*1024*1024});names=JSON.parse(stdout.replace(/^\uFEFF/,''));}catch{}
 if(!names.length)for(const folder of [path.join(process.env.WINDIR||'C:/Windows','Fonts'),path.join(process.env.LOCALAPPDATA||'','Microsoft/Windows/Fonts')]){const files=await fs.readdir(folder).catch(()=>[]);for(let i=0;i<files.length;i+=8)await Promise.all(files.slice(i,i+8).filter(name=>/\.(ttf|ttc|otf)$/i.test(name)).map(async name=>{try{names.push(...fontFamilyNames(await fs.readFile(path.join(folder,name))));}catch{}}));}
 return [...new Set(names)].sort().map(name=>({id:'system-'+crypto.createHash('sha1').update(name).digest('hex'),family:name,label:name,source:'system',category:'本机字体'}));})();return systemCache;
}
export function validateFont(name,base64){
 const extension=path.extname(String(name)).toLowerCase();if(!['.ttf','.otf','.woff','.woff2'].includes(extension))throw Error('请选择 TTF、OTF、WOFF 或 WOFF2 字体');
 if(typeof base64!=='string'||base64.length>56*1024*1024)throw Error('单个字体不能超过 40 MB');const bytes=Buffer.from(base64,'base64');
 const signatures={'.ttf':['00010000','74727565'],'.otf':['4f54544f'],'.woff':['774f4646'],'.woff2':['774f4632']};
 if(bytes.length<32||bytes.length>40*1024*1024||!signatures[extension].includes(bytes.subarray(0,4).toString('hex')))throw Error('这不是有效的字体文件');return {bytes,extension};
}
export class FontCatalog{
 constructor(service){this.service=service;this.folder=path.join(service.data,'fonts');this.bundle=path.join(service.bundle.includes('app.asar')?service.bundle.replace('app.asar','app.asar.unpacked'):service.bundle,'assets/fonts');this.pending=Promise.resolve();}
 async entries(){return [...(await readJson(path.join(this.bundle,'catalog.json'),[])),...(await readJson(path.join(this.folder,'catalog.json'),[]))];}
 async list(){return [...(await this.entries()).map(item=>({...item,url:'/api/fonts/file/'+item.id})),...await systemFonts()];}
 async import({name,base64}){const task=this.pending.catch(()=>{}).then(async()=>{const {bytes,extension}=validateFont(name,base64),hash=crypto.createHash('sha256').update(bytes).digest('hex');const all=await this.entries(),existing=all.find(item=>item.sha256===hash);if(existing)return {...existing,url:'/api/fonts/file/'+existing.id};await fs.mkdir(this.folder,{recursive:true});const id='user-'+hash.slice(0,24),file=id+extension,label=path.basename(String(name),extension).replace(/[\x00-\x1f]/g,'').slice(0,120);const item={id,file,label,family:'Ruoshui-'+id,source:'imported',category:'导入字体',sha256:hash,size:bytes.length};await fs.writeFile(path.join(this.folder,file),bytes);const users=await readJson(path.join(this.folder,'catalog.json'),[]);users.push(item);await atomicJson(path.join(this.folder,'catalog.json'),users);return {...item,url:'/api/fonts/file/'+id};});this.pending=task;return task;}
 async file(id){if(!/^[a-zA-Z0-9-]+$/.test(id))throw Error('无效字体');const entry=(await this.entries()).find(item=>item.id===id);if(!entry||path.basename(entry.file)!==entry.file)throw Error('字体不存在');return {bytes:await fs.readFile(path.join(entry.source==='imported'?this.folder:this.bundle,entry.file)),type:({'.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'})[path.extname(entry.file).toLowerCase()]};}
}
