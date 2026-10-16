"""Build an independent portable runtime from an existing working ComfyUI package.
Never modifies the source package; weights, outputs, user files and unrelated nodes are excluded.
Run using the SOURCE package's Python so dependency metadata matches its interpreter.
"""
import argparse, importlib.metadata as md, json, pathlib, shutil, sys, time
from packaging.requirements import Requirement

p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--target',required=True)
a=p.parse_args();source=pathlib.Path(a.source).resolve();target=pathlib.Path(a.target).resolve()
if source==target or source in target.parents: raise SystemExit('Target must be separate from source')
runtime=target/'runtime';runtime.mkdir(parents=True,exist_ok=True)
python_src=pathlib.Path(sys.executable).parent;python_dst=runtime/'python'
python_dst.mkdir(exist_ok=True)
for f in python_src.iterdir():
 if f.is_file() and not f.name.endswith('._pth'): shutil.copy2(f,python_dst/f.name)
for name in ['DLLs']:
 if (python_src/name).exists(): shutil.copytree(python_src/name,python_dst/name,dirs_exist_ok=True)
site=python_dst/'Lib/site-packages';site.mkdir(parents=True,exist_ok=True)
reqs=[line.strip() for line in (source/'requirements.txt').read_text().splitlines() if line.strip() and not line.startswith('#')]
reqs+=['ultralytics','opencv-python','piexif','dill','segment-anything','scikit-image','huggingface-hub','matplotlib','websocket-client','pip','wheel']
done=set();records=[];missing=[]
def copy_requirement(text):
 try: r=Requirement(text)
 except Exception: return
 if r.marker and not r.marker.evaluate(): return
 key=r.name.lower().replace('_','-')
 if key in done: return
 done.add(key)
 try: dist=md.distribution(r.name)
 except md.PackageNotFoundError: missing.append(r.name);return
 print('Copy dependency',r.name,dist.version,flush=True)
 for file in dist.files or []:
  src=pathlib.Path(dist.locate_file(file)).resolve()
  try: rel=src.relative_to(python_src/'Lib/site-packages')
  except ValueError: continue
  if not src.is_file() or src.suffix=='.pyc':continue
  dst=site/rel;dst.parent.mkdir(parents=True,exist_ok=True)
  if not dst.exists():shutil.copy2(src,dst)
 records.append({'name':r.name,'version':dist.version})
 for dep in dist.requires or []:copy_requirement(dep)
for req in reqs:copy_requirement(req)
zip_name=next(python_dst.glob('python3*.zip')).name
(python_dst/(zip_name.replace('.zip','._pth'))).write_text(f'{zip_name}\n.\nLib/site-packages\n../ComfyUI\nimport site\n')
def exclude(directory,names):
 common={'.git','__pycache__','node_modules','.venv','.cache'}
 if pathlib.Path(directory).resolve()==source:common.update({'models','output','input','temp','user','custom_nodes'})
 return [name for name in names if name in common or name.endswith('.pyc')]
print('Copy ComfyUI core',flush=True)
shutil.copytree(source,runtime/'ComfyUI',ignore=exclude,dirs_exist_ok=True)
custom=['ComfyUI-Anima-LLLite','ComfyUI-Impact-Pack','comfyui-impact-subpack','comfyui_ultimatesdupscale']
for name in custom:
 src=source/'custom_nodes'/name
 if src.exists():shutil.copytree(src,runtime/'ComfyUI/custom_nodes'/name,ignore=shutil.ignore_patterns('.git','__pycache__','*.pyc','models','.cache'),dirs_exist_ok=True)
for name in ['diffusion_models','text_encoders','vae','loras','controlnet','upscale_models','ultralytics/bbox','ultralytics/segm']:(runtime/'ComfyUI/models'/name).mkdir(parents=True,exist_ok=True)
receipt={'created':time.strftime('%Y-%m-%dT%H:%M:%S'),'python':sys.version,'source':str(source),'dependencies':records,'missing':missing,'custom_nodes':custom,'models_included':False}
(runtime/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',json.dumps({'dependencies':len(records),'missing':missing}),flush=True)
