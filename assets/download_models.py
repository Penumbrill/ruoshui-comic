"""Pinned first-party model downloads with resumable writes and SHA256 verification."""
import hashlib,json,pathlib,sys,time,urllib.request,urllib.error,concurrent.futures,os
context={}

def open_remote(request,timeout):
 proxies=urllib.request.getproxies()
 mode=os.environ.get('RUOSHUI_PROXY_MODE','auto')
 if mode=='direct':proxies={}
 elif mode=='auto' and sys.platform=='win32' and os.environ.get('RUOSHUI_PROXY_ENV')!='1':
  try:
   import winreg
   with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
    enabled=winreg.QueryValueEx(key,'ProxyEnable')[0]
    if enabled:
     raw=winreg.QueryValueEx(key,'ProxyServer')[0]
     if '=' in raw:proxies={k:('http://'+v if '://' not in v else v) for k,v in (x.split('=',1) for x in raw.split(';') if '=' in x)}
     else:proxies={'http':raw if '://' in raw else 'http://'+raw,'https':raw if '://' in raw else 'http://'+raw}
    else:proxies={}
  except OSError:pass
 try:return urllib.request.build_opener(urllib.request.ProxyHandler(proxies)).open(request,timeout=timeout)
 except (urllib.error.URLError,TimeoutError) as error:
  if mode!='auto' or not proxies or isinstance(error,urllib.error.HTTPError) and error.code not in (502,503,504):raise
  return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=timeout)
def emit(**kw):
 if kw.get('type')=='download' and context:
  current=context.get('currentSize',0);progress=kw.get('bytes',current*kw.get('percent',0)/100)
  kw.update(fileIndex=context.get('fileIndex',1),fileCount=context.get('fileCount',1),overallPercent=round(min(100,(context.get('doneBytes',0)+min(progress,current))/max(1,context.get('totalBytes',1))*100),1))
 print(json.dumps(kw,ensure_ascii=False),flush=True)
def source_candidates(item,mode):
 urls=[item['url']]
 if 'https://huggingface.co/' in item['url']:urls.append(item['url'].replace('https://huggingface.co/','https://hf-mirror.com/'))
 if mode=='official':return urls
 if mode=='mirror':return urls[::-1]
 def probe(url):
  start=time.monotonic()
  try:
   with open_remote(urllib.request.Request(url,headers={'Range':'bytes=0-32767','User-Agent':'Ruoshui-Comic/0.1'}),timeout=8) as r:
    if r.headers.get('Content-Type','').startswith('text/html'):return (999,url)
    r.read(32768)
   return (time.monotonic()-start,url)
  except Exception:return (999,url)
 with concurrent.futures.ThreadPoolExecutor(max_workers=len(urls)) as executor:ranked=sorted(executor.map(probe,urls))
 emit(type='download',name=pathlib.Path(item['target']).name,percent=0,message='下载源测速完成：'+('国内镜像' if 'hf-mirror.com' in ranked[0][1] else '官方源'),source=ranked[0][1].split('/')[2])
 return [url for _,url in ranked]
def download_once(item,root,url):
 dst=root/item['target'];dst.parent.mkdir(parents=True,exist_ok=True)
 expected=item.get('sha256');size=item.get('size',0)
 part=dst.with_name(dst.name+'.part');offset=part.stat().st_size if part.exists() else 0
 if size and offset==size:
  if expected and digest(part)==expected:
   part.replace(dst);dst.with_name(dst.name+'.verified.json').write_text(json.dumps({'sha256':expected,'size':dst.stat().st_size,'mtime_ns':dst.stat().st_mtime_ns}),encoding='utf-8');emit(type='download',name=dst.name,percent=100,message='已恢复完整文件并通过 SHA256 校验');return
  part.replace(part.with_name(part.name+'.invalid-'+str(int(time.time()))));offset=0
 req=urllib.request.Request(url,headers={'User-Agent':'Ruoshui-Comic/0.1','Range':f'bytes={offset}-'} if offset else {'User-Agent':'Ruoshui-Comic/0.1'})
 with open_remote(req,timeout=30) as response:
  if response.headers.get('Content-Type','').startswith('text/html'):raise RuntimeError('下载源返回了网页，已拒绝写入模型')
  if response.status!=206:offset=0
  if response.status==206 and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise RuntimeError('下载源的断点位置不正确')
  total=size or int(response.headers.get('Content-Length',0))+offset
  last=0;started=time.monotonic();initial=offset
  with part.open('ab' if offset else 'wb') as out:
   while chunk:=response.read(64*1024):
    out.write(chunk);offset+=len(chunk)
    if time.monotonic()-last>2:
     speed=(offset-initial)/max(.01,time.monotonic()-started);emit(type='download',phase='downloading',name=dst.name,percent=round(offset/total*100,1) if total else 0,bytes=offset,total=total,speed=round(speed),eta=round((total-offset)/speed) if speed>0 else None);last=time.monotonic()
 if size and part.stat().st_size!=size:raise RuntimeError('下载长度不完整，可以再次点击继续下载')
 emit(type='download',phase='verifying',name=dst.name,percent=100,bytes=offset,total=total,speed=0,eta=0,message='下载完成，正在校验 SHA256…')
 if expected and digest(part)!=expected:
  part.replace(part.with_name(part.name+'.invalid-'+str(int(time.time()))));raise RuntimeError('SHA256 校验失败，已保留坏文件并准备重新下载')
 part.replace(dst);emit(type='download',phase='verified',name=dst.name,percent=100,bytes=total,total=total,speed=0,eta=0,message='SHA256 校验通过')
 receipt=dst.with_name(dst.name+'.verified.json');receipt.write_text(json.dumps({'sha256':expected,'size':dst.stat().st_size,'mtime_ns':dst.stat().st_mtime_ns,'source':url,'revision':item.get('revision')}),encoding='utf-8')
def download(item,root,mode='auto'):
 dst=root/item['target'];size=item.get('size',0);expected=item.get('sha256');receipt=dst.with_name(dst.name+'.verified.json')
 if dst.exists() and size and dst.stat().st_size==size:
  try:
   cache=json.loads(receipt.read_text());valid=cache['sha256']==expected and cache['mtime_ns']==dst.stat().st_mtime_ns
  except Exception:valid=False
  if valid or expected and digest(dst)==expected:
   receipt.write_text(json.dumps({'sha256':expected,'size':size,'mtime_ns':dst.stat().st_mtime_ns}),encoding='utf-8');emit(type='download',name=dst.name,percent=100,message='文件已通过完整性检查');return
 if dst.exists():dst.replace(dst.with_name(dst.name+'.invalid-'+str(int(time.time()))))
 urls=source_candidates(item,mode);error=None
 for attempt in range(6):
  try:download_once(item,root,urls[attempt%len(urls)]);return
  except Exception as e:
   error=e;emit(type='download',name=dst.name,percent=0,message=f'下载源中断，切换 / 断点重试 ({attempt+1}/6)：{e}');time.sleep(min(2+attempt,8))
 raise error
def check(items,root,full=False):
 result=[]
 for item in items:
  dst=root/item['target'];state='missing';detail='文件缺失'
  if dst.exists():
   if dst.stat().st_size!=item.get('size'):state='invalid';detail='文件大小不匹配'
   else:
    valid=False
    if not full:
     try:
      cache=json.loads(dst.with_name(dst.name+'.verified.json').read_text());valid=cache['sha256']==item.get('sha256') and cache['mtime_ns']==dst.stat().st_mtime_ns
     except Exception:pass
    if not valid and full:valid=digest(dst)==item.get('sha256')
    state='verified' if valid else 'invalid' if full else 'unchecked';detail='SHA256 已校验' if valid else 'SHA256 不匹配' if full else '大小正确，等待哈希校验'
    if valid:dst.with_name(dst.name+'.verified.json').write_text(json.dumps({'sha256':item.get('sha256'),'size':item.get('size'),'mtime_ns':dst.stat().st_mtime_ns}),encoding='utf-8')
  result.append({'target':item['target'],'size':item.get('size'),'sha256':item.get('sha256'),'state':state,'detail':detail})
 return result
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(8*1024*1024):h.update(b)
 return h.hexdigest()
if __name__=='__main__':
 try:
  manifest=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'));root=pathlib.Path(sys.argv[2]);profile=sys.argv[3];mode=sys.argv[4] if len(sys.argv)>4 else 'auto'
  items=manifest['downloads'][profile] if profile!='all' else list({i['target']:i for entries in manifest['downloads'].values() for i in entries}.values())
  if mode.startswith('check'):
   emit(type='integrity',items=check(items,root,mode=='check-full'));sys.exit(0)
  context.update(fileCount=len(items),totalBytes=sum(i.get('size',0) for i in items),doneBytes=0)
  for index,item in enumerate(items):
   context.update(fileIndex=index+1,currentSize=item.get('size',0));download(item,root,mode);context['doneBytes']+=item.get('size',0)
  emit(type='done',profile=profile)
 except Exception as e:emit(type='error',message=str(e));sys.exit(1)
