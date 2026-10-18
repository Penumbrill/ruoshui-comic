// Translate bundled interface labels only; leave prompts and post content intact.
const language=new URLSearchParams(location.search).get('lang')==='en'?'en':'zh';
document.documentElement.lang=language;
if(language==='en'){
 const response=await fetch('./locale-en.json');
 const labels=await response.json(),root=document.body;
 const translate=text=>{const trimmed=text.trim();if(Object.hasOwn(labels,trimmed))return text.replace(trimmed,labels[trimmed]);return text.replace(/^第(\d+)页·(\d+)条$/,'Page $1 · $2 results').replace(/^✅ 新增 (\d+) 条，共 (\d+) 条$/,'✅ Added $1 · $2 total').replace(/^✅ (\d+) 词条 · (\d+) 标签$/,'✅ $1 entries · $2 tags');};
 for(const method of ['alert','confirm','prompt']){const original=window[method].bind(window);window[method]=(message,...args)=>original(translate(String(message)),...args);}
 function update(node){
  if(node.nodeType===Node.TEXT_NODE){const parent=node.parentElement;if(!parent?.closest('textarea,[contenteditable=true],script,style')&&(!parent?.closest('.db-post-grid')||parent.parentElement?.matches('.db-post-grid')&&!parent.querySelector('img'))){const next=translate(node.data);if(next!==node.data)node.data=next;}return;}
  if(node.nodeType!==Node.ELEMENT_NODE)return;
  for(const attr of ['placeholder','title','aria-label','alt'])if(node.hasAttribute(attr)){const old=node.getAttribute(attr);if(attr==='title'&&old.startsWith('作者')||attr==='alt'&&node.closest('.db-post-grid'))continue;const next=translate(old);if(next!==old)node.setAttribute(attr,next);}
  for(const child of node.childNodes)update(child);
 }
 const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData'||record.type==='attributes')update(record.target);else for(const added of record.addedNodes)update(added);}});
 observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label','alt']});update(root);
}
