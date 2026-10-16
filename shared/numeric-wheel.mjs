export function wheelNumericValue(value,{step=1,min=-Infinity,max=Infinity,direction=1,multiplier=1}={}){
 const increment=Number.isFinite(Number(step))&&Number(step)>0?Number(step):1;let number=Number(value);if(value===''||!Number.isFinite(number))number=Math.max(min,Math.min(max,0));
 const next=Math.min(max,Math.max(min,number+increment*direction*multiplier));return Number(Math.max(-Number.MAX_SAFE_INTEGER,Math.min(Number.MAX_SAFE_INTEGER,next)).toFixed(10));
}
