(function(root) {
  'use strict';
  function planned(cue) {
    if(cue.kind==='standby') {
      const target=planned({time:cue.target_time});
      const lead=String(cue.lead_seconds??'').trim();
      return target!==null&&lead!==''&&Number.isFinite(Number(lead))&&Number(lead)>=0?target-Number(lead)*1000:null;
    }
    const match=String(cue.time||cue.estimated_time||'').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if(!match||+match[1]<1||+match[1]>12||+match[2]>59)return null;
    return ((+match[1]%12+(match[3].toUpperCase()==='PM'?12:0))*60 + +match[2])*60000;
  }
  function enter(state,cue,now) {
    const time=planned(cue);
    return {...state, selected:cue.id, enteredAt:state.running?now:null,
      anchor:state.running&&time!==null?{planned:time,actual:now}:state.anchor};
  }
  function estimate(cue,current,state,now) {
    const time=planned(cue),base=planned(current);
    if(time===null)return {kind:'trigger',text:'On trigger',note:'No timed estimate in the source'};
    if(state.running&&state.anchor) {
      const remaining=state.anchor.actual+time-state.anchor.planned-now;
      return {kind:remaining<0?'overdue':'live',remaining,text:format(remaining),note:remaining<0?'Past estimate · await trigger':'Estimated from your manual progress'};
    }
    if(base!==null) {
      const remaining=time-base;
      return {kind:'planned',remaining,text:format(remaining),note:'Planned gap from current cue'};
    }
    if(cue.kind==='standby')return {kind:'schedule',text:`${cue.lead_seconds}s before GO`,note:`GO at ${cue.target_time} · suggested lead`};
    return {kind:'schedule',text:cue.time||cue.estimated_time,note:cue.time?'Scheduled time':'Estimated source time'};
  }
  function format(ms) {
    const seconds=Math.ceil(Math.abs(ms)/1000),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
    return (ms<0?'−':'')+(hours?`${hours}h ${String(minutes%60).padStart(2,'0')}m`:`${minutes}:${String(seconds%60).padStart(2,'0')}`);
  }
  const api={planned,enter,estimate,format};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.ShowTiming=api;
})(globalThis);
