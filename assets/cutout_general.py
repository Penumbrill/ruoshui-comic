"""BiRefNet general foreground segmentation (MIT), short-lived CPU worker.
ONNX conversion by onnx-community. Preprocessing uses ImageNet mean/std.
"""
import sys,json,numpy as np,cv2
from PIL import Image,ImageOps
import onnxruntime as ort
model,source,output=sys.argv[1:4];settings=json.load(sys.stdin)
image=ImageOps.exif_transpose(Image.open(source)).convert('RGBA');w,h=image.size
options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
session=ort.InferenceSession(model,sess_options=options,providers=['CPUExecutionProvider'])
shape=session.get_inputs()[0].shape;size=shape[2] if isinstance(shape[2],int) else 1024
rgb=cv2.resize(np.asarray(image.convert('RGB')),(size,size),interpolation=cv2.INTER_AREA).astype(np.float32)/255
rgb=(rgb-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)
logits=np.squeeze(session.run(None,{session.get_inputs()[0].name:rgb.transpose(2,0,1)[None]})[-1])
prob=1/(1+np.exp(-np.clip(logits,-30,30)));prob=cv2.resize(prob,(w,h),interpolation=cv2.INTER_LINEAR)
threshold=float(settings.get('threshold',.5));prob=np.clip((prob-threshold+.5),0,1)
grow=int(settings.get('grow',0))
if grow:
 kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(abs(grow)*2+1,abs(grow)*2+1))
 prob=cv2.dilate(prob,kernel) if grow>0 else cv2.erode(prob,kernel)
feather=float(settings.get('feather',.5))
if feather>0:prob=cv2.GaussianBlur(prob,(0,0),feather)
alpha=(prob*255).astype(np.uint8);alpha[alpha<8]=0;alpha[alpha>247]=255
alpha=np.minimum(alpha,np.asarray(image.getchannel('A')));fraction=float((alpha>127).mean())
if fraction<.0003:raise ValueError('没有找到明显主体，请用绿色涂抹指定人物或物品')
image.putalpha(Image.fromarray(alpha));image.save(output)
print(json.dumps({'width':w,'height':h,'foregroundFraction':fraction,'mode':'general','automatic':True,'warning':'主体占满画面，可涂红色标记排除背景' if fraction>.95 else ''}),flush=True)
