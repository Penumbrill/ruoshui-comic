"""Offline CPU translation worker. Models are loaded only from the app's verified local folder."""
import json,sys,traceback,pathlib
sys.stdin.reconfigure(encoding='utf-8',errors='strict')
sys.stdout.reconfigure(encoding='utf-8',errors='strict')
try:
 import torch
 from transformers import MarianMTModel,MarianTokenizer
 torch.set_num_threads(4)
 folder=pathlib.Path(sys.argv[1]);tokenizer=MarianTokenizer.from_pretrained(str(folder),local_files_only=True)
 model=MarianMTModel.from_pretrained(str(folder),local_files_only=True).eval().to('cpu')
 print(json.dumps({'ready':True}),flush=True)
 for line in sys.stdin:
  try:
   request=json.loads(line);text=request['text'];batch=isinstance(text,list);texts=text if batch else [text]
   if len(sys.argv)>2 and sys.argv[2]=='en-zh':texts=['>>cmn_Hans<< '+s for s in texts]
   outputs=[]
   for start in range(0,len(texts),12):
    encoded=tokenizer(texts[start:start+12],return_tensors='pt',padding=True,truncation=True,max_length=512)
    with torch.inference_mode():out=model.generate(**encoded,max_new_tokens=256 if batch else 512,num_beams=2,no_repeat_ngram_size=4,repetition_penalty=1.1)
    outputs.extend(tokenizer.batch_decode(out,skip_special_tokens=True))
   print(json.dumps({'id':request['id'],'text':outputs if batch else outputs[0]},ensure_ascii=False),flush=True)
  except Exception as e:
   traceback.print_exc(file=sys.stderr)
   print(json.dumps({'id':request.get('id'),'error':str(e)}),flush=True)
except Exception as e:
 print(json.dumps({'error':str(e)}),flush=True);sys.exit(1)
