export function wheelStep(declared=1,override=null){const fixed=Number(override);if(override!==null&&Number.isFinite(fixed)&&fixed>0)return fixed;const step=Number(declared);return step>0&&step<1?.1:1;}
export function featureNumberStep(key,schemaType){if(schemaType==='INT'||/(?:^|_)(?:size|width|height|padding|blur|dilation|expansion|feather|steps?|cycle|batch|count)(?:_|$)/.test(key))return 1;if(schemaType==='FLOAT'||/^(cfg|denoise|upscale_by|seam_fix_denoise)$|threshold|factor/.test(key))return .1;return 1;}
export function wheelNumericValue(value,{step=1,min=-Infinity,max=Infinity,direction=1,multiplier=1,integer=false}={}){
 const increment=Number.isFinite(Number(step))&&Number(step)>0?Number(step):1;let number=Number(value);if(value===''||!Number.isFinite(number))number=Math.max(min,Math.min(max,0));
 if(integer)number=Math.round(number);const next=Math.min(max,Math.max(min,number+increment*direction*multiplier));return Number(Math.max(-Number.MAX_SAFE_INTEGER,Math.min(Number.MAX_SAFE_INTEGER,next)).toFixed(10));
}
