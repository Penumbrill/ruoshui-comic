import {translateUi} from '../shared/ui-text.mjs';
import {resizePanelPair,fitPanelSizes} from './editor/panel-sizes';
export const resizePanels={
 mounted(el,binding){
  let options=binding.value||{},panels=[],handles=[],sizes=[],drag=null,frame,previousKey='',previousExtent=0;
  const label=value=>options.config?.language==='en'?translateUi(value):value;
  const vertical=()=>options.axis==='rows',dimension=()=>vertical()?'height':'width',styleName=()=>vertical()?'gridTemplateRows':'gridTemplateColumns';
  const allPanels=()=>[...el.children].filter(p=>!p.classList.contains('panel-resize-handle')&&!p.classList.contains('modal-backdrop')&&!p.classList.contains('hidden')&&getComputedStyle(p).display!=='none');
  const key=()=>options.key+':'+(vertical()?'rows':'cols')+':'+panels.length;
  function position(){const base=el.getBoundingClientRect();for(let i=0;i<handles.length;i++){const r=panels[i].getBoundingClientRect(),next=panels[i+1].getBoundingClientRect();handles[i].style[vertical()?'top':'left']=((vertical()?(r.bottom+next.top)/2-base.top:(r.right+next.left)/2-base.left))+'px';}}
  function apply(){el.style[styleName()]=sizes.map(n=>Math.round(n*100)/100+'px').join(' ');position();}
  function save(){if(options.config)(options.config.panelSizes||(options.config.panelSizes={}))[key()]=sizes;}
  function reset(){if(options.config?.panelSizes)delete options.config.panelSizes[key()];el.style[styleName()]='';previousKey='';schedule();}
  function build(){
   if(drag)return;panels=allPanels();if(panels.length<2||panels.length>4)return;
   const rect=el.getBoundingClientRect(),extent=rect[dimension()];if(extent<10)return;
   const gap=parseFloat(getComputedStyle(el)[vertical()?'rowGap':'columnGap'])||0,total=extent-gap*(panels.length-1);
   if(previousKey!==key()||handles.some(h=>h.dataset.language!==(options.config?.language||'zh'))){
    el.style[styleName()]='';sizes=panels.map(p=>p.getBoundingClientRect()[dimension()]);
    const saved=options.config?.panelSizes?.[key()];if(saved?.length===panels.length&&saved.every(n=>Number.isFinite(n)&&n>0))sizes=saved;
    previousKey=key();
   }else if(Math.abs(previousExtent-extent)<.5){position();return;}
   previousExtent=extent;sizes=fitPanelSizes(sizes,total,options.min||[]);
   for(const handle of handles)handle.remove();handles=[];el.classList.add('resizable-panels');
   for(let i=0;i<panels.length-1;i++){
    const handle=document.createElement('div');handle.className='panel-resize-handle '+(vertical()?'resize-rows':'resize-columns');handle.setAttribute('role','separator');handle.setAttribute('aria-orientation',vertical()?'horizontal':'vertical');handle.setAttribute('aria-label',label(options.labels?.[i]||'拖动调整相邻功能区大小'));handle.title=label('拖动调整功能区 · 双击恢复默认 · 方向键微调');handle.tabIndex=0;handle.dataset.language=options.config?.language||'zh';
    handle.onpointerdown=e=>{if(e.button!==0||el.closest('.comic-workspace')?.querySelector('.page-picker-list')||el.querySelector('.layer-menu,[role="menu"],[role="listbox"]'))return;e.preventDefault();e.stopPropagation();drag={index:i,start:vertical()?e.clientY:e.clientX,sizes:[...sizes]};handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panels');};
    handle.onpointermove=e=>{if(!drag)return;sizes=resizePanelPair(drag.sizes,drag.index,(vertical()?e.clientY:e.clientX)-drag.start,options.min||[]);apply();};
    const end=()=>{if(!drag)return;drag=null;document.body.classList.remove('resizing-panels');save();schedule();};handle.onpointerup=end;handle.onpointercancel=end;handle.ondblclick=reset;
    handle.onkeydown=e=>{const keys=vertical()?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];if(!keys.includes(e.key))return;e.preventDefault();sizes=resizePanelPair(sizes,i,(e.key===keys[0]?-1:1)*(e.shiftKey?40:12),options.min||[]);apply();save();};
    el.appendChild(handle);handles.push(handle);
   }apply();
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(build);}
  const observer=new ResizeObserver(schedule);observer.observe(el);const children=new MutationObserver(()=>{if(allPanels().length!==panels.length){previousKey='';schedule();}});children.observe(el,{childList:true});
  el.__panelResize={update:value=>{options=value||{};schedule();},destroy:()=>{cancelAnimationFrame(frame);observer.disconnect();children.disconnect();handles.forEach(h=>h.remove());document.body.classList.remove('resizing-panels');}};schedule();
 },updated(el,binding){el.__panelResize?.update(binding.value);},beforeUnmount(el){el.__panelResize?.destroy();}
};
