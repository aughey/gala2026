(function(root) {
  'use strict';
  const keys=['house','stage','backlight','lav','podium','piano','choir','erin','dj','monitors','audio_other','camera','screens'];
  function apply(state,cue) {
    const result={...state};
    if(!cue||!['go','set'].includes(cue.kind))return result;
    for(const key of keys) {
      const value=String(cue[key]??'').trim();
      if(value)result[key]={value,sequence:cue.sequence};
    }
    return result;
  }
  function before(cues,id) {
    const index=cues.findIndex(c=>c.id===id);
    return index<0?{}:cues.slice(0,index).reduce(apply,{});
  }
  function status(key,entry) {
    if(!entry)return {kind:'unknown',text:'Unspecified',mark:'?'};
    const value=entry.value;
    if(['house','stage','backlight'].includes(key)) {
      if(/^up$/i.test(value))return {kind:'on',text:'Up',mark:'●'};
      if(/^down$/i.test(value))return {kind:'off',text:'Down',mark:'○'};
    } else if(!['camera','screens','audio_other'].includes(key)) {
      const on=/\bon\b/i.test(value),off=/\boff\b/i.test(value);
      if(on&&!off)return {kind:'on',text:'On',mark:'●'};
      if(off&&!on)return {kind:'off',text:'Off',mark:'○'};
    }
    return {kind:'specified',text:value,mark:'◆'};
  }
  const api={keys,apply,before,status};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.StageState=api;
})(globalThis);
