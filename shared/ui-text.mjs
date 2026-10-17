import generated from './ui-en.mjs';
import overrides from './ui-en-overrides.mjs';
export const english={...generated,...overrides};
const escaped=Object.keys(english).filter(key=>/[\u3400-\u9fff]/.test(key)&&key.length>1&&!key.includes('\n')).sort((a,b)=>b.length-a.length).map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const fragments=new RegExp(escaped.join('|'),'g');
export function translateUi(value){
 if(typeof value!=='string'||!/[\u3400-\u9fff]/.test(value))return value;
 if(Object.hasOwn(english,value))return english[value];
 const trimmed=value.trim();if(Object.hasOwn(english,trimmed))return value.replace(trimmed,english[trimmed]);
 return value.replace(fragments,part=>english[part]);
}
