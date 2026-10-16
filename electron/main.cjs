const {app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session} = require('electron');
const path = require('node:path');
app.setName('若水漫画');
if(process.platform==='win32')app.setAppUserModelId('com.guangyingruoshui.comic');
let server, win, root, quitting=false;
root = process.env.MANHUA_HOME || (app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname,'..'));
const {runtimePath,manageUserPath}=require('./user-path.cjs');
if(process.platform==='win32')runtimePath(root);
const desktopState=path.join(root,'works/autosave/desktop');require('node:fs').mkdirSync(desktopState,{recursive:true});app.setPath('userData',desktopState);app.setPath('sessionData',desktopState);
const folderKinds = ['models','diffusion_models','text_encoders','vae','loras','controlnet','upscale_models','detectors','output','projects','runtime','llm','assistant'];
app.whenReady().then(async () => {
  root = process.env.MANHUA_HOME || (app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname,'..'));
  process.env.MANHUA_HOME = root;
  const pathScript=path.join(__dirname.replace('app.asar','app.asar.unpacked'),'../assets/manage-user-path.ps1');
  const pathStatus=async(action='status')=>{if(process.platform!=='win32'||!app.isPackaged)return{available:false,message:'源码预览不修改用户 PATH',runtimeEntries:runtimePath(root)};return manageUserPath({root,script:pathScript,action});};
  ipcMain.handle('manage-user-path',(_event,action)=>{if(!['status','repair'].includes(action))throw Error('未知 PATH 操作');return pathStatus(action);});
  if(app.isPackaged&&process.platform==='win32')try{await pathStatus('repair');}catch(error){console.warn('PATH 自动配置未完成：'+error.message);}
  if(app.isPackaged)await require('node:fs/promises').writeFile(path.join(root,'ruoshui-installation.json'),JSON.stringify({appId:'com.guangyingruoshui.comic',version:app.getVersion()}));
  if(app.isPackaged&&process.platform==='win32')require('node:child_process').execFile('reg.exe',['add','HKCU\\Software\\RuoshuiComic','/v','InstallLocation','/t','REG_SZ','/d',root,'/f'],{windowsHide:true},()=>{});
  const backend = await import('../server/index.mjs');
  const {comicFolderName,comicExportPath}=await import('../server/comic-exports.mjs');
  const {resolveManagedFile}=await import('../server/portable-paths.mjs');
  const {importLlmFolder}=await import('../server/llm-models.mjs');
  await session.defaultSession.setProxy({mode:'direct'});
  const remoteSessions=new Map();
  async function nativeFetch(url,options,proxy){const key=proxy||'direct';let remote=remoteSessions.get(key);if(!remote){remote=session.fromPartition('remote-'+require('node:crypto').createHash('sha256').update(key).digest('hex').slice(0,16),{cache:true});await remote.setProxy(proxy?{mode:'fixed_servers',proxyRules:proxy,proxyBypassRules:'<local>;localhost;127.0.0.1;[::1]'}:{mode:'direct'});remoteSessions.set(key,remote);}return remote.fetch(url,options);}
  const proxySession=session.fromPartition('network-auto-detection',{cache:false});await proxySession.setProxy({mode:'system'});let proxyCheckedAt=0;
  server = await backend.startServer({port:Number(process.env.PORT)||0,nativeFetch,resolveProxy:async url=>{if(Date.now()-proxyCheckedAt>10000){await proxySession.forceReloadProxyConfig();proxyCheckedAt=Date.now();}return proxySession.resolveProxy(url);},vault:{encrypt:text=>{if(!safeStorage.isEncryptionAvailable())throw Error('系统加密服务不可用，暂时不能保存 Key');return safeStorage.encryptString(text);},decrypt:buffer=>safeStorage.decryptString(buffer)}});
  if(process.argv.includes('--verify-installation')){
    const fs=require('node:fs/promises');
    const modelFiles=await server.service.models(),environment=await server.service.environment();
    const html=await (await fetch(server.url)).text();
    const report={checkedAt:new Date().toISOString(),packaged:app.isPackaged,root,titleFound:html.includes('若水漫画'),models:modelFiles,environment};
    report.ok=report.titleFound&&modelFiles.diffusion_models.length>=2&&environment.torch.available;
    await fs.writeFile(path.join(root,'works/logs/installation-check.json'),JSON.stringify(report,null,2));
    server.service.shutdown();server.close();app.exit(report.ok?0:1);return;
  }

  ipcMain.handle('pick-image', async () => {
    const result = await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});
    return result.canceled ? [] : await Promise.all(result.filePaths.map(p=>server.service.importImageFile(p)));
  });
  ipcMain.handle('pick-model', async (_, kind) => {
    if (!folderKinds.includes(kind)) throw Error('未知模型目录');
    const result = await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'本地模型',extensions:['safetensors','ckpt','pt','pth','gguf']}]});
    return result.canceled ? [] : await server.service.importModels(result.filePaths,kind);
  });
  ipcMain.handle('pick-llm-folder',async()=>{const result=await dialog.showOpenDialog(win,{properties:['openDirectory'],title:'导入 GGUF 模型到本软件（复制文件）'});if(result.canceled)return null;return importLlmFolder(server.service,result.filePaths[0]);});
  ipcMain.handle('open-llm-folder',async()=>{const folder=path.dirname(server.service.config.llm.model||path.join(server.service.folder('llm'),'model.gguf'));return shell.openPath(folder);});
  ipcMain.handle('open-project-folder', async (_, id) => {if(!/^[0-9a-f-]{36}$/.test(id))throw Error('无效项目');await server.service.readProject(id);shell.showItemInFolder(path.join(root,'works/projects',id+'.json'));return true;});
  ipcMain.handle('open-folder', async (_, kind, projectName) => {
    if(kind==='comic-exports'){
      const fs=require('node:fs/promises'),last=server.service.config.comicExportFolders?.[encodeURIComponent(projectName||'')];
      const folder=last&&require('node:fs').existsSync(last)?last:comicExportPath(path.join(root,'works/exports'),projectName,'').folder;
      await fs.mkdir(folder,{recursive:true});const error=await shell.openPath(folder);if(error)throw Error(error);return true;
    }
    if (!folderKinds.includes(kind)) throw Error('未知目录');
    return shell.openPath(server.service.folder(kind));
  });
  ipcMain.handle('reveal-managed-file',async(_,kind,name)=>{shell.showItemInFolder(await resolveManagedFile(server.service,kind,name));return true;});
  ipcMain.handle('maintain-installation',async(_,options)=>{
    if(!app.isPackaged)throw Error('当前是源码开发客户端；安装替换与卸载仅在正式整合包中执行。');
    if(!['apply','uninstall'].includes(options?.mode))throw Error('未知维护操作');
    if(server.service.jobs.some(j=>['running','queued','cancelling'].includes(j.status))||server.service.assistant.busy)throw Error('请先完成或停止当前创作任务');
    if(options.mode==='apply'&&server.service.updates.state.state!=='ready')throw Error('请先下载并校验更新');
    await win.webContents.executeJavaScript('window.__mogeFlush ? window.__mogeFlush() : Promise.resolve()');
    const fs=require('node:fs/promises'),folder=path.join(root,'works/updates');await fs.mkdir(folder,{recursive:true});
    const planFile=path.join(folder,'maintenance.json'),helper=path.join(folder,'maintain-installation.ps1');
    await fs.writeFile(planFile,JSON.stringify({appId:'com.guangyingruoshui.comic',root,pid:process.pid,keepModels:options.keepModels!==false,keepWorks:options.keepWorks!==false}));
    await fs.copyFile(path.join(__dirname,'../assets/maintain-installation.ps1').replace('app.asar','app.asar.unpacked'),helper);
    if(options.mode==='uninstall'&&process.platform==='win32')await manageUserPath({root,script:pathScript,action:'remove'});
    const child=require('node:child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',options.mode,'-Plan',planFile],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();app.quit();return true;
  });
  ipcMain.handle('open-link', (_, kind) => {
    const links = server.service.links;
    if (links[kind]) return shell.openExternal(links[kind]);
  });
  ipcMain.handle('save-export', async (_, payload) => {
    const name=path.basename(String(payload.name||'漫画.png'));
    const fs=require('node:fs/promises'),comic=payload.kind==='comic',defaultPath=comic?comicExportPath(path.join(root,'works/exports'),payload.projectName,name).path:path.join(root,'works/exports',name);
    await fs.mkdir(path.dirname(defaultPath),{recursive:true});
    const result=await dialog.showSaveDialog(win,{defaultPath,filters:[{name:'文件',extensions:[['json','txt','sql','png'].includes(path.extname(name).slice(1))?path.extname(name).slice(1):'png']}]});
    if(result.canceled) return false;
    let file=result.filePath;
    if(comic){const parent=path.dirname(file),base=path.basename(parent)===comicFolderName(payload.projectName)?path.dirname(parent):parent;file=comicExportPath(base,payload.projectName,path.basename(file)).path;}
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.from(payload.base64,'base64'));
    if(comic)await server.service.saveConfig({lastComicExportFolder:path.dirname(file),comicExportFolders:{[encodeURIComponent(payload.projectName||'')]:path.dirname(file)}});
    return {path:file};
  });
  ipcMain.handle('window-action', (_, action) => {
    if(action==='close') win.close();
    if(action==='minimize') win.minimize();
    if(action==='maximize') win.isMaximized()?win.unmaximize():win.maximize();
  });
  win = new BrowserWindow({width:1440,height:980,minWidth:1050,minHeight:720,backgroundColor:'#171b25',icon:path.join(__dirname,'../assets/app-icon.ico'),title:'若水漫画 · 本地 AI 漫画创作',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(server.url+'/')) event.preventDefault();});
  await win.loadURL(server.url);
  win.on('close',event=>{if(!quitting){event.preventDefault();app.quit();}});
}).catch(error=>{dialog.showErrorBox('若水漫画启动失败',error.message);quitting=true;app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(quitting)return;event.preventDefault();
 Promise.resolve(win&&!win.isDestroyed()?win.webContents.executeJavaScript('window.__mogeFlush ? window.__mogeFlush() : Promise.resolve()'):undefined)
 .catch(()=>{}).finally(async()=>{await server?.service.writeChain.catch(()=>{});quitting=true;server?.service.shutdown();server?.close();app.quit();});
});
