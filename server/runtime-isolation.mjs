import fs from 'node:fs/promises';import path from 'node:path';
export async function isolateModelPaths(service){
 const config=path.join(service.runtime,'ComfyUI/extra_model_paths.yaml');let contents;try{contents=await fs.readFile(config,'utf8');}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(!contents.split(/\r?\n/).some(line=>line.trim()&&line.trim()!=='{}'&&!line.trim().startsWith('#'))){if(!contents.includes('{}'))await fs.writeFile(config,contents+'\n{}\n');return false;}
 const backup=path.join(service.data,'backups/runtime-isolation');await fs.mkdir(backup,{recursive:true});
 await fs.rename(config,path.join(backup,'extra-model-paths-'+Date.now()+'.yaml'));
 await fs.writeFile(config,'# Ruoshui Comic uses only runtime/ComfyUI/models in this installation.\n# External model-sharing configurations are backed up under works/backups/runtime-isolation.\n{}\n');
 service.log?.('已隔离外部模型共享配置；本引擎只加载整合包自己的模型。');return true;
}
