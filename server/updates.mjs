import {installedBuild,assetBuild,newerBuild} from './build-info.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {githubRelease,resolveAssetSize} from './github-release.mjs';import {ResumableTransfer} from './transfers.mjs';import {readJson,atomicJson} from './service.mjs';
export const updateRepository='Penumbrill/ruoshui-comic';
export function versionNewer(next,current){const parse=v=>String(v).replace(/^v/,'').match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/);const a=parse(next),b=parse(current);if(!a||!b)return false;for(let i=1;i<4;i++)if(+a[i]!==+b[i])return+a[i]>+b[i];return!a[4]&&!!b[4];}
export function allowedProgramPath(name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.includes('\0')||name.split('/').some(p=>!p||p==='.'||p==='..'))return false;
 if(/^(works|models|\.git|\.codex|\.agents)(\/|$)/i.test(name)||/\.(safetensors|ckpt|gguf|onnx|pt)$/i.test(name))return false;
 if(name.startsWith('runtime/'))return /^runtime\/(python|llama-official|ComfyUI)\//.test(name)&&!/^runtime\/ComfyUI\/(models|input|output|temp|user)(\/|$)/i.test(name)&&!/(^|\/)(cache|downloads|user_data|user_data_old|lora_userdatas|translate_userdatas|random_tag|\.git|__pycache__)(\/|$)/i.test(name)&&!/(^|\/)(extra_model_paths\.ya?ml|init\.json|user_cloud_package\.json|tag_labels\.json)$/i.test(name);
 return name==='version'||/^(resources|locales)\//.test(name)||(!name.includes('/')&&/\.(exe|dll|pak|dat|bin|json|txt|md|html)$/i.test(name));
}
export function validateUpdateFiles(manifest){
 if(manifest?.appId!=='com.guangyingruoshui.comic'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>100000)throw Error('更新清单无效');
 const names=new Set();for(const file of manifest.files){if(!allowedProgramPath(file.path)||names.has(file.path.toLowerCase())||!/^[a-f0-9]{64}$/i.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)throw Error('更新清单含受保护、重复或无效的文件路径');names.add(file.path.toLowerCase());}
 if(!names.has('resources/app.asar'))throw Error('更新缺少应用程序');return manifest;
}
export class UpdateManager{
 constructor(service,{fetchRelease=githubRelease}={}){this.service=service;this.fetchRelease=fetchRelease;this.state={state:'idle',currentVersion:'',message:'尚未检查更新',files:[]};}
 async init(){this.current=JSON.parse(await fs.readFile(path.join(this.service.bundle,'package.json'),'utf8')).version;this.build=await installedBuild(this.service.root,this.current);this.folder=path.join(this.service.data,'updates');await fs.mkdir(this.folder,{recursive:true});this.state={...this.state,...await readJson(path.join(this.folder,'state.json'),{}),currentVersion:this.current,currentBuild:this.build?.commit.slice(0,7)||''};
  if(this.state.release&&!this.availableRelease(this.state.release))await this.emit({state:'current',available:false,checking:false,percent:100,speed:0,staging:null,files:[],message:'当前已是最新正式版本'});
  else if(['downloading','verifying'].includes(this.state.state))this.state.state='paused';return this;}
 availableRelease(release){return versionNewer(release.version,this.current)||(String(release.version).replace(/^v/,'')===this.current&&newerBuild(this.build,release.build,release.assetUpdatedAt));}
 async emit(patch){Object.assign(this.state,patch);this.service.emit('updates',this.state);await atomicJson(path.join(this.folder,'state.json'),this.state);return this.state;}
 async check(){if(this.checking)return this.checking;this.checking=this._check().finally(()=>this.checking=null);return this.checking;}
 async _check(){
  if(this.downloading)return this.state;
  await this.emit({checking:true,message:'正在检查官方更新…'});
  try{const release=await this.fetchRelease(updateRepository);if(!release)return await this.emit({state:'current',checking:false,available:false,checkedAt:new Date().toISOString(),message:'尚未发布首个正式版本',release:null,files:[]});
   const asset=release.assets?.find(a=>/^ruoshui-comic(?:\.|-)update-win-x64\.zip$/i.test(a.name)),build=assetBuild(asset),releaseInfo={version:release.tag_name,title:release.name||release.tag_name,notes:release.body||'此版本未填写更新公告。',url:release.html_url,build,assetUpdatedAt:asset?.updated_at},available=this.availableRelease(releaseInfo);
   const files=asset&&/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')?[{name:asset.name,size:asset.size||0,sha256:asset.digest.slice(7),url:asset.browser_download_url,state:'waiting',bytes:0}]:[];
   return await this.emit({state:available?'available':'current',checking:false,checkedAt:new Date().toISOString(),available,release:releaseInfo,files,message:available?(files.length?(versionNewer(release.tag_name,this.current)?'发现新版本，可下载更新':'发现同版本的新构建，可下载更新'):'新版本已发布，自动更新文件尚未就绪'):'当前已是最新正式版本'});
  }catch(error){await this.emit({checking:false,message:'检查更新未完成：'+error.message});throw error;}
 }
 async download(){if(this.downloading)return this.state;if(!this.state.available||!this.state.files.length)throw Error('没有可下载的更新');const file=this.state.files[0];if(!file.url.startsWith('https://github.com/'+updateRepository+'/releases/download/'))throw Error('更新下载源无效');
  this.downloading=true;file.state='running';void this._download(file).catch(error=>{file.state=this.transfer?.state==='cancelled'?'cancelled':'error';return this.emit({state:file.state,message:error.message,speed:0});}).finally(()=>this.downloading=false);return this.state;
 }
 async _download(file){
  const asset=await resolveAssetSize({browser_download_url:file.url,size:file.size});file.size=asset.size;await this.emit({state:'downloading',message:'下载更新文件…'});
  let last=0;this.transfer=new ResumableTransfer({onProgress:p=>{Object.assign(file,{bytes:p.bytes,state:p.state});if(Date.now()-last>300||p.state==='done'){last=Date.now();void this.emit({state:p.state==='done'?'verifying':p.state==='paused'?'paused':p.state==='cancelled'?'cancelled':'downloading',percent:p.percent,speed:p.speed,message:p.state==='done'?'校验完成，正在检查程序文件…':p.state==='paused'?'已暂停，继续时断点续传':p.state==='cancelled'?'已取消更新下载':p.state==='retrying'?'连接中断，保留进度并自动重试…':'正在下载更新…'});}}});
  const archive=await this.transfer.download({url:file.url,file:path.join(this.folder,file.name),size:file.size,sha256:file.sha256});
  const staging=path.join(this.folder,'staging');await this.helper('prepare',{root:this.service.root,archive,staging});
  const manifest=validateUpdateFiles(await readJson(path.join(staging,'ruoshui-update.json'),{}));this.manifest=manifest;
  if(manifest.version!==String(this.state.release.version).replace(/^v/,''))throw Error('更新文件版本与发布版本不一致');
  if(this.state.release.build&&!manifest.build?.commit?.startsWith(this.state.release.build))throw Error('更新文件构建与发布构建不一致');
  await this.emit({state:'ready',percent:100,staging,message:'更新已准备好，重启后安装；模型与创作文件保留'});
 }
 async control(action){if(!['pause','cancel','retry','resume'].includes(action))throw Error('未知更新下载操作');if(action==='retry'){if(this.downloading)throw Error('请等待当前下载结束后重试');return this.download();}if(action==='resume'&&!this.downloading)return this.download();if(!this.transfer)throw Error('没有正在下载的更新');this.transfer.control(action);if(this.state.files[0])this.state.files[0].state=action==='pause'?'paused':action==='cancel'?'cancelled':'running';return this.emit({state:action==='pause'?'paused':action==='cancel'?'cancelled':'downloading',speed:0,message:action==='pause'?'已暂停，继续时断点续传':action==='cancel'?'已取消更新下载':'正在继续下载…'});}
 async helper(mode,plan){const filename=path.join(this.folder,'plan-'+mode+'.json');await atomicJson(filename,{...plan,appId:'com.guangyingruoshui.comic'});const script=path.join(this.service.bundle.replace('app.asar','app.asar.unpacked'),'assets/maintain-installation.ps1');return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode',mode,'-Plan',filename],{windowsHide:true});let error='';child.stderr.on('data',b=>error+=b);child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(error.slice(-1000)||'更新文件检查失败')));});}
 close(){this.transfer?.control('cancel');}
}
