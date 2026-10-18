"""Minimal local inpainting crop / feather / composite nodes. No network or global state."""
import math
import torch
import torch.nn.functional as F
from PIL import Image,ImageFilter
import numpy as np

class MogePrepareInpaint:
 @classmethod
 def INPUT_TYPES(cls):
  return {'required':{'image':('IMAGE',),'mask':('MASK',),'mask_blur':('INT',{'default':4,'min':0,'max':64}),'invert':('BOOLEAN',{'default':False}),'only_masked':('BOOLEAN',{'default':False}),'padding':('INT',{'default':32,'min':0,'max':512}),'grow_mask':('INT',{'default':0,'min':0,'max':128}),'resolution':('INT',{'default':1024,'min':256,'max':1536})}}
 RETURN_TYPES=('IMAGE','MASK','MOGE_INPAINT_CONTEXT')
 FUNCTION='prepare'
 CATEGORY='若水漫画'
 def prepare(self,image,mask,mask_blur,invert,only_masked,padding,grow_mask,resolution):
  image=image[:1].cpu();mask=mask[:1].cpu();h,w=image.shape[1:3]
  if mask.shape[-2:]!=(h,w):mask=F.interpolate(mask.unsqueeze(1),size=(h,w),mode='nearest').squeeze(1)
  if invert:mask=1-mask
  if not torch.any(mask>0.5):raise ValueError('遮罩为空，请先涂抹需要重绘的区域')
  core=(mask>0.5).float()
  if grow_mask:
   size=grow_mask*2+1;mask=F.max_pool2d(mask.unsqueeze(1),size,stride=1,padding=grow_mask).squeeze(1)
  hard=(mask>0.5).float()
  ys,xs=torch.where(hard[0]>0.5)
  if only_masked:x0=max(0,int(xs.min())-padding);x1=min(w,int(xs.max())+padding+1);y0=max(0,int(ys.min())-padding);y1=min(h,int(ys.max())+padding+1)
  else:x0=0;x1=w;y0=0;y1=h
  crop=image[:,y0:y1,x0:x1,:];cm=hard[:,y0:y1,x0:x1]
  ch,cw=crop.shape[1:3];scale=resolution/max(ch,cw)
  th=max(16,round(ch*scale/16)*16);tw=max(16,round(cw*scale/16)*16)
  crop=F.interpolate(crop.permute(0,3,1,2),size=(th,tw),mode='bicubic',align_corners=False).permute(0,2,3,1).clamp(0,1)
  cm=F.interpolate(cm.unsqueeze(1),size=(th,tw),mode='nearest').squeeze(1)
  feather=hard
  if mask_blur:
   pil=Image.fromarray((hard[0].numpy()*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(mask_blur))
   # Keep feathering inside the edit boundary. With an expansion, the painted
   # core must be fully replaced: blending it brings the old object back.
   feather=torch.from_numpy(np.array(pil).astype(np.float32)/255).unsqueeze(0)*hard
   if grow_mask:
    # Reserve only the outer blur-width for blending. Segmentation often omits
    # antialiased object outlines just outside the painted/selected core.
    solid_margin=max(0,grow_mask-math.ceil(mask_blur))
    solid=F.max_pool2d(core.unsqueeze(1),solid_margin*2+1,stride=1,padding=solid_margin).squeeze(1)
    feather=torch.maximum(feather,solid)
  context={'original':image,'mask':feather,'box':(x0,y0,x1,y1)}
  return (crop,cm,context)

class MogeCompositeInpaint:
 @classmethod
 def INPUT_TYPES(cls):return {'required':{'image':('IMAGE',),'context':('MOGE_INPAINT_CONTEXT',)}}
 RETURN_TYPES=('IMAGE',)
 FUNCTION='composite'
 CATEGORY='若水漫画'
 def composite(self,image,context):
  result=context['original'].clone();x0,y0,x1,y1=context['box'];h,w=y1-y0,x1-x0
  edit=F.interpolate(image[:1].cpu().permute(0,3,1,2),size=(h,w),mode='bicubic',align_corners=False).permute(0,2,3,1).clamp(0,1)
  mask=context['mask'][:,y0:y1,x0:x1].unsqueeze(-1)
  result[:,y0:y1,x0:x1,:]=result[:,y0:y1,x0:x1,:]*(1-mask)+edit*mask
  return (result,)

NODE_CLASS_MAPPINGS={'MogePrepareInpaint':MogePrepareInpaint,'MogeCompositeInpaint':MogeCompositeInpaint}
NODE_DISPLAY_NAME_MAPPINGS={'MogePrepareInpaint':'若水漫画：准备重绘区域','MogeCompositeInpaint':'若水漫画：保留原图合成'}
