export function chooseChatGPTModel(models,saved=''){
 const available=new Set(models.map(x=>x.slug));
 if(saved&&available.has(saved))return saved;
 if(available.has('gpt-6-luna'))return 'gpt-6-luna';
 // A more expensive model must be an explicit user choice.
 return '';
}

export async function readModelStream(response,onDelta=()=>{},onProgress=()=>{}){
 const reader=response.body?.getReader();if(!reader)throw Error('模型响应没有可读取的数据流');
 const decoder=new TextDecoder();let pending='',result=null;
 function event(line){
  if(!line.trim())return;
  const value=JSON.parse(line);
  if(value.type==='delta')onDelta(value.text);
  else if(value.type==='started'||value.type==='progress')onProgress(value.message||'请求已提交，等待模型输出');
  else if(value.type==='result')result=value;
  else if(value.type==='error')throw Error(value.error||'模型请求失败');
 }
 try{
  for(;;){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});let end;
   while((end=pending.indexOf('\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+1);}
   if(pending.length>16*1024*1024)throw Error('模型返回内容过大');
   if(done){if(pending)event(pending);break;}
  }
  if(!result)throw Error('模型连接中断，未收到完整结果；现有谱面未修改。');
  return result;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
