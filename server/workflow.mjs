import {makeProfile,mergeConfig} from './profiles.mjs';
export function validateParams(input){
 if(!['original','expanded'].includes(input.type)) throw Error('请选择原版或 2.9B 模型类型');
 const p=mergeConfig(makeProfile(input.type),structuredClone(input));
 for(const key of ['width','height']) if(!Number.isInteger(p[key])||p[key]<256||p[key]>4096||p[key]%16) throw Error('尺寸应为 256–4096 范围内的 16 的倍数');
 if(!Number.isInteger(p.steps)||p.steps<1||p.steps>150) throw Error('步数应为 1–150');
 if(!Number.isFinite(p.cfg)||p.cfg<0||p.cfg>30) throw Error('CFG 应为 0–30');
 if(p.seed!==''&&p.seed!==null&&(!Number.isSafeInteger(Number(p.seed))||Number(p.seed)<0)) throw Error('种子应为空或安全范围内的非负整数');
 if(!Array.isArray(p.loras)||p.loras.length>20) throw Error('最多同时加载 20 个 LoRA');
 for(const l of p.loras) if(!Number.isFinite(l.strength_model)||!Number.isFinite(l.strength_clip)) throw Error('LoRA 权重必须是数字');
 if(typeof p.positive!=='string'||typeof p.negative!=='string'||p.positive.length+p.negative.length>40000) throw Error('提示词过长');
 return p;
}
export function nodeDefaults(schema){
 const result={};
 for(const [name,def] of Object.entries(schema?.input?.required||{})){
  const [type,options]=def;
  if(options?.default!==undefined) result[name]=options.default;
  else if(Array.isArray(type)) result[name]=type[0];
  else if(type==='BOOLEAN') result[name]=false;
  else if(type==='STRING') result[name]='';
  else if(type==='INT'||type==='FLOAT') result[name]=options?.min||0;
 }
 return result;
}
export function buildWorkflow(input,schemas={},files={}) {
 const p=validateParams(input);const graph={};let next=1;
 function add(type,inputs,title){
  if(Object.keys(schemas).length&&!schemas[type]) throw Error(`缺少节点 ${type}，请在设置中修复运行环境`);
  inputs={...inputs};
  for(const [key,value] of Object.entries(inputs)){
   const choices=(schemas[type]?.input?.required?.[key]||schemas[type]?.input?.optional?.[key])?.[0];
   if(typeof value==='string'&&Array.isArray(choices)&&!choices.includes(value)){
    const actual=choices.find(choice=>typeof choice==='string'&&choice.replaceAll('\\','/')===value.replaceAll('\\','/'));
    if(actual!==undefined)inputs[key]=actual;
   }
  }
  const id=String(next++);graph[id]={class_type:type,inputs:{...nodeDefaults(schemas[type]),...inputs},_meta:{title:title||type}};return [id,0];
 }
 const seed=Number(p.seed);let model=add('UNETLoader',{unet_name:p.model,weight_dtype:'default'},'Anima 模型');
 let clip=add('CLIPLoader',{clip_name:p.textEncoder,type:'stable_diffusion',device:'default'},'文本编码器');
 const vae=add('VAELoader',{vae_name:p.vae});
 model=add('ModelSamplingAuraFlow',{model,shift:p.shift});
 for(const lora of p.loras.filter(l=>l.enabled!==false&&l.name)){
  const loader=add('LoraLoader',{model,clip,lora_name:lora.name,strength_model:lora.strength_model,strength_clip:lora.strength_clip});
  model=loader;clip=[loader[0],1];
 }
 const positive=add('CLIPTextEncode',{clip,text:p.positive},'正向提示词');
 const neg=add('CLIPTextEncode',{clip,text:p.negative},'负向提示词');
 let latent,original,mask,context,detailStrength;
 if(files.image){
  original=add('LoadImage',{image:files.image});
  if(!files.mask)throw Error('请先用画笔涂抹需要重绘的区域');
  const maskImage=add('LoadImage',{image:files.mask});mask=add('ImageToMask',{image:maskImage,channel:'red'});
  if(p.inpaint.preset==='detail')detailStrength=add('MogeDetailStrength',{mask,maximum:p.inpaint.denoise,invert:p.inpaint.invertMask});
  const prepared=add('MogePrepareInpaint',{image:original,mask,mask_blur:p.inpaint.maskBlur,invert:p.inpaint.invertMask,only_masked:p.inpaint.onlyMasked,padding:p.inpaint.padding,grow_mask:p.inpaint.growMask,resolution:Math.min(1536,Math.max(p.width,p.height)),protect_small_details:p.inpaint.preset==='detail'});
  const image=prepared;mask=[prepared[0],1];context=[prepared[0],2];
  if(p.inpaint.controlnet){
   if(p.type==='expanded'&&p.inpaint.controlnet==='anima-lllite-inpainting-v2.safetensors')throw Error('Kohya 的原版重绘模型针对 28 层 Anima；2.9B 请使用基础遮罩重绘，或导入兼容 40 层的 ControlNet');
   const condition=['large','pose'].includes(p.inpaint.preset)?add('MogeInpaintCondition',{image,mask}):image;
   model=add('AnimaLLLiteApply_sdscripts',{model,lllite_name:p.inpaint.controlnet,image:condition,mask,strength:p.inpaint.strength,start_percent:p.inpaint.start_percent,end_percent:p.inpaint.end_percent,preserve_wrapper:p.inpaint.preserve_wrapper});
  }
  const encoded=add('VAEEncode',{pixels:image,vae});latent=add('SetLatentNoiseMask',{samples:encoded,mask});
 } else latent=add('EmptyLatentImage',{width:p.width,height:p.height,batch_size:1});
 const sampled=add('KSampler',{model,positive,negative:neg,latent_image:latent,seed,steps:files.image?p.inpaint.steps:p.steps,cfg:files.image?p.inpaint.cfg:p.cfg,sampler_name:files.image?p.inpaint.sampler:p.sampler,scheduler:files.image?p.inpaint.scheduler:p.scheduler,denoise:files.image?(detailStrength||p.inpaint.denoise):1});
 let image=p.tiledDecode?add('VAEDecodeTiled',{samples:sampled,vae,tile_size:512,overlap:64,temporal_size:64,temporal_overlap:8}):add('VAEDecode',{samples:sampled,vae});
 for(const [key,type] of [['face','FaceDetailer'],['hand','DetailerForEach']]) if(p[key].enabled){
  const cfg=p[key];if(!cfg.detector)throw Error('请选择脸部 / 手部检测模型');
  const detector=add('UltralyticsDetectorProvider',{model_name:cfg.detector});
  const links={image,model,clip,vae,positive,negative:neg,seed};
  if(key==='face') links.bbox_detector=detector;
  else links.segs=add('BboxDetectorSEGS',{bbox_detector:detector,image,threshold:cfg.detector_threshold,dilation:cfg.detector_dilation,crop_factor:cfg.detector_crop_factor,drop_size:cfg.detector_drop_size});
  const clean=Object.fromEntries(Object.entries(cfg).filter(([k])=>!['enabled','detector'].includes(k)&&!k.startsWith('detector_')));
  if(key==='face'){clean.wildcard=cfg.wildcard;delete clean.wildcard_opt;}
  image=add(type,{...clean,...links},key==='face'?'脸部修复':'手部修复');
 }
 if(p.upscale.enabled){
  const cfg={...p.upscale};delete cfg.enabled;
  const upscaleModel=add('UpscaleModelLoader',{model_name:cfg.upscale_model});delete cfg.upscale_model;
  image=add('UltimateSDUpscale',{...cfg,image,model,vae,positive,negative:neg,upscale_model:upscaleModel,seed},'漫画高清放大');
 }
 // Composite last, so optional finishing cannot change unpainted pixels.
 if(original)image=add('MogeCompositeInpaint',{image,context});
 const saved=add('SaveImage',{images:image,filename_prefix:'ruoshui'});
 return {graph,saveNode:saved[0],params:p};
}
