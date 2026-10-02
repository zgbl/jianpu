class AudioRecorderProcessor extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(2048);this.at=0;}
 process(inputs){const channels=inputs[0];if(!channels?.length)return true;for(let i=0;i<channels[0].length;i++){let value=0;for(const channel of channels)value+=channel[i]||0;this.buffer[this.at++]=value/channels.length;if(this.at===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(2048);this.at=0;}}return true;}
}
registerProcessor('jianpu-audio-recorder',AudioRecorderProcessor);
