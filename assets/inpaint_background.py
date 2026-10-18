"""Preserve original background outside the union of old and new subjects.
Newly exposed background inside the old silhouette must come from inpainting.
"""
import json, pathlib, sys, tempfile, importlib.util
import numpy as np
from PIL import Image, ImageOps, ImageFilter, ImageChops

def composite(source, candidate, mask, old_subject, new_subject, grow=8):
    source=source.convert('RGB'); candidate=candidate.convert('RGB')
    if candidate.size != source.size:
        raise ValueError('重绘结果与原图尺寸不一致')
    mask=mask.convert('L').resize(source.size, Image.Resampling.NEAREST)
    mask=mask.point(lambda p: 255 if p>0 else 0)
    grow=max(0,min(128,int(grow)))
    if grow: mask=mask.filter(ImageFilter.MaxFilter(grow*2+1))
    subject=ImageChops.lighter(old_subject.resize(source.size),new_subject.resize(source.size)).convert('L')
    subject=subject.point(lambda p: 255 if p>=8 else 0)
    # Include outline / segmentation uncertainty without reintroducing the old pose.
    # Keep a broad transition outside both silhouettes. A hard matte produces
    # pasted-on ground patches; the painted core itself must never fade back.
    scale=max(source.size)/1024
    contact_margin=max(2,round(32*scale)); transition=max(2,round(24*scale))
    bbox=subject.getbbox()
    contact=Image.new('L',source.size)
    if bbox:
        x0,y0,x1,y1=bbox
        contact.paste(subject.crop((x0,max(y0,y1-round((y1-y0)*.15)),x1,y1)),(x0,max(y0,y1-round((y1-y0)*.15))))
        contact=contact.filter(ImageFilter.MaxFilter(contact_margin*2+1))
    solid=ImageChops.lighter(subject,contact)
    outer=solid.filter(ImageFilter.MaxFilter(transition*2+1))
    alpha=ImageChops.lighter(outer.filter(ImageFilter.GaussianBlur(max(.5,8*scale))),solid)
    alpha=ImageChops.multiply(alpha,mask)
    result=Image.composite(candidate,source,alpha)
    before=np.asarray(source); after=np.asarray(result); protected=np.asarray(alpha)==0
    details={'protectedPixels':int(protected.sum()),'protectedMaskedPixels':int((protected & (np.asarray(mask)>0)).sum()),'protectedChangedPixels':int(np.any(before!=after,axis=2)[protected].sum()),'editedPixels':int((np.asarray(alpha)>0).sum())}
    if details['editedPixels']==0: raise ValueError('未识别到蒙版中的人物，请关闭背景保护后重试')
    return result,details

def main():
    model,source_path,output_path,mask_path=sys.argv[1:5];settings=json.load(sys.stdin)
    source=ImageOps.exif_transpose(Image.open(source_path)).convert('RGB')
    candidate=Image.open(output_path).convert('RGB'); mask=Image.open(mask_path).convert('RGB').getchannel('R')
    if settings.get('invertMask'):mask=ImageOps.invert(mask)
    # The process owns this folder; intermediate mattes never enter the gallery.
    with tempfile.TemporaryDirectory(prefix='background-',dir=pathlib.Path(output_path).parent) as folder:
        spec=importlib.util.spec_from_file_location('anime_segmentation',pathlib.Path(__file__).with_name('cutout.py'))
        segmenter=importlib.util.module_from_spec(spec);spec.loader.exec_module(segmenter)
        mattes=[]
        for index,image in enumerate([source_path,output_path]):
            matte=pathlib.Path(folder)/f'{index}.png'
            segmenter.segment(model,image,str(matte),{'threshold':.5,'feather':.5,'grow':0})
            mattes.append(Image.open(matte).getchannel('A').copy())
        result,details=composite(source,candidate,mask,*mattes,settings.get('growMask',0))
        result.save(output_path,format='PNG')
    print(json.dumps(details))

if __name__=='__main__':main()
