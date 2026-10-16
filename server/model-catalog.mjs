import {networkFetch} from './network.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicJson} from './service.mjs';
const exec=promisify(execFile);
export async function inspectModels(service,full=false){
 const manifest=service.modelManifestPath||service.defaultManifestPath;
 const {stdout}=await exec(path.join(service.runtime,'python/python.exe'),['-I',service.downloaderPath,manifest,service.folder('models'),'all',full?'check-full':'check'],{windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});
 const data=stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(d=>d?.type==='integrity');return data?.items||[];
}
export async function hfFiles(url){
 let repo;if(/^https:\/\/huggingface.co\//.test(url)){const parts=new URL(url).pathname.split('/').filter(Boolean);repo=parts.slice(0,2).join('/');}else repo=url;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('请输入 Hugging Face 模型主页地址或 owner/repo');
 const response=await networkFetch(`https://huggingface.co/api/models/${repo}`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('无法读取模型信息；需要登录的仓库暂不支持自动下载');const info=await response.json();
 const r=await networkFetch(`https://huggingface.co/api/models/${repo}/tree/${info.sha}?recursive=true&expand=true`,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('模型文件列表读取失败');const files=await r.json();
 return {repo,revision:info.sha,files:files.filter(f=>/\.(safetensors|pth|pt|ckpt|gguf)$/i.test(f.path)&&f.lfs?.oid).map(f=>({name:f.path,size:f.size,sha256:f.lfs.oid}))};
}
export async function addHfModel(service,{repo,revision,name,category}){
 if(!['diffusion_models','text_encoders','vae','loras','controlnet','upscale_models','detectors','llm'].includes(category))throw Error('请选择模型目录');
 const info=await hfFiles(repo);if(info.revision!==revision)throw Error('仓库已有更新，请重新查询文件列表');const file=info.files.find(f=>f.name===name);if(!file)throw Error('模型文件不存在');
 const shard=file.name.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);const selected=shard?info.files.filter(f=>f.name.startsWith(shard[1]+'-')&&f.name.endsWith('-of-'+shard[3]+'.gguf')):[file];if(shard&&selected.length!==Number(shard[3]))throw Error('分片不完整，请选择其他量化版本');const items=selected.map(f=>({repo,revision,url:`https://huggingface.co/${repo}/resolve/${revision}/${f.name}`,target:(category==='detectors'?'ultralytics/bbox':category)+'/'+path.basename(f.name),size:f.size,sha256:f.sha256}));
 const builtins=JSON.parse(await fs.readFile(path.join(service.bundle,'assets/model-manifest.json'),'utf8'));const managed=JSON.parse(await fs.readFile(path.join(service.data,'custom-models.json'),'utf8').catch(()=>'[]'));
 for(const item of items){const existing=managed.find(m=>m.target===item.target);if(existing&&existing.sha256!==item.sha256)throw Error('同名模型已登记，请先在源仓库或本地更名');if(!existing)managed.push(item);}
 await atomicJson(path.join(service.data,'custom-models.json'),managed);builtins.downloads.custom=managed;builtins.downloads.requested=items;await atomicJson(path.join(service.data,'model-manifest.json'),builtins);service.modelManifestPath=path.join(service.data,'model-manifest.json');return service.downloadModels('requested');
}
