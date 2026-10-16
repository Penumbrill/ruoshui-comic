"""Prompted local SAM segmentation using the rembg ONNX exports (MIT).
SAM is by Meta AI, Apache-2.0. The encoder includes its own normalization.
"""
import sys,json,pathlib,hashlib
import numpy as np
import cv2
from PIL import Image,ImageOps
import onnxruntime as ort

folder,source,output,cache=sys.argv[1:5]
settings=json.load(sys.stdin);marks=settings['points']
image=ImageOps.exif_transpose(Image.open(source)).convert('RGBA');w,h=image.size
options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
scale=min(1024/w,684/h);nw=max(1,round(w*scale));nh=max(1,round(h*scale))
key=hashlib.sha256((str(pathlib.Path(source).resolve())+str(pathlib.Path(source).stat().st_mtime_ns)).encode()).hexdigest()
cachefile=pathlib.Path(cache)/f'{key}.npy';cachefile.parent.mkdir(parents=True,exist_ok=True)
if cachefile.exists():embedding=np.load(cachefile,allow_pickle=False)
else:
 canvas=np.zeros((684,1024,3),dtype=np.float32);canvas[:nh,:nw]=cv2.resize(np.asarray(image.convert('RGB')),(nw,nh))
 encoder=ort.InferenceSession(str(pathlib.Path(folder)/'sam_vit_b_01ec64.encoder.quant.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
 embedding=encoder.run(None,{encoder.get_inputs()[0].name:canvas})[0]
 np.save(cachefile,embedding,allow_pickle=False);del encoder
 # Bounded on-disk cache; never retain models in a background process.
 for old in sorted(cachefile.parent.glob('*.npy'),key=lambda p:p.stat().st_mtime,reverse=True)[12:]:old.unlink(missing_ok=True)
points=np.array([[[p['x']*w*scale,p['y']*h*scale] for p in marks]+[[0.,0.]]],dtype=np.float32)
labels=np.array([[p['label'] for p in marks]+[-1]],dtype=np.float32)
decoder=ort.InferenceSession(str(pathlib.Path(folder)/'sam_vit_b_01ec64.decoder.quant.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
masks,scores,_=decoder.run(None,{'image_embeddings':embedding,'point_coords':points,'point_labels':labels,'mask_input':np.zeros((1,1,256,256),dtype=np.float32),'has_mask_input':np.zeros(1,dtype=np.float32),'orig_im_size':np.array([684,1024],dtype=np.float32)})
rank=scores[0].copy()
for i,mask in enumerate(masks[0]):
 for p in marks:
  inside=mask[min(683,int(p['y']*h*scale)),min(1023,int(p['x']*w*scale))]>0
  if bool(inside)!=bool(p['label']):rank[i]-=2
mask=masks[0,int(np.argmax(rank)),:nh,:nw]
# SAM returns logits, not an alpha matte. Sigmoid over the whole image
# makes uncertain background translucent and creates a foggy rectangle.
logits=cv2.resize(mask,(w,h),interpolation=cv2.INTER_LINEAR)
threshold=float(settings.get('threshold',.5));binary=(logits>np.log(threshold/(1-threshold))).astype(np.uint8)
count,components=cv2.connectedComponents(binary,connectivity=8)
keep=set()
for mark in marks:
 if mark['label']!=1:continue
 px=min(w-1,round(mark['x']*w));py=min(h-1,round(mark['y']*h))
 component=int(components[py,px])
 if component:keep.add(component)
if keep:binary=np.isin(components,list(keep)).astype(np.uint8)
if not binary.any():raise ValueError('没有识别到主体，请在主体内部补涂绿色标记')
# Anti-alias only the immediate silhouette boundary, preserving crisp interiors.
grow=int(settings.get('grow',0))
if grow:
 kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(abs(grow)*2+1,abs(grow)*2+1));binary=cv2.dilate(binary,kernel) if grow>0 else cv2.erode(binary,kernel)
feather=float(settings.get('feather',.5));matte=binary.astype(np.float32)
if feather>0:matte=cv2.GaussianBlur(matte,(0,0),feather)
alpha=np.clip(matte*255,0,255).astype(np.uint8)
alpha[alpha<8]=0;alpha[alpha>247]=255
alpha=np.minimum(np.asarray(image.getchannel('A')),alpha);image.putalpha(Image.fromarray(alpha));image.save(output)
print(json.dumps({'width':w,'height':h,'foregroundFraction':float((alpha>127).mean()),'mode':'sam'}),flush=True)
