// New song files and system recordings never inherit a prior demo's solo mode.
export const importedAudioMode=options=>options?.inputMode==='solo'?'solo':'mixed';
export const analysisMethod=(mode,model='htdemucs')=>mode==='solo'?'pYIN (user-supplied melody)':`${model} + pYIN`;
export const sourceTrackLabel=mode=>mode==='solo'?'输入音频（未做人声分离）':'提取的人声 / 主旋律';

export const importedAudioDuration=options=>options?.inputMode==='solo'&&options?.demo===true?'15':'600';
