import {mkdir} from 'node:fs/promises';import {spawn} from 'node:child_process';import {resolve} from 'node:path';
if(process.platform!=='darwin'){console.error('App音频采集目前仅支持 macOS 13+');process.exit(1);}
await mkdir('.cache/bin',{recursive:true});await mkdir('.cache/swift',{recursive:true});
const child=spawn('xcrun',['swiftc','-parse-as-library','-swift-version','5','-module-cache-path',resolve('.cache/swift'),'-O','native/AudioCapture.swift','-o','.cache/bin/audio-capture'],{stdio:'inherit'});
child.on('exit',code=>{if(code===0)console.log('App音频采集已编译；首次在页面选择App时，macOS会请求录制权限。');process.exitCode=code??1;});
