const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop', {
  managePath:action=>ipcRenderer.invoke('manage-user-path',action),
  pickLlmFolder:()=>ipcRenderer.invoke('pick-llm-folder'),openLlmFolder:()=>ipcRenderer.invoke('open-llm-folder'),
  pickImages:()=>ipcRenderer.invoke('pick-image'),
  pickModels:kind=>ipcRenderer.invoke('pick-model',kind),
  openProjectFolder:id=>ipcRenderer.invoke('open-project-folder',id),
  openFolder:(kind,projectName)=>ipcRenderer.invoke('open-folder',kind,projectName),
  revealManagedFile:(kind,name)=>ipcRenderer.invoke('reveal-managed-file',kind,name),
  maintainInstallation:options=>ipcRenderer.invoke('maintain-installation',options),
  openLink:kind=>ipcRenderer.invoke('open-link',kind),
  saveExport:payload=>ipcRenderer.invoke('save-export',payload),
  windowAction:action=>ipcRenderer.invoke('window-action',action)
});
