export async function readOpenRouterScoreStream(response,onDelta){
 const reader=response.body?.getReader();if(!reader)throw Error('OpenRouter 没有返回数据流');
 const decoder=new TextDecoder();let pending='',text='',finishReason=null,usage=null;
 function event(block){
  const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data)return;if(data==='[DONE]')return;
  const value=JSON.parse(data);if(value.error)throw Error(value.error.message||'OpenRouter 返回错误');
  const choice=value.choices?.[0],delta=choice?.delta?.content;
  if(typeof delta==='string'&&delta){text+=delta;if(text.length>2_000_000)throw Error('模型结果超过 2 MB，请分批识谱');onDelta(delta);}
  if(choice?.finish_reason)finishReason=choice.finish_reason;
  if(value.usage)usage=value.usage;
 }
 try{
  for(;;){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');let end;
   while((end=pending.indexOf('\n\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+2);}
   if(pending.length>4*1024*1024)throw Error('OpenRouter 流事件过大');
   if(done){if(pending.trim())event(pending);break;}
  }
  if(finishReason!=='stop')throw Error(`OpenRouter 未正常完成（${finishReason||'连接中断'}），现有谱面未修改。`);
  if(!text)throw Error('OpenRouter 没有返回 JPU 内容');
  return {text,usage};
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
