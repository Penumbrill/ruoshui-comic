export const inpaintPresets=[
 {id:'object',name:'替换手中物品',tip:'涂满旧物品及其轮廓，并覆盖新物品需要的范围；尽量避开无需修改的手指。默认完整重绘，向外扩展 8 像素过渡。',denoise:1,padding:128,growMask:8,maskBlur:2,steps:40},
 {id:'expression',name:'改变表情',tip:'只涂脸部表情区域；例如 smiling 改为 angry。',denoise:.48,padding:80},
 {id:'pose',name:'调整手部动作',tip:'涂满整只手和动作会移动到的范围；例如 waving 改为 clenched fist。',denoise:.65,padding:112},
 {id:'detail',name:'修补小细节',tip:'涂抹瑕疵区域，描述想保留的细节。',denoise:.4,padding:64}
];
export function applyInpaintPreset(profile,id){const p=inpaintPresets.find(p=>p.id===id);if(!p)throw Error('未知重绘模式');return{...profile.inpaint,preset:id,steps:p.steps??28,cfg:4,sampler:profile.sampler,scheduler:profile.scheduler,denoise:p.denoise,maskBlur:p.maskBlur??4,growMask:p.growMask??0,invertMask:false,onlyMasked:true,padding:p.padding};}
