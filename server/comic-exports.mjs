import path from 'node:path';

export function comicFolderName(name){
 let value=String(name||'').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,100).replace(/[. ]+$/g,'');
 if(!value||value==='.'||value==='..')value='未命名漫画';
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))value='漫画_'+value;
 return value;
}

export function comicExportPath(baseFolder,projectName,fileName){
 const folder=path.join(baseFolder,comicFolderName(projectName));
 return {folder,path:path.join(folder,path.basename(fileName))};
}
