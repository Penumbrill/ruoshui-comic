const chinese=/[\u3400-\u9fff]/;
export function validTranslation(input,output,target){
 if(typeof output!=='string'||!output.trim()||output.length>Math.max(400,input.length*12))return false;
 const text=output.trim();
 if(target==='en'&&chinese.test(text))return false;
 if(target==='zh'&&/[a-z]{2}/i.test(input)&&!chinese.test(text))return false;
 if(text.toLowerCase()===input.trim().toLowerCase()&&(target==='zh'?/[a-z]{2}/i.test(input):chinese.test(input)))return false;
 if(/(.{2,40}?)\1{3,}/iu.test(text))return false;
 return true;
}
// Availability and output checks choose the first usable provider; a failed provider
// cools down briefly so every visible tag does not repeat the same long timeout.
export class TranslationRouter{
 constructor(){this.failures=new Map();}
 async run(texts,target,providers){
  const values=new Map(),sources=new Map(),failures=[];
  for(const provider of providers){
   const missing=texts.filter(text=>!values.has(text));if(!missing.length)break;
   if((this.failures.get(provider.id)||0)>Date.now()){failures.push(provider.name);continue;}
   const controller=new AbortController();let timer;
   try{
    const result=await Promise.race([provider.run(missing,controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();provider.cancel?.();reject(Error('翻译超时'));},provider.timeout||15000);})]);
    if(!Array.isArray(result)||result.length!==missing.length)throw Error('翻译结果数量不正确');
    let accepted=0;missing.forEach((text,i)=>{if(validTranslation(text,result[i],target)){values.set(text,result[i].trim());sources.set(text,provider.name);accepted++;}});
    if(!accepted)throw Error('翻译结果未通过语言与重复检查');
    this.failures.delete(provider.id);
   }catch{this.failures.set(provider.id,Date.now()+60000);failures.push(provider.name);}finally{clearTimeout(timer);}
  }
  return{values,sources,failures};
 }
}
