export function defaultQuality(type='original'){return type==='expanded'?'masterpiece, best quality':'masterpiece, best quality, score_7, safe';}
export function qualityPrefix(preferences={},type='original'){return preferences.useDefaultQuality===false?String(preferences.customQuality||'').trim().replace(/[,，\s]+$/,''):defaultQuality(type);}
function split(text){const out=[];let start=0,depth=0,escaped=false;for(let i=0;i<text.length;i++){const c=text[i];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if('([{'.includes(c))depth++;if(')]}'.includes(c))depth=Math.max(0,depth-1);if((c===','||c==='，')&&!depth){out.push(text.slice(start,i).trim());start=i+1;}}out.push(text.slice(start).trim());return out.filter(Boolean);}
const quality=/^(?:masterpiece|(?:best|high|highest|normal|low|worst) quality|(?:very )?aesthetic|absurdres|highres|ultra detailed|score_\d+(?:_up)?|safe|rating:safe)$/i;
export function applyAssistantQuality(positive,preferences={},type='original',previousPrefix=''){
 positive=String(positive||'');if(previousPrefix&&(positive===previousPrefix||positive.startsWith(previousPrefix+', ')))positive=positive.slice(previousPrefix.length).replace(/^[,\s]+/,'');
 const prefix=qualityPrefix(preferences,type),custom=new Set(split(String(preferences.customQuality||'')).map(s=>s.toLowerCase()));
 const content=split(positive).filter(t=>!quality.test(t.replace(/^\((.+):[\d.]+\)$/,'$1'))&&!custom.has(t.toLowerCase()));
 return [...(prefix?[prefix]:[]),...content].join(', ');
}
export function qualityStory(story,preferences,type){return{...story,qualityPrefix:qualityPrefix(preferences,type),panels:story.panels.map(panel=>({...panel,positive:applyAssistantQuality(panel.positive,preferences,type,story.qualityPrefix)}))};}
export function qualityInstruction(preferences,type){const prefix=qualityPrefix(preferences,type);return '\nQuality words are controlled by the application. '+(prefix?'The only quality/meta prefix allowed is exactly: '+prefix+'. ':'Do not add any quality/meta prefix. ')+ 'Do not invent additional masterpiece, best quality, score or rating tags. Keep the scene and style descriptions.';}
