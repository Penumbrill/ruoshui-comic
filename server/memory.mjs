import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function gpuMemory(){try{const {stdout}=await exec('nvidia-smi',['--query-gpu=index,name,memory.total,memory.free,memory.used','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000});const rows=stdout.trim().split('\n').map(row=>{const[index,name,total,free,used]=row.split(',').map(x=>x.trim());return{index:Number(index),name,total:Number(total),free:Number(free),used:Number(used)};});return rows.find(g=>g.index===0&&g.total>0)||null;}catch{return null;}}
export function imageMemoryPlan(gpu,modelBytes=0,mode='auto'){
 if(mode==='cpu')return{args:['--cpu'],label:'CPU 模式'};
 if(mode==='low')return{args:['--lowvram'],label:'手动低显存模式'};
 const reserve=Math.max(768,Math.min(2048,Math.round((gpu?.total||8192)*.06))),modelMiB=modelBytes/1048576;
 // Leave room for VAE/text encoder, attention activations and the Windows desktop.
 const headroom=reserve+Math.max(4096,modelMiB*.8),fits=gpu&&gpu.free>modelMiB+headroom;
 return{args:gpu?['--reserve-vram',(reserve/1024).toFixed(2),...(fits?['--highvram']:[])]:[],label:fits?'自动 · 模型优先驻留显存':'自动 · 动态显存分配',reserveMiB:reserve,gpu};
}
export function llmMemoryPlan(gpu,{context=8192,reserveMiB,cacheType='auto'}={}){
 const reserve=Math.max(512,Math.min(4096,Number(reserveMiB)||Math.round((gpu?.total||16384)*.045)));
 const cache=cacheType==='f16'?'f16':cacheType==='q8_0'?'q8_0':gpu&&gpu.total>=8192?'q8_0':'f16';
 return{args:['--fit-target',String(reserve),'--flash-attn','auto','--cache-type-k',cache,'--cache-type-v',cache],reserveMiB:reserve,cacheType:cache,label:`自动适配 GPU 层数 · ${cache==='q8_0'?'Q8 缓存':'FP16 缓存'} · 预留 ${reserve} MiB`,gpu,context};
}
