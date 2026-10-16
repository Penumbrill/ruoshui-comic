"""Local anime segmentation. A short-lived CPU process releases its memory on exit.
Preprocessing follows SkyTNT/anime-segmentation (Apache-2.0).
"""
import sys,json
import numpy as np
import cv2
from PIL import Image,ImageOps
import onnxruntime as ort

model,source,output=sys.argv[1:4];settings=json.load(sys.stdin)
image=ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
rgb=image.convert('RGB');width,height=rgb.size
options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
session=ort.InferenceSession(model,sess_options=options,providers=['CPUExecutionProvider'])
shape=session.get_inputs()[0].shape
size=shape[2] if isinstance(shape[2],int) else 1024
scale=size/max(width,height);w=max(1,round(width*scale));h=max(1,round(height*scale));x=(size-w)//2;y=(size-h)//2
data=np.zeros((size,size,3),dtype=np.float32)
data[y:y+h,x:x+w]=np.asarray(rgb.resize((w,h),Image.Resampling.BILINEAR),dtype=np.float32)/255
prediction=session.run(None,{session.get_inputs()[0].name:data.transpose(2,0,1)[None]})[0]
mask=np.squeeze(prediction)[y:y+h,x:x+w]
mask=Image.fromarray((np.clip(mask,0,1)*255).astype(np.uint8)).resize((width,height),Image.Resampling.LANCZOS)
prob=np.asarray(mask).astype(np.float32)/255;prob=np.clip(prob-float(settings.get('threshold',.5))+.5,0,1);grow=int(settings.get('grow',0))
if grow:
 kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(abs(grow)*2+1,abs(grow)*2+1));prob=cv2.dilate(prob,kernel) if grow>0 else cv2.erode(prob,kernel)
feather=float(settings.get('feather',.5))
if feather>0:prob=cv2.GaussianBlur(prob,(0,0),feather)
alpha=np.minimum(np.asarray(image.getchannel('A')),(prob*255).astype(np.uint8));alpha[alpha<8]=0;alpha[alpha>247]=255;image.putalpha(Image.fromarray(alpha))
image.save(output)
print(json.dumps({'width':width,'height':height,'foregroundFraction':float((alpha>127).mean())}),flush=True)
