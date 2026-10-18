"""Pinned first-party model downloads with resumable writes and SHA256 verification."""
import hashlib,json,pathlib,sys,time,urllib.request,urllib.error,urllib.parse,concurrent.futures,os,threading,socket,re
from collections import deque
context={}
PARALLEL_MIN_SIZE=32*1024**2
BLOCK_SIZE=8*1024**2
MAX_CONNECTIONS=8
READ_TIMEOUT=45
WINDOW_BLOCKS=8
SEGMENT_RETRIES=6
source_cache={}
source_cooldown={}
connection_limits={}
proxy_cooldown={}
domestic_cache={}
emit_lock=threading.Lock()
for stream in (sys.stdout,sys.stderr):
 if hasattr(stream,'reconfigure'):stream.reconfigure(encoding='utf-8',errors='backslashreplace')

def configured_proxies():
 proxies=urllib.request.getproxies_environment() if os.environ.get('RUOSHUI_PROXY_ENV')=='1' else urllib.request.getproxies()
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
 return {key:value for key,value in proxies.items() if key in ('http','https') and value}

def open_remote(request,timeout):
 proxies=configured_proxies();mode=os.environ.get('RUOSHUI_PROXY_MODE','auto')
 key=(tuple(sorted(proxies.items())),urllib.parse.urlsplit(request.full_url).netloc)
 if mode=='auto' and proxy_cooldown.get(key,0)>time.monotonic():proxies={}
 try:
  response=urllib.request.build_opener(urllib.request.ProxyHandler(proxies)).open(request,timeout=timeout)
  response.download_route='proxy' if proxies.get(urllib.parse.urlsplit(request.full_url).scheme) else 'direct';response.proxy_key=key
  return response
 except (urllib.error.URLError,TimeoutError) as error:
  if mode!='auto' or not proxies or isinstance(error,urllib.error.HTTPError) and error.code not in (502,503,504):raise
  proxy_cooldown[key]=time.monotonic()+30
  response=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=timeout)
  response.download_route='direct';return response

def failed_response(response):
 # A slow CDN body is not evidence that the local HTTP proxy has stopped.
 # Only connection failures in open_remote put that origin on cooldown.
 pass
def emit(**kw):
 if kw.get('type')=='download' and context:
  current=context.get('currentSize',0);progress=kw.get('bytes',current*kw.get('percent',0)/100)
  kw.update(fileIndex=context.get('fileIndex',1),fileCount=context.get('fileCount',1),overallPercent=round(min(100,(context.get('doneBytes',0)+min(progress,current))/max(1,context.get('totalBytes',1))*100),1))
 with emit_lock:print(json.dumps(kw,ensure_ascii=True),flush=True)
def domestic_sources(item):
 parsed=urllib.parse.urlsplit(item['url']);parts=parsed.path.strip('/').split('/')
 if parsed.netloc!='huggingface.co' or len(parts)<5 or parts[2]!='resolve' or not re.fullmatch(r'[a-f0-9]{64}',item.get('sha256','')):return []
 repo='/'.join(parts[:2]);filename=urllib.parse.unquote('/'.join(parts[4:]))
 if repo not in domestic_cache:
  try:
   request=urllib.request.Request('https://modelscope.cn/api/v1/models/'+repo+'/repo/files?Revision=master&Recursive=True',headers={'User-Agent':'Ruoshui-Comic/0.1'})
   with open_remote(request,timeout=5) as response:data=json.load(response)
   domestic_cache[repo]=data.get('Data',{}).get('Files',[]) if data.get('Code')==200 else []
  except Exception:domestic_cache[repo]=[]
 for file in domestic_cache[repo]:
  if file.get('Path')==filename and file.get('Size')==item.get('size') and file.get('Sha256','').lower()==item['sha256'].lower() and re.fullmatch(r'[a-f0-9]{40,64}',file.get('Revision','')):
   return ['https://modelscope.cn/api/v1/models/'+repo+'/repo?'+urllib.parse.urlencode({'Revision':file['Revision'],'FilePath':filename})]
 return []

def source_candidates(item,mode):
 urls=[item['url']]
 if 'https://huggingface.co/' in item['url']:urls.append(item['url'].replace('https://huggingface.co/','https://hf-mirror.com/'))
 if mode=='official':return urls
 proxied=bool(configured_proxies().get('https'))
 if mode=='mirror':return domestic_sources(item)+urls[::-1]
 urls+=domestic_sources(item)
 cache_key=(item.get('repo') or urllib.parse.urlsplit(item['url']).netloc,item.get('size',0)>=1024**2,proxied)
 cached=source_cache.get(cache_key)
 if cached and cached[0]>time.monotonic():return sorted(urls,key=lambda url:cached[1].index(urllib.parse.urlsplit(url).netloc) if urllib.parse.urlsplit(url).netloc in cached[1] else len(urls))
 sample=min(item.get('size') or 4*1024**2,4*1024**2)
 def probe(url):
  start=time.monotonic()
  try:
   with open_remote(urllib.request.Request(url,headers={'Range':f'bytes=0-{sample-1}','User-Agent':'Ruoshui-Comic/0.1'}),timeout=8) as r:
    if r.headers.get('Content-Type','').startswith('text/html'):return (float('inf'),url)
    received=0
    while received<sample:
     chunk=r.read1(min(64*1024,sample-received))
     if not chunk:break
     received+=len(chunk)
     if time.monotonic()-start>=8:break
   return ((time.monotonic()-start)/received if received else float('inf'),url)
  except Exception:return (float('inf'),url)
 if proxied:
  with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,len(urls)-1)) as executor:ranked=sorted(executor.map(probe,[urls[0]]+urls[2:]))
  official=next(result for result in ranked if result[1]==urls[0])
  if official[0]<=ranked[0][0]*1.2:ranked=[official]+[result for result in ranked if result!=official]
  if len(urls)>1:ranked=sorted(ranked+[probe(urls[1])]) if ranked[0][0]==float('inf') else ranked+[(float('inf'),urls[1])]
 else:
  with concurrent.futures.ThreadPoolExecutor(max_workers=len(urls)) as executor:ranked=sorted(executor.map(probe,urls))
 source_cache[cache_key]=(time.monotonic()+300,[urllib.parse.urlsplit(url).netloc for _,url in ranked])
 host=urllib.parse.urlsplit(ranked[0][1]).netloc
 emit(type='download',phase='connecting',name=pathlib.Path(item['target']).name,total=item.get('size',0),speed=0,connections=0,message='下载源测速完成：'+('国内托管源' if host=='modelscope.cn' else '国内镜像' if host=='hf-mirror.com' else '官方源'),source=host)
 return [url for _,url in ranked]

def partial_state(part,item):
 meta=part.with_name(part.name+'.ranges.json')
 if not meta.exists():return None
 try:
  data=json.loads(meta.read_text(encoding='utf-8'));size=item['size'];prefix=data['prefix'];block=data['blockSize'];done=data['done'];count=(size-prefix+block-1)//block
  if data['size']!=size or data['sha256']!=item.get('sha256') or not isinstance(prefix,int) or not 0<=prefix<=size or block!=BLOCK_SIZE or not isinstance(done,list) or len(set(done))!=len(done) or any(not isinstance(i,int) or not 0<=i<count for i in done):raise ValueError('invalid ranges')
  length=part.stat().st_size
  if length>size or length<max([prefix]+[min(size,prefix+(i+1)*block) for i in done]):raise ValueError('incomplete ranges')
  return data
 except Exception:
  suffix='.invalid-'+str(time.time_ns())
  if part.exists():part.replace(part.with_name(part.name+suffix))
  meta.replace(meta.with_name(meta.name+suffix));return None

def committed_bytes(data):return data['prefix']+sum(min(data['blockSize'],data['size']-data['prefix']-i*data['blockSize']) for i in data['done'])

def partial_bytes(part,item):
 data=partial_state(part,item)
 return committed_bytes(data) if data else min(item.get('size') or 2**63,part.stat().st_size if part.exists() else 0)

def save_ranges(file,data):
 temporary=file.with_name(file.name+'.tmp')
 with temporary.open('w',encoding='utf-8') as out:json.dump(data,out);out.flush();os.fsync(out.fileno())
 temporary.replace(file)

def collapse_ranges(part,item):
 data=partial_state(part,item)
 if not data:return
 contiguous=data['prefix'];done=set(data['done']);index=0
 while index in done:contiguous=min(data['size'],contiguous+data['blockSize']);index+=1
 with part.open('r+b') as out:out.truncate(contiguous);out.flush();os.fsync(out.fileno())
 part.with_name(part.name+'.ranges.json').unlink()

class TransferProtocolError(RuntimeError):pass

def validate_range(response,start,end,size):
 match=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',response.headers.get('Content-Range',''))
 if response.status!=206 or not match or tuple(map(int,match.groups()))!=(start,end,size):raise TransferProtocolError('下载源的断点位置不正确')
 if response.headers.get('Content-Type','').startswith('text/html'):raise TransferProtocolError('下载源返回了网页，已拒绝写入模型')

def download_parallel(item,part,url):
 size=item['size'];data=partial_state(part,item)
 if not data:data={'size':size,'sha256':item.get('sha256'),'prefix':part.stat().st_size if part.exists() else 0,'blockSize':BLOCK_SIZE,'done':[]}
 prefix=data['prefix'];done=set(data['done']);count=(size-prefix+BLOCK_SIZE-1)//BLOCK_SIZE;waiting=deque(i for i in range(count) if i not in done)
 if not waiting:return True
 limit=min(MAX_CONNECTIONS,connection_limits.get(urllib.parse.urlsplit(url).netloc,MAX_CONNECTIONS),count)
 window_blocks=min(WINDOW_BLOCKS,max(1,len(waiting)//limit))
 def take_window():
  if not waiting:return []
  group=[waiting.popleft()]
  while waiting and len(group)<window_blocks and waiting[0]==group[-1]+1:group.append(waiting.popleft())
  return group
 first_group=take_window();start=prefix+first_group[0]*BLOCK_SIZE;end=min(size,prefix+(first_group[-1]+1)*BLOCK_SIZE)-1
 first=open_remote(urllib.request.Request(url,headers={'User-Agent':'Ruoshui-Comic/0.1','Range':f'bytes={start}-{end}'}),timeout=READ_TIMEOUT)
 if first.status!=206:first.close();collapse_ranges(part,item);return False
 try:validate_range(first,start,end,size)
 except Exception:first.close();raise
 meta=part.with_name(part.name+'.ranges.json');save_ranges(meta,data)
 if not part.exists():part.touch()
 lock=threading.Lock();stop=threading.Event();errors=[];active={};samples=deque();last=0;inflight=set();saved_bytes=committed_bytes(data)
 details={'source':urllib.parse.urlsplit(url).netloc,'downloadHost':urllib.parse.urlsplit(first.url).netloc,'route':getattr(first,'download_route','direct')}
 def progress(force=False):
  nonlocal last
  now=time.monotonic()
  if not force and now-last<1:return
  current=saved_bytes+sum(active.values());samples.append((now,current))
  while len(samples)>2 and samples[1][0]<now-5:samples.popleft()
  if force or now-last>=1:
   speed=max(0,(current-samples[0][1])/max(.01,now-samples[0][0]));emit(type='download',phase='downloading',name=part.name[:-5],percent=round(current/size*100,1),bytes=current,total=size,speed=round(speed),eta=round((size-current)/speed) if speed else None,connections=max(1,len(inflight)),**details,message='正在连续分段下载，已完成的分段会保留');last=now
 urls=list(dict.fromkeys([url]+item.get('_download_sources',[])))
 def worker(worker_id,initial_group=None,initial_response=None):
  nonlocal limit,saved_bytes
  response=initial_response;group=initial_group
  try:
   while not stop.is_set():
    with lock:
     if group is None:
      if worker_id>=limit:return
      group=take_window()
     if not group:return
    for attempt in range(SEGMENT_RETRIES):
     remaining=[index for index in group if index not in data['done']]
     if not remaining:break
     start=prefix+remaining[0]*BLOCK_SIZE;end=min(size,prefix+(remaining[-1]+1)*BLOCK_SIZE)-1
     chosen=urls[attempt%len(urls)]
     try:
      with lock:inflight.add(worker_id);progress(True)
      if response is None:response=open_remote(urllib.request.Request(chosen,headers={'User-Agent':'Ruoshui-Comic/0.1','Range':f'bytes={start}-{end}'}),timeout=READ_TIMEOUT)
      validate_range(response,start,end,size)
      with lock:details.update(source=urllib.parse.urlsplit(chosen).netloc,downloadHost=urllib.parse.urlsplit(response.url).netloc,route=getattr(response,'download_route','direct'))
      with response,part.open('r+b') as out:
       out.seek(start)
       for index in remaining:
        received=0;length=min(BLOCK_SIZE,size-prefix-index*BLOCK_SIZE)
        while received<length:
         if stop.is_set():return
         chunk=response.read1(min(256*1024,length-received))
         if not chunk:raise RuntimeError('下载长度不完整，可以再次点击继续下载')
         out.write(chunk);received+=len(chunk)
         with lock:active[index]=received;progress()
        out.flush();os.fsync(out.fileno())
        with lock:data['done'].append(index);saved_bytes+=length;active.pop(index,None);save_ranges(meta,data);progress()
      response=None;break
     except TransferProtocolError:raise
     except Exception:
      if response is not None:response.close();response=None
      if attempt+1>=SEGMENT_RETRIES:raise
      with lock:
       for index in remaining:active.pop(index,None)
       inflight.discard(worker_id);limit=max(1,limit//2);current=saved_bytes+sum(active.values())
       connection_limits[urllib.parse.urlsplit(chosen).netloc]=limit
       emit(type='download',phase='retrying',name=part.name[:-5],bytes=current,total=size,percent=round(current/size*100,1),speed=0,connections=max(1,len(inflight)),retryAttempt=attempt+1,retryDelay=min(attempt+1,5),message='分段连接中断，已保留完成的进度，正在重连；其他分段继续下载')
      time.sleep(min(attempt+1,5))
     finally:
      with lock:inflight.discard(worker_id)
    group=None
  except Exception as error:
   if response is not None:failed_response(response);response.close()
   with lock:errors.append(error);stop.set()
  finally:
   if response is not None:response.close()
 with lock:progress(True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=limit) as executor:
  futures=[executor.submit(worker,0,first_group,first)]+[executor.submit(worker,index) for index in range(1,limit)]
  for future in futures:future.result()
 if errors:raise errors[0]
 if len(data['done'])!=count:raise RuntimeError('下载长度不完整，可以再次点击继续下载')
 return True
def download_once(item,root,url):
 dst=root/item['target'];dst.parent.mkdir(parents=True,exist_ok=True)
 expected=item.get('sha256');size=item.get('size',0)
 part=dst.with_name(dst.name+'.part');ranges=partial_state(part,item);offset=committed_bytes(ranges) if ranges else part.stat().st_size if part.exists() else 0
 if size and offset>size:part.replace(part.with_name(part.name+'.invalid-'+str(time.time_ns())));offset=0
 if size and offset==size:
  if expected and digest(part)==expected:
   part.replace(dst);part.with_name(part.name+'.ranges.json').unlink(missing_ok=True);dst.with_name(dst.name+'.verified.json').write_text(json.dumps({'sha256':expected,'size':dst.stat().st_size,'mtime_ns':dst.stat().st_mtime_ns}),encoding='utf-8');emit(type='download',phase='verified',name=dst.name,percent=100,bytes=size,total=size,speed=0,message='已恢复完整文件并通过 SHA256 校验');return
  part.replace(part.with_name(part.name+'.invalid-'+str(time.time_ns())));part.with_name(part.name+'.ranges.json').unlink(missing_ok=True);ranges=None;offset=0
 parallel=bool(size>=PARALLEL_MIN_SIZE or ranges) and download_parallel(item,part,url)
 if not parallel:
  offset=part.stat().st_size if part.exists() else 0
  download_sequential(item,part,url,offset)
 offset=part.stat().st_size;total=size or offset
 if size and offset!=size:raise RuntimeError('下载长度不完整，可以再次点击继续下载')
 emit(type='download',phase='verifying',name=dst.name,percent=100,bytes=offset,total=total,speed=0,eta=0,message='下载完成，正在校验 SHA256…')
 if expected and digest(part)!=expected:
  part.replace(part.with_name(part.name+'.invalid-'+str(time.time_ns())));part.with_name(part.name+'.ranges.json').unlink(missing_ok=True);raise RuntimeError('SHA256 校验失败，已保留坏文件并准备重新下载')
 part.replace(dst);part.with_name(part.name+'.ranges.json').unlink(missing_ok=True);emit(type='download',phase='verified',name=dst.name,percent=100,bytes=total,total=total,speed=0,eta=0,message='SHA256 校验通过')
 receipt=dst.with_name(dst.name+'.verified.json');receipt.write_text(json.dumps({'sha256':expected,'size':dst.stat().st_size,'mtime_ns':dst.stat().st_mtime_ns,'source':url,'revision':item.get('revision')}),encoding='utf-8')

def download_sequential(item,part,url,offset):
 size=item.get('size',0);req=urllib.request.Request(url,headers={'User-Agent':'Ruoshui-Comic/0.1','Range':f'bytes={offset}-'} if offset else {'User-Agent':'Ruoshui-Comic/0.1'})
 response=open_remote(req,timeout=READ_TIMEOUT)
 try:
  with response:
   download_stream(item,part,response,url,offset,size)
 except Exception:failed_response(response);raise

def download_stream(item,part,response,url,offset,size):
  if response.headers.get('Content-Type','').startswith('text/html'):raise RuntimeError('下载源返回了网页，已拒绝写入模型')
  if response.status!=206:offset=0
  if response.status==206:
   match=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',response.headers.get('Content-Range',''))
   if not match or int(match[1])!=offset or size and int(match[3])!=size or int(match[2])!=int(match[3])-1:raise RuntimeError('下载源的断点位置不正确')
  total=size or int(response.headers.get('Content-Length',0))+offset
  last=0;samples=deque([(time.monotonic(),offset)])
  emit(type='download',phase='downloading',name=part.name[:-5],bytes=offset,total=total,percent=round(offset/total*100,1) if total else 0,speed=0,connections=1,source=urllib.parse.urlsplit(url).netloc,downloadHost=urllib.parse.urlsplit(response.url).netloc,route=getattr(response,'download_route','direct'),message='正在下载，可断点续传')
  with part.open('ab' if offset else 'wb') as out:
   while chunk:=response.read1(256*1024):
    out.write(chunk);offset+=len(chunk)
    now=time.monotonic();samples.append((now,offset))
    while len(samples)>2 and samples[1][0]<now-5:samples.popleft()
    if now-last>=1:
     speed=max(0,(offset-samples[0][1])/max(.01,now-samples[0][0]));emit(type='download',phase='downloading',name=part.name[:-5],percent=round(offset/total*100,1) if total else 0,bytes=offset,total=total,speed=round(speed),eta=round((total-offset)/speed) if speed>0 else None);last=now
   out.flush();os.fsync(out.fileno())
def download(item,root,mode='auto'):
 dst=root/item['target'];size=item.get('size',0);expected=item.get('sha256');receipt=dst.with_name(dst.name+'.verified.json')
 current=partial_bytes(dst.with_name(dst.name+'.part'),item)
 emit(type='download',phase='connecting',name=dst.name,target=item['target'],bytes=current,total=size,percent=round(current/size*100,1) if size else 0,speed=0,eta=None,connections=0,source='',downloadHost='',route='',retryAttempt=0,message='连接模型下载源…')
 if dst.exists() and size and dst.stat().st_size==size:
  try:
   cache=json.loads(receipt.read_text());valid=cache['sha256']==expected and cache['mtime_ns']==dst.stat().st_mtime_ns
  except Exception:valid=False
  if valid or expected and digest(dst)==expected:
   receipt.write_text(json.dumps({'sha256':expected,'size':size,'mtime_ns':dst.stat().st_mtime_ns}),encoding='utf-8');emit(type='download',phase='verified',name=dst.name,bytes=size,total=size,percent=100,speed=0,message='文件已通过完整性检查');return
 if dst.exists():dst.replace(dst.with_name(dst.name+'.invalid-'+str(int(time.time()))))
 urls=source_candidates(item,mode);item={**item,'_download_sources':urls};error=None
 for attempt in range(6):
  healthy=[url for url in urls if source_cooldown.get(urllib.parse.urlsplit(url).netloc,0)<=time.monotonic()]
  chosen=healthy[0] if healthy else min(urls,key=lambda url:source_cooldown.get(urllib.parse.urlsplit(url).netloc,0))
  try:
   download_once(item,root,chosen);source_cooldown.pop(urllib.parse.urlsplit(chosen).netloc,None);return
  except Exception as e:
   source_cooldown[urllib.parse.urlsplit(chosen).netloc]=time.monotonic()+120
   connection_limits[urllib.parse.urlsplit(chosen).netloc]=max(1,connection_limits.get(urllib.parse.urlsplit(chosen).netloc,MAX_CONNECTIONS)//2)
   error=e;current=partial_bytes(dst.with_name(dst.name+'.part'),item);delay=min(2+attempt,8);timed_out=isinstance(e,(TimeoutError,socket.timeout)) or 'timed out' in str(e).lower()
   message='连接或读取超时，已保留下载进度，正在切换线路并续传' if timed_out else '下载连接中断，已保留下载进度，正在切换线路并续传'
   emit(type='download',phase='retrying',name=dst.name,bytes=current,total=size,percent=round(current/size*100,1) if size else 0,speed=0,eta=None,retryAttempt=attempt+1,retryDelay=delay,message=message+f' ({attempt+1}/6)')
   if attempt<5:time.sleep(delay)
 raise RuntimeError('模型下载暂时无法完成，已保留下载进度；请检查网络或连接网络加速器后点击继续。') from error
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
