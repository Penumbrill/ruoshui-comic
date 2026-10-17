import './locale.js';
import {contentRatingPreference,adaptContentControls} from './content-controls.js';
// Desktop dismissal delegates to upstream buttons; filtering and search stay upstream.
document.addEventListener('click',event=>{
 const overlay=event.target;if(!(overlay instanceof HTMLElement)||!overlay.isConnected||overlay.style.position!=='fixed'||overlay.style.display!=='flex'||Number(overlay.style.zIndex)<9999)return;
 const save=[...overlay.querySelectorAll('button')].find(button=>['保存','Save'].includes(button.textContent.trim()));
 if(save){save.click();return;}
 if(overlay.onclick)return;
 const close=[...overlay.querySelectorAll('button,span')].find(button=>['✕','×','✖'].includes(button.textContent.trim()));
 close?.click();
});
const brokenImages=new WeakMap();
document.addEventListener('error',async event=>{
 const img=event.target;if(!(img instanceof HTMLImageElement)||!img.src.includes('/danbooru_anima/image_proxy?'))return;
 const old=brokenImages.get(img);if(old)old.remove();
 const box=document.createElement('div');box.className='db-image-failure';box.addEventListener('click',e=>e.stopPropagation());
 const message=document.createElement('span');message.textContent='图片加载失败';
 const retry=document.createElement('button');retry.type='button';retry.textContent='↻ 重试图片';retry.title='仅重试此图片，保留搜索和标签选择';
 retry.onclick=e=>{e.stopPropagation();box.remove();brokenImages.delete(img);const url=new URL(img.src);url.searchParams.set('retry',Date.now());img.src=url.href;};
 box.append(message,retry);img.parentElement?.append(box);brokenImages.set(img,box);
 try{const url=new URL(img.src).searchParams.get('url');const detail=await fetch('/api/danbooru/image-status?'+new URLSearchParams({url})).then(r=>r.json());if(brokenImages.get(img)===box){message.textContent=detail.message;box.title=detail.message;}}catch{}
},true);
document.addEventListener('load',event=>{const img=event.target;if(img instanceof HTMLImageElement){brokenImages.get(img)?.remove();brokenImages.delete(img);}},true);
function adaptLayout(){
 const container=document.querySelector('#root>div');if(!container)return;
 const [search,info,,grid,paging,status]=container.children;
 for(const [element,name]of [[search,'db-search-controls'],[info,'db-info-strip'],[grid,'db-post-grid'],[paging,'db-page-toolbar'],[status,'db-statusbar']])element?.classList.add(name);
 const ratings=search?.querySelector('input[type=checkbox]')?.parentElement;
 if(ratings){ratings.classList.add('db-rating-controls');const children=[...ratings.children];for(let i=0;i<children.length;i+=2){const pair=document.createElement('span');pair.className='db-rating-pair';pair.append(...children.slice(i,i+2));ratings.append(pair);}}
}
let currentNode,selectionTimer;
function announceSelection(){clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{if(!currentNode)return;const widgets=Object.fromEntries(currentNode.widgets.map(w=>[w.name,w.value]));let selection;try{selection=JSON.parse(widgets.selection_data||'{}');}catch{selection={};}parent.postMessage({type:'danbooru-selected',selection,widgets},location.origin);},30);}
window.ComfyUI={settings:{get:key=>key==='language'?(parent.document.documentElement.lang==='en'?'en-US':'zh-CN'):undefined}};
export const app={graph:{links:{}},canvas:{setDirty:()=>{}},registerExtension:async extension=>{
 const settings=await fetch('/api/danbooru/preferences',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).catch(()=>({}));
 settings.rating_filter=contentRatingPreference(settings.rating_filter,settings.__allowAdultFilters===true);
 function Node(){this.outputs=Array.from({length:8},()=>({links:[]}));this.widgets=['selection_data','rating_filter','node_settings','来自AnimaDex','_tag_fusion','exclude_tags'].map(name=>{let value=settings[name]||(name==='rating_filter'?JSON.stringify({all:false,ratings:['general']}):'');return{name,get value(){return value;},set value(v){value=v;if(['selection_data','_tag_fusion','node_settings','exclude_tags'].includes(name))announceSelection();if(name!=='selection_data'){settings[name]=v;clearTimeout(this.timer);this.timer=setTimeout(()=>fetch('/api/danbooru/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)}),250);}}};});}
 Node.prototype.setSize=()=>{};Node.prototype.addDOMWidget=function(name,type,element){document.getElementById('root').append(element);return{element};};
 await extension.beforeRegisterNodeDef(Node,{name:'DanbooruBrowser'});const node=new Node();currentNode=node;node.onNodeCreated();adaptLayout();adaptContentControls(settings.__allowAdultFilters===true);const input=document.querySelector('#root input[type=text],#root input:not([type])');if(input){input.value=settings.__query||'';input.addEventListener('input',()=>{settings.__query=input.value;clearTimeout(input.saveTimer);input.saveTimer=setTimeout(()=>fetch('/api/danbooru/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)}),300);});}window.app=app;parent.postMessage({type:'danbooru-ready'},location.origin);
}};
