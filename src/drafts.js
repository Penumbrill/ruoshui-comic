let database;
let scope='default';
export function setDraftScope(key){scope=key||'default';}
function open(){if(!database)database=new Promise((resolve,reject)=>{const request=indexedDB.open('moge-drafts',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return database;}
export function writeDraft(key,value){
 const record={savedAt:Date.now(),value};const name=scope+':'+key;let local=false;
 try{const json=JSON.stringify(record);if(json.length<1500000){localStorage.setItem('moge:'+name,json);local=true;}}catch{}
 const pending=open().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(record,name);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));
 return pending.catch(error=>{if(!local)throw error;});
}
export async function readDraft(key){
 const name=scope+':'+key;let local;
 try{local=JSON.parse(localStorage.getItem('moge:'+name)||'null');}catch{}
 let stored;try{const db=await open();stored=await new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').get(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}catch{}
 return !stored||local?.savedAt>stored.savedAt?local:stored;
}
export async function clearDraft(key){
 const name=scope+':'+key;try{localStorage.removeItem('moge:'+name);}catch{}
 try{const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(name);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}
}
