import concurrent.futures,contextlib,hashlib,http.server,importlib.util,io,json,pathlib,socket,sys,tempfile,threading,time,types,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('download_models',ROOT/'assets/download_models.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
DATA=bytes(range(256))*1024
class Transfers(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=ROOT/'works/tests');self.root=pathlib.Path(self.temp.name);self.events=[];self.requests=[];self.active=0;self.peak=0;self.mode='normal';self.failed=False
  self.patches=[patch.object(m,'emit',lambda **event:self.events.append(event)),patch.object(m,'PARALLEL_MIN_SIZE',128*1024),patch.object(m,'BLOCK_SIZE',64*1024),patch.object(m,'READ_TIMEOUT',.15),patch.object(m,'time',types.SimpleNamespace(monotonic=time.monotonic,time=time.time,time_ns=time.time_ns,sleep=lambda _:None)),patch.dict(m.os.environ,{'RUOSHUI_PROXY_MODE':'direct'})]
  for p in self.patches:p.start()
  m.source_cache.clear();m.source_cooldown.clear();m.proxy_cooldown.clear();m.connection_limits.clear();m.domestic_cache.clear();m.context.clear();owner=self
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_GET(self):
    raw=self.headers.get('Range');start,end=0,len(DATA)-1
    if raw:
     a,b=raw[6:].split('-');start=int(a);end=int(b) if b else end
    owner.requests.append((start,end));owner.active+=1;owner.peak=max(owner.peak,owner.active)
    try:
     if owner.mode=='ignore':start,end=0,len(DATA)-1
     self.send_response(206 if raw and owner.mode!='ignore' else 200);self.send_header('Content-Length',end-start+1)
     if raw and owner.mode!='ignore':self.send_header('Content-Range',f'bytes {start+1 if owner.mode=="bad-range" else start}-{end}/{len(DATA)}')
     self.end_headers()
     if owner.mode in ('interrupt','interrupt-always') and start==64*1024 and (not owner.failed or owner.mode=='interrupt-always'):
      owner.failed=True;self.wfile.write(DATA[start:start+8192]);self.wfile.flush();self.connection.shutdown(socket.SHUT_RDWR);return
     if owner.mode=='stall' and not owner.failed:
      owner.failed=True;self.wfile.write(DATA[start:start+8192]);self.wfile.flush();time.sleep(.3);return
     time.sleep(.07)
     self.wfile.write(DATA[start:end+1])
    except (BrokenPipeError,ConnectionResetError,OSError):pass
    finally:owner.active-=1
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.url=f'http://127.0.0.1:{self.server.server_port}/model'
  self.item={'target':'model.gguf','url':self.url,'size':len(DATA),'sha256':hashlib.sha256(DATA).hexdigest()}
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.thread.join()
  for p in self.patches[::-1]:p.stop()
  self.temp.cleanup()
 def verified(self):
  self.assertEqual((self.root/'model.gguf').read_bytes(),DATA);self.assertEqual(json.loads((self.root/'model.gguf.verified.json').read_text())['sha256'],self.item['sha256']);self.assertFalse((self.root/'model.gguf.part.ranges.json').exists())
 def metadata(self,done):
  return {'size':len(DATA),'sha256':self.item['sha256'],'prefix':0,'blockSize':m.BLOCK_SIZE,'done':done}
 def test_parallel_and_legacy_resume(self):
  (self.root/'model.gguf.part').write_bytes(DATA[:80000]);m.download_once(self.item,self.root,self.url);self.verified();self.assertEqual(min(r[0] for r in self.requests),80000);self.assertGreater(self.peak,1);self.assertTrue(any(e.get('connections',0)>1 for e in self.events))
 def test_sparse_file_does_not_look_complete(self):
  part=self.root/'model.gguf.part';part.write_bytes(b'\0'*(3*64*1024)+DATA[3*64*1024:]);part.with_name(part.name+'.ranges.json').write_text(json.dumps(self.metadata([3])));m.download_once(self.item,self.root,self.url);self.verified();self.assertNotIn((3*64*1024,len(DATA)-1),self.requests)
 def test_interrupted_segments_keep_committed_ranges(self):
  self.mode='interrupt-always'
  with self.assertRaises(Exception):m.download_once(self.item,self.root,self.url)
  part=self.root/'model.gguf.part';state=m.partial_state(part,self.item);self.assertIsNotNone(state);self.assertNotIn(1,state['done']);previous=list(state['done']);self.requests.clear();self.mode='normal';m.download_once(self.item,self.root,self.url);self.verified()
  for i in previous:self.assertNotIn((i*64*1024,(i+1)*64*1024-1),self.requests)
 def test_ignored_range_falls_back_to_single_connection(self):
  self.mode='ignore';m.download_once(self.item,self.root,self.url);self.verified();self.assertTrue(any(e.get('connections')==1 for e in self.events))
 def test_wrong_range_never_publishes_a_model(self):
  self.mode='bad-range'
  with self.assertRaisesRegex(RuntimeError,'断点位置'):m.download_once(self.item,self.root,self.url)
  self.assertFalse((self.root/'model.gguf').exists());self.assertFalse((self.root/'model.gguf.verified.json').exists())
 def test_corrupt_range_map_restarts_safely(self):
  part=self.root/'model.gguf.part';part.write_bytes(b'bad'*100);part.with_name(part.name+'.ranges.json').write_text('{bad');m.download_once(self.item,self.root,self.url);self.verified();self.assertTrue(list(self.root.glob('*.invalid-*')))
 def test_small_file_read_timeout_resumes_without_resetting_progress(self):
  self.mode='stall'
  with patch.object(m,'PARALLEL_MIN_SIZE',len(DATA)+1):m.download(self.item,self.root,'official')
  self.verified();retry=next(e for e in self.events if e.get('phase')=='retrying');self.assertEqual(retry['bytes'],8192);self.assertEqual(retry['total'],len(DATA));self.assertIn('超时',retry['message']);self.assertIn((8192,len(DATA)-1),self.requests)
 def test_retry_sticks_to_a_working_source_for_later_files(self):
  calls=[];original=m.download_once
  def fail_first(item,root,url):
   calls.append(url)
   if url=='https://hf-mirror.com/model':raise TimeoutError('timed out')
   return original(item,root,self.url)
  with patch.object(m,'source_candidates',return_value=['https://hf-mirror.com/model',self.url]),patch.object(m,'download_once',side_effect=fail_first):
   m.download(self.item,self.root,'mirror');other={**self.item,'target':'second.gguf'};m.download(other,self.root,'mirror')
  self.assertEqual(calls,['https://hf-mirror.com/model',self.url,self.url])
 def test_source_probe_reads_throughput_sample_and_caches_selection(self):
  reads=[];opened=[]
  class Response(io.BytesIO):
   headers={}
   def __enter__(self):return self
   def __exit__(self,*args):self.close()
   def read1(self,n):reads.append(n);return super().read(n)
  def open_remote(request,timeout):opened.append(request.full_url);return Response(b'x'*1024**2)
  with patch.object(m,'open_remote',side_effect=open_remote),patch.object(m,'domestic_sources',return_value=[]):
   item={**self.item,'repo':'example/model','url':'https://huggingface.co/example/model','size':64*1024**2};m.source_candidates(item,'auto');m.source_candidates(item,'auto')
  self.assertEqual(len(opened),2);self.assertGreaterEqual(sum(reads),2*1024**2)
 def test_checksum_mismatch_keeps_file_unpublished(self):
  with self.assertRaisesRegex(RuntimeError,'SHA256'):m.download_once({**self.item,'sha256':'a'*64},self.root,self.url)
  self.assertFalse((self.root/'model.gguf').exists());self.assertTrue(list(self.root.glob('*.invalid-*')))
 def test_closed_proxy_is_bypassed_on_subsequent_auto_requests(self):
  routes=[]
  def opener(handler):
   proxied=bool(handler.proxies)
   def open(request,timeout):
    routes.append(proxied)
    if proxied:raise m.urllib.error.URLError('connection refused')
    return types.SimpleNamespace()
   return types.SimpleNamespace(open=open)
  with patch.dict(m.os.environ,{'RUOSHUI_PROXY_MODE':'auto','RUOSHUI_PROXY_ENV':'1'}),patch.object(m.urllib.request,'getproxies_environment',return_value={'https':'http://127.0.0.1:1'}),patch.object(m.urllib.request,'build_opener',side_effect=opener):
   for _ in range(2):self.assertEqual(m.open_remote(m.urllib.request.Request('https://example.com/model'),1).download_route,'direct')
  self.assertEqual(routes,[True,False,False])
 def test_slow_cdn_body_does_not_disable_the_http_proxy(self):
  key=(('https','http://127.0.0.1:1'),)
  with patch.dict(m.os.environ,{'RUOSHUI_PROXY_MODE':'auto'}):m.failed_response(types.SimpleNamespace(download_route='proxy',proxy_key=key))
  self.assertNotIn(key,m.proxy_cooldown)
 def test_no_proxy_bypass_list_is_not_an_http_proxy(self):
  with patch.dict(m.os.environ,{'RUOSHUI_PROXY_MODE':'auto','RUOSHUI_PROXY_ENV':'1'}),patch.object(m.urllib.request,'getproxies_environment',return_value={'no':'localhost,127.0.0.1'}),patch.object(m.urllib.request,'getproxies',side_effect=AssertionError('authoritative snapshot must not reread registry')):
   self.assertEqual(m.configured_proxies(),{})
 def test_a_disconnected_range_retries_without_stopping_other_ranges(self):
  self.mode='interrupt';m.download_once(self.item,self.root,self.url);self.verified()
  self.assertTrue(any('其他分段' in e.get('message','') for e in self.events));self.assertEqual(sum(start==64*1024 for start,end in self.requests),2)
 def test_large_continuous_windows_reduce_reconnections(self):
  with patch(__name__+'.DATA',DATA*16):
   item={**self.item,'size':len(DATA),'sha256':hashlib.sha256(DATA).hexdigest()};m.download_once(item,self.root,self.url)
   self.assertEqual((self.root/'model.gguf').read_bytes(),DATA);self.assertLessEqual(len(self.requests),8);self.assertGreater(self.peak,1)
 def test_proxy_auto_prefers_a_reachable_official_source(self):
  opened=[]
  class Response(io.BytesIO):
   headers={}
   def read1(self,n):return self.read(n)
  def remote(request,timeout):opened.append(request.full_url);return Response(b'x'*1024**2)
  with patch.object(m,'configured_proxies',return_value={'https':'http://127.0.0.1:7897'}),patch.object(m,'open_remote',side_effect=remote),patch.object(m,'domestic_sources',return_value=[]):
   urls=m.source_candidates({**self.item,'url':'https://huggingface.co/example/model/resolve/main/a','repo':'example/model'},'auto')
  self.assertEqual(opened,[urls[0]]);self.assertIn('huggingface.co',urls[0])
 def test_domestic_route_requires_matching_filename_size_and_sha256(self):
  item={**self.item,'url':'https://huggingface.co/example/model/resolve/'+'a'*40+'/weights/model.gguf'}
  entry={'Path':'weights/model.gguf','Size':item['size'],'Sha256':item['sha256'],'Revision':'b'*40};m.domestic_cache['example/model']=[entry]
  urls=m.domestic_sources(item);self.assertEqual(len(urls),1);self.assertIn('Revision='+'b'*40,urls[0]);entry['Sha256']='0'*64;self.assertEqual(m.domestic_sources(item),[])
if __name__=='__main__':unittest.main()
