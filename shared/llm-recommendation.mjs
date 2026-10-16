export const defaultLlmRepository='HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF';
export function recommendedLlmFile(files=[]){
 const main=files.filter(f=>/\.gguf$/i.test(f.name)&&!/mmproj|projector|fastmtp/i.test(f.name));
 return main.find(f=>/Q4_K_P\.gguf$/i.test(f.name))||main.find(f=>/Q4_K_M\.gguf$/i.test(f.name))||main.find(f=>/IQ4_XS\.gguf$/i.test(f.name))||null;
}
