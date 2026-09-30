import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startServer} from '../server.mjs';
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
test('已占用端口自动切换，输出地址与实际服务一致',async()=>{
  const blocker=http.createServer();await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
  let server;const port=blocker.address().port,logs=[];
  try{
    server=await startServer({port,log:line=>logs.push(line)});
    assert.ok(server.address().port>port);
    assert.match(logs[0],/已被占用/);
    const actualPort=server.address().port;
    assert.ok(logs.at(-1).includes(`http://127.0.0.1:${actualPort}/`));
    const response=await fetch(`http://127.0.0.1:${actualPort}/`);
    assert.equal(response.status,200);assert.match(await response.text(),/音乐工作台/);
  }finally{if(server)await close(server);await close(blocker);}
});
test('端口尝试耗尽时返回可操作的错误',async()=>{
  const blocker=http.createServer();await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(startServer({port:blocker.address().port,maxAttempts:1,log:()=>{}}),/PORT=5200/);}finally{await close(blocker);}
});
test('无效端口直接拒绝',()=>{assert.throws(()=>startServer({port:NaN}),/PORT/);});
