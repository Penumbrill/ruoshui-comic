import path from 'node:path';
import fs from 'node:fs/promises';

// Rebase only paths belonging to this installation. Explicit user paths stay explicit.
export function rebaseInstallationPaths(config,root){
 const old=config.installationRoot;root=path.resolve(root);
 if(old&&path.resolve(old)!==root){
  const migrate=value=>{
   if(typeof value==='string'&&path.isAbsolute(value)){
    const rel=path.relative(old,value);
    if(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&/^(runtime|works)[\\/]/i.test(rel))return path.join(root,rel);
   }
   if(Array.isArray(value))return value.map(migrate);
   if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=migrate(value[key]);
   return value;
  };
  migrate(config);
 }
 config.installationRoot=root;return config;
}

export async function managedFiles(service){
 const roots=[{id:'models',name:'模型与词库文件',folder:service.folder('models')},{id:'runtime',name:'独立运行环境',folder:service.runtime},{id:'output',name:'生成的图片',folder:service.folder('output')},{id:'projects',name:'漫画项目',folder:service.folder('projects')},{id:'assistant',name:'助手对话',folder:service.folder('assistant')}];
 const files=[];
 const walk=async(dir,base,depth=0)=>{
  if(depth>10)return;
  for(const item of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
   if(item.isSymbolicLink())continue;
   const full=path.join(dir,item.name);
   if(item.isDirectory())await walk(full,base,depth+1);
   else if(item.isFile()){const stat=await fs.stat(full);files.push({name:path.relative(base,full).replaceAll('\\','/'),size:stat.size,kind:'models'});}
  }
 };
 await walk(roots[0].folder,roots[0].folder);
 return {root:service.root,folders:roots,files:files.sort((a,b)=>a.name.localeCompare(b.name))};
}

export async function resolveManagedFile(service,kind,name){
 if(kind!=='models'||typeof name!=='string'||!name||name.includes('\0'))throw Error('文件位置无效');
 const base=await fs.realpath(service.folder(kind)),file=await fs.realpath(path.resolve(base,name));
 const rel=path.relative(base,file);
 if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||(await fs.stat(file)).isDirectory())throw Error('文件不在本软件目录内');
 return file;
}
