import {wheelNumericValue} from '../shared/numeric-wheel.mjs';
export function installNumericWheel(root=document){
 const gestures=new WeakMap();
 function wheel(event){const input=event.target.closest?.('input[type=number],input[type=range],input[data-wheel-number]')||event.target.closest?.('.number-control,.batch-control')?.querySelector('input');if(!input||input.disabled||input.readOnly||!event.deltaY)return;
  if((input.ownerDocument||root).activeElement!==input){gestures.delete(input);return;}
  event.preventDefault();event.stopPropagation();const now=Date.now(),old=gestures.get(input),direction=event.deltaY<0?1:-1,continuing=old&&now-old.time<400&&old.direction===direction;let remainder=continuing?old.remainder:0;remainder+=Math.abs(event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?120:1);
  const state={time:now,direction,remainder:remainder<40?remainder:0,started:continuing&&old.started};gestures.set(input,state);if(remainder<40)return;
  const minimum=input.getAttribute('data-wheel-min')??input.getAttribute('min'),maximum=input.getAttribute('data-wheel-max')??input.getAttribute('max'),step=input.getAttribute('data-wheel-step')??input.getAttribute('step')??1;
  if(!state.started)input.dispatchEvent(new CustomEvent('parameter-edit-start',{bubbles:true}));state.started=true;
  const value=wheelNumericValue(input.value,{min:minimum===null?-Infinity:Number(minimum),max:maximum===null?Infinity:Number(maximum),step,direction,multiplier:event.shiftKey?10:1});
  if(String(value)===input.value)return;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 }
 const blur=event=>gestures.delete(event.target);
 root.addEventListener('wheel',wheel,{passive:false,capture:true});root.addEventListener('focusout',blur,true);return()=>{root.removeEventListener('wheel',wheel,true);root.removeEventListener('focusout',blur,true);};
}
