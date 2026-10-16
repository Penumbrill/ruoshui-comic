export function splitTags(text){
 const tags=[];let buffer='',escaped=false;const stack=[];const pairs={'(':')','[':']','{':'}','<':'>'};
 for(const char of String(text||'')){
  if(escaped){buffer+=char;escaped=false;continue;}
  if(char==='\\'){buffer+=char;escaped=true;continue;}
  if(pairs[char])stack.push(pairs[char]);else if(stack.at(-1)===char)stack.pop();
  if(!stack.length&&(char===','||char==='，'||char==='\n')){if(buffer.trim())tags.push(buffer.trim());buffer='';}else buffer+=char;
 }
 if(buffer.trim())tags.push(buffer.trim());return tags;
}
export function formatPrompt(text,{trailing=true}={}){
 return String(text||'').replaceAll('\r\n','\n').split('\n').map(line=>{const tags=splitTags(line);return tags.length?tags.join(', ')+(trailing?', ':''):'';}).join('\n');
}
export function appendPrompt(text,addition){return formatPrompt(formatPrompt(text)+String(addition||''));}
export function adjustWeight(token,delta){const match=token.match(/^\((.*):(-?\d+(?:\.\d+)?)\)$/);const base=match?match[1]:token;const weight=Math.max(-5,Math.min(5,(match?Number(match[2]):1)+delta));return `(${base}:${weight.toFixed(1)})`;}
export function uniquePrompt(text){const seen=new Set();return formatPrompt(splitTags(text).filter(tag=>{const key=tag.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).join(', '));}
export function updatePromptTag(text,index,update){let n=0;return String(text||'').split('\n').map(line=>splitTags(line).flatMap(tag=>{const current=n++;return current===index?update(tag):[tag];}).join(', ')).map(line=>line?line+', ':'').join('\n');}
export function breakAfterTag(text,index){let n=0;return String(text||'').split('\n').map(line=>{let out='';for(const tag of splitTags(line)){out+=tag+', ';if(n++===index)out+='\n';}return out;}).join('\n').replace(/\n[ \t]+/g,'\n').replace(/\n{2,}/g,'\n');}
export function movePromptTag(text,from,to){
 const lines=String(text||'').replaceAll('\r\n','\n').split('\n').map(splitTags),tags=lines.flat();
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=tags.length||to>=tags.length||from===to)return String(text||'');
 const [tag]=tags.splice(from,1);tags.splice(to,0,tag);let index=0;
 return lines.map(line=>{const entries=tags.slice(index,index+line.length);index+=line.length;return entries.length?entries.join(', ')+', ':'';}).join('\n');
}
