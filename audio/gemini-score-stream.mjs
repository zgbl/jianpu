export async function readGeminiScoreStream(response,onDelta,{signal}={}){
 const reader=response.body?.getReader();if(!reader)throw Error('Gemini 没有返回数据流');
 const decoder=new TextDecoder();let pending='',text='',finishReason=null,usage=null;
 function event(block){
  const data=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
  if(!data||data==='[DONE]')return;
  const value=JSON.parse(data);if(value.error)throw Error(value.error.message||'Gemini 流中错误');
  if(value.promptFeedback?.blockReason)throw Error('Gemini 拒绝了请求：'+value.promptFeedback.blockReason);
  const candidate=value.candidates?.[0];
  for(const part of candidate?.content?.parts||[]){if(typeof part.text==='string'&&!part.thought){text+=part.text;if(text.length>2_000_000)throw Error('模型结果超过 2 MB，请分批识谱');onDelta(part.text);}}
  if(candidate?.finishReason)finishReason=candidate.finishReason;
  if(value.usageMetadata)usage=value.usageMetadata;
 }
 try{
  for(;;){signal?.throwIfAborted();const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});pending=pending.replace(/\r\n/g,'\n');let end;
   while((end=pending.indexOf('\n\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+2);}
   if(pending.length>4*1024*1024)throw Error('Gemini 流事件过大');
   if(done){if(pending.trim())event(pending);break;}
  }
  if(finishReason!=='STOP')throw Error(finishReason==='MAX_TOKENS'?'Gemini 输出超出长度限制，请分批识谱':`Gemini 未正常完成（${finishReason||'连接中断'}），现有谱面未修改。`);
  if(!text)throw Error('Gemini 没有返回谱面 JSON');
  return {text,usage};
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
