export const inpaintPresets=[
 {id:'object',name:'替换手中物品',tip:'涂满旧物品和需要调整的手指边缘；将 apple 改为 cup，保留其他描述。',denoise:.72,padding:96},
 {id:'expression',name:'改变表情',tip:'只涂脸部表情区域；例如 smiling 改为 angry。',denoise:.48,padding:80},
 {id:'pose',name:'调整手部动作',tip:'涂满整只手和动作会移动到的范围；例如 waving 改为 clenched fist。',denoise:.65,padding:112},
 {id:'detail',name:'修补小细节',tip:'涂抹瑕疵区域，描述想保留的细节。',denoise:.4,padding:64}
];
export function applyInpaintPreset(profile,id){const p=inpaintPresets.find(p=>p.id===id);if(!p)throw Error('未知重绘模式');return{...profile.inpaint,preset:id,steps:28,cfg:4,sampler:profile.sampler,scheduler:profile.scheduler,denoise:p.denoise,maskBlur:4,growMask:0,invertMask:false,onlyMasked:true,padding:p.padding};}
