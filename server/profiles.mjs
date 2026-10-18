import {handAnatomyDefaults} from '../shared/hand-defaults.mjs';
export const negative = 'worst quality, low quality, blurry, bad anatomy, extra limbs, text, watermark';
const face = {enabled:false,detector:'bbox/face_yolov8m.pt',guide_size:512,guide_size_for:true,max_size:1024,steps:20,cfg:5,sampler_name:'euler_ancestral',scheduler:'simple',denoise:0.3,feather:8,noise_mask:true,force_inpaint:true,bbox_threshold:0.5,bbox_dilation:10,bbox_crop_factor:2.5,sam_detection_hint:'center-1',sam_dilation:0,sam_threshold:0.93,sam_bbox_expansion:0,sam_mask_hint_threshold:0.7,sam_mask_hint_use_negative:'False',drop_size:10,wildcard:'face',cycle:1,inpaint_model:false,noise_mask_feather:20,tiled_encode:false,tiled_decode:false};
const hand = {...handAnatomyDefaults,enabled:false,detector:'bbox/hand_yolov8s.pt',guide_size_for:true,max_size:1024,sampler_name:'euler_ancestral',scheduler:'simple',noise_mask:true,force_inpaint:true,cycle:1,inpaint_model:false,tiled_encode:false,tiled_decode:false,detector_threshold:0.5,detector_drop_size:10};
const upscale={enabled:false,upscale_model:'RealESRGAN_x4plus.safetensors',upscale_by:2,steps:25,cfg:4,sampler_name:'euler',scheduler:'simple',denoise:0.3,mode_type:'Linear',tile_width:896,tile_height:1344,mask_blur:12,tile_padding:64,seam_fix_mode:'None',seam_fix_denoise:0.6,seam_fix_width:128,seam_fix_mask_blur:8,seam_fix_padding:16,force_uniform_tiles:true,tiled_decode:false,batch_size:1};
export function makeProfile(type) {
 const expanded=type==='expanded';
 return {type,model:expanded?'Anima-2.9B-preview-v1.safetensors':'anima-base-v1.0.safetensors',textEncoder:'qwen_3_06b_base.safetensors',vae:'qwen_image_vae.safetensors',positive:'',negative:'', width:1024,height:1024,steps:40,cfg:expanded?4:4.5,sampler:expanded?'euler':'er_sde',scheduler:expanded?'sgm_uniform':'simple',seed:'',shift:3,loras:[],batch:1,tiledDecode:false,inpaint:{preserveBackground:false,positive:'',negative:'',steps:30,cfg:4,sampler:'er_sde',scheduler:'simple',denoise:0.8,growMask:0,maskBlur:4,invertMask:false,onlyMasked:false,padding:32,controlnet:expanded?'':'anima-lllite-inpainting-v2.safetensors',strength:1,start_percent:0,end_percent:1,preserve_wrapper:true},workflowPreset:{width:expanded?1280:1920,height:expanded?1920:1280,steps:40,cfg:expanded?4:4.2,sampler:'euler_ancestral',scheduler:'simple'},face:{...face,sampler_name:expanded?'euler':'euler_ancestral',scheduler:expanded?'sgm_uniform':'simple',denoise:expanded?0.3:0.35},hand:{...hand,sampler_name:expanded?'euler':'euler_ancestral',scheduler:expanded?'sgm_uniform':'simple'},upscale:{...upscale,scheduler:expanded?'sgm_uniform':'simple'}};
}
export function defaults(){return {schemaVersion:2,adultContentEnabled:false,language:'zh',activeProfile:'original',previewHeight:430,autoTranslate:true,liveTagTranslation:true,downloadSource:'auto',networkMode:'auto',networkProxy:'http://127.0.0.1:7897',translationPreferred:'auto',translationCloud:true,translatorBackups:[],translatorUrl:'http://127.0.0.1:5001/translate',memoryMode:'auto',autoUnloadModels:true,comicClarity:true,profiles:{original:makeProfile('original'),expanded:makeProfile('expanded')}};}
export function mergeConfig(base,patch){
 for(const [key,value] of Object.entries(patch||{})) {
  if(['__proto__','constructor','prototype'].includes(key)) continue;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&base[key]&&typeof base[key]==='object') mergeConfig(base[key],value);
  else base[key]=value;
 }
 return base;
}
