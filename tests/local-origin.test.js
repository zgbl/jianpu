import test from 'node:test';
import assert from 'node:assert/strict';
import {localPageRequest,serverDeviceRequest} from '../audio/local-origin.mjs';

test('LAN page may use its own server address, but not a foreign origin or host',()=>{
 const req={headers:{host:'192.168.1.239:5173',origin:'http://192.168.1.239:5173','sec-fetch-site':'same-origin'},socket:{localAddress:'192.168.1.239'}};
 assert.equal(localPageRequest(req),true);
 assert.equal(localPageRequest({...req,headers:{...req.headers,origin:'http://evil.test'}}),false);
 assert.equal(localPageRequest({...req,headers:{...req.headers,'sec-fetch-site':'cross-site'}}),false);
 assert.equal(localPageRequest({...req,headers:{...req.headers,host:'localhost:5173'}}),false);
 assert.equal(localPageRequest({...req,socket:{localAddress:'127.0.0.1'}}),false);
 assert.equal(localPageRequest({headers:{host:'localhost:5173'},socket:{localAddress:'127.0.0.1'}}),true);
 assert.equal(serverDeviceRequest({...req,socket:{localAddress:'192.168.1.239',remoteAddress:'192.168.1.240'}}),false);
 assert.equal(serverDeviceRequest({...req,socket:{localAddress:'192.168.1.239',remoteAddress:'192.168.1.239'}}),true);
});
