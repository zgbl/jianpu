import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createCipheriv} from 'node:crypto';
import {createCredentialEncryption} from '../audio/chatgpt-credential-encryption.mjs';

test('旧加密顺序在 final 前读 tag 会触发确定的错误',()=>{
 const cipher=createCipheriv('aes-256-gcm',randomBytes(32),randomBytes(12));
 assert.throws(()=>cipher.getAuthTag(),{code:'ERR_CRYPTO_INVALID_STATE'});
});
test('凭据 AES-GCM 往返、重启读取和格式保持兼容',async()=>{
 const key=randomBytes(32),source=JSON.stringify({version:2,profiles:[{label:'测试账号',credentials:{accessToken:'fake-token'}}]});
 const encoder=createCredentialEncryption(async()=>key),encrypted=await encoder.encrypt(source);
 assert.equal(encrypted[0],1);assert.equal(encrypted.includes(Buffer.from('fake-token')),false);
 const restarted=createCredentialEncryption(async()=>key);
 assert.equal(await restarted.decrypt(encrypted),source);
 assert.equal(await restarted.decrypt(await encoder.encrypt('')),'');
 assert.notDeepEqual(encrypted,await encoder.encrypt(source));
});
test('密文、认证标签或密钥被改动时拒绝解密',async()=>{
 const key=randomBytes(32),codec=createCredentialEncryption(async()=>key),encrypted=await codec.encrypt('credential');
 for(const index of [13,29]){const altered=Buffer.from(encrypted);altered[index]^=1;await assert.rejects(codec.decrypt(altered));}
 await assert.rejects(createCredentialEncryption(async()=>randomBytes(32)).decrypt(encrypted));
 await assert.rejects(codec.decrypt(Buffer.from([1])));
});
