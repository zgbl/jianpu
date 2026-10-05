import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

// Format v1: version byte, 12-byte IV, 16-byte GCM tag, ciphertext.
export function createCredentialEncryption(getKey,{isAvailable=()=>true}={}){
 return {
  id:'jianpu-macos-keychain-aes256gcm-v1',isAvailable,
  async encrypt(plaintext){
   const key=await getKey(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
   const data=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
   return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),data]);
  },
  async decrypt(ciphertext){
   const bytes=Buffer.from(ciphertext);if(bytes.length<29||bytes[0]!==1)throw new Error('加密数据版本无效。');
   const key=await getKey(),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(1,13));
   decipher.setAuthTag(bytes.subarray(13,29));
   return Buffer.concat([decipher.update(bytes.subarray(29)),decipher.final()]).toString('utf8');
  }
 };
}
