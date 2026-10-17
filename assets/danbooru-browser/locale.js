// Localize the host UI without modifying upstream search, filtering or tag data.
if(parent.document.documentElement.lang==='en'){
 const words=await(await fetch('/api/ui-locale/en')).json(),escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=new RegExp(Object.keys(words).filter(s=>s.length>1&&!s.includes('\n')).sort((a,b)=>b.length-a.length).map(escape).join('|'),'g');
 const translate=s=>words[s]||s.replace(pattern,part=>words[part]);
 let pending=false;
 const apply=()=>{pending=false;const walker=document.createTreeWalker(document.getElementById('root'),NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){if(node.parentElement.closest('textarea,input,[contenteditable=true]'))continue;if(/[\u3400-\u9fff]/.test(node.data)){const text=translate(node.data);if(text!==node.data)node.data=text;}}
  for(const element of document.querySelectorAll('[placeholder],[title],[aria-label]'))for(const key of ['placeholder','title','aria-label']){const value=element.getAttribute(key);if(value&&/[\u3400-\u9fff]/.test(value)){const text=translate(value);if(text!==value)element.setAttribute(key,text);}}
 };
 new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(apply);}}).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});apply();
}
