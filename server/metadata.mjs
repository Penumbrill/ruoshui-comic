import {inflateSync} from 'node:zlib';
export function pngMetadata(buffer){
 const result={};if(!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return result;
 let offset=8;while(offset+12<=buffer.length){const length=buffer.readUInt32BE(offset),type=buffer.subarray(offset+4,offset+8).toString();if(offset+12+length>buffer.length)break;const data=buffer.subarray(offset+8,offset+8+length);offset+=length+12;
  try{if(type==='tEXt'){const i=data.indexOf(0);result[data.subarray(0,i).toString()]=data.subarray(i+1).toString('utf8');}if(type==='zTXt'){const i=data.indexOf(0);result[data.subarray(0,i).toString()]=inflateSync(data.subarray(i+2),{maxOutputLength:2*1024*1024}).toString('utf8');}if(type==='IHDR'){result.width=buffer.readUInt32BE(16);result.height=buffer.readUInt32BE(20);}}catch{}
 }
 return result;
}
export function extractGeneration(buffer){
 const meta=pngMetadata(buffer);let prompt;
 try{prompt=JSON.parse(meta.prompt||'null');}catch{}
 if(prompt&&typeof prompt==='object'){
  const sampler=Object.values(prompt).find(n=>n.class_type==='KSampler');
  function text(link,visited=new Set()){
   if(typeof link==='string')return link;if(!Array.isArray(link)||visited.has(link[0]))return '';visited.add(link[0]);const node=prompt[link[0]];if(!node)return '';const value=node.inputs?.text??node.inputs?.positive??node.inputs?.prompt??node.inputs?.string;return text(value,visited);
  }
  if(sampler){const input=sampler.inputs;const model=Object.values(prompt).find(n=>n.class_type==='UNETLoader')?.inputs?.unet_name||'';
   return {type:model.includes('2.9')||model.includes('29B')?'expanded':'original',positive:text(input.positive),negative:text(input.negative),width:meta.width,height:meta.height,steps:input.steps,cfg:input.cfg,sampler:input.sampler_name,scheduler:input.scheduler,seed:String(input.seed),model};}
 }
 if(typeof meta.parameters==='string'){
  const text=meta.parameters;const neg=text.indexOf('Negative prompt:');const settings=text.lastIndexOf('Steps:');return {type:'original',positive:text.slice(0,neg>=0?neg:settings>=0?settings:undefined).trim(),negative:neg>=0?text.slice(neg+16,settings>=0?settings:undefined).trim():'',width:meta.width,height:meta.height};
 }
 if(typeof meta.prompt==='string'&&!prompt)return {type:'original',positive:meta.prompt,negative:meta.negative_prompt||'',width:meta.width,height:meta.height};
 return null;
}
