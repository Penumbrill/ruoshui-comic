const zoomStates=new WeakMap(),brushStates=new WeakMap();
export const previewZoom={
 mounted(el,binding){
  const state={value:binding.value,scale:1,x:0,y:0,drag:null};zoomStates.set(el,state);
  const target=()=>el.querySelector(state.value?.target||':scope > img, :scope > canvas, :scope > svg, :scope > .zoom-content');
  function render(){const item=target();if(item){item.style.transformOrigin='50% 50%';item.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;}}
  state.wheel=e=>{if(e.target.closest('input,button,select,textarea'))return;const item=target();if(!item)return;e.preventDefault();e.stopPropagation();const r=el.getBoundingClientRect(),old=state.scale,next=Math.max(.1,Math.min(16,old*Math.exp(-e.deltaY*.0015))),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;state.x=x-(x-state.x)*next/old;state.y=y-(y-state.y)*next/old;state.scale=next;render();};
  state.down=e=>{if(e.button!==1)return;e.preventDefault();el.setPointerCapture(e.pointerId);state.drag={x:e.clientX,y:e.clientY,left:state.x,top:state.y};};
  state.move=e=>{if(!state.drag)return;state.x=state.drag.left+e.clientX-state.drag.x;state.y=state.drag.top+e.clientY-state.drag.y;render();};
  state.up=()=>state.drag=null;state.reset=e=>{if(e.target.closest('button,input'))return;state.scale=1;state.x=state.y=0;render();};
  el.addEventListener('wheel',state.wheel,{passive:false});el.addEventListener('pointerdown',state.down);el.addEventListener('pointermove',state.move);el.addEventListener('pointerup',state.up);el.addEventListener('pointercancel',state.up);el.addEventListener('dblclick',state.reset);el.classList.add('wheel-zoom-viewport');
 },
 updated(el,binding){const state=zoomStates.get(el);if(state)state.value=binding.value;},
 unmounted(el){const s=zoomStates.get(el);if(!s)return;for(const [event,key] of [['wheel','wheel'],['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','up'],['dblclick','reset']])el.removeEventListener(event,s[key]);zoomStates.delete(el);}
};
export const brushCursor={
 mounted(el,binding){const circle=document.createElement('div');circle.className='round-brush-cursor';document.body.append(circle);const state={value:binding.value,circle};brushStates.set(el,state);
 state.move=e=>{const value=state.value;if(value?.enabled===false||e.pointerType==='touch'){circle.style.display='none';el.style.cursor='';return;}const r=el.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){circle.style.display='none';return;}const size=Math.max(2,Number(value?.size||22));Object.assign(circle.style,{display:'block',left:e.clientX+'px',top:e.clientY+'px',width:size+'px',height:size+'px',borderColor:value?.color||'#fff'});el.style.cursor='none';};state.leave=()=>{circle.style.display='none';};
 el.addEventListener('pointermove',state.move);el.addEventListener('pointerenter',state.move);el.addEventListener('pointerleave',state.leave);el.addEventListener('pointercancel',state.leave);
 },updated(el,binding){const state=brushStates.get(el);if(state){state.value=binding.value;if(state.value?.enabled===false){state.circle.style.display='none';el.style.cursor='';}}},unmounted(el){const s=brushStates.get(el);if(!s)return;el.removeEventListener('pointermove',s.move);el.removeEventListener('pointerenter',s.move);el.removeEventListener('pointerleave',s.leave);el.removeEventListener('pointercancel',s.leave);s.circle.remove();brushStates.delete(el);}
};
