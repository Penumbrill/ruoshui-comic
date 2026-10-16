export function downloadDescription(install={}){
 const name=install.name||'',profile=install.profile||'';
 if(/birefnet/i.test(name)||profile==='cutout_general')return{title:'通用主体抠图模型',purpose:'用于自动识别人像和物品，分离主体与背景，制作破框效果。首次下载约 928 MB，完成后在本地使用。',category:'models'};
 if(/isnet/i.test(name)||profile==='cutout')return{title:'动漫人物抠图模型',purpose:'用于自动分离动漫人物与背景，下载后无需再次下载。',category:'models'};
 if(/sam_vit/i.test(name)||profile==='selection')return{title:'涂抹选取主体模型',purpose:'用于通过点击或涂抹保留人物、物品，精细调整抠图选区。',category:'models'};
 if(profile==='translation')return{title:'离线中文转英文模型',purpose:'在本机 CPU 上把中文描述翻译成英文提示词，不占用生图显存。',category:'models'};
 if(profile==='tag_translation')return{title:'离线标签中文翻译模型',purpose:'在本机把英文标签译成中文说明，与内置标签词库一起使用。',category:'models'};
 if(profile==='llm_runtime')return{title:'独立语言推理程序',purpose:'供本软件加载自己的语言模型，生成故事与分镜；不依赖其他软件。下载支持暂停与续传，完成后自动校验安装。',category:'assistant'};
 if(profile==='runtime')return{title:'软件独立运行环境',purpose:'安装本软件使用的 Python 和推理组件，供本地生成与抠图使用。',category:'environment'};
 if(/\.gguf$/i.test(name))return{title:/mmproj/i.test(name)?'本地视觉投影模型 · mmproj':'本地提示词助手模型',purpose:/mmproj/i.test(name)?'与配套的本地 LLM 一起使用，让提示词助手能够分析参考图片。':'让提示词助手在本机编写分镜和提示词。下载完成后在助手中选择该模型。',category:'models'};
 if(/upscale|realesrgan|yolov8|face|hand/i.test(name)||profile==='finishing')return{title:'画面修复与放大模型',purpose:'用于面部、手部检测及画面放大，只补全缺失的模型文件。',category:'models'};
 return{title:profile==='inpaint'?'局部重绘模型':'生图所需模型',purpose:'用于本地生成或处理图片；已存在且校验通过的文件会跳过，下载中断可以续传。',category:'models'};
}
