'use strict';
let show, baseline, fields, mode = 'call', saving = false, dirty = false, conflict = false;
let selected = localStorage.getItem('gala-calling-position') || '', saveTimer;
let timing={running:false,anchor:null,enteredAt:null};
let removedCall=null;
try { timing={...timing,...JSON.parse(localStorage.getItem('gala-calling-timing')||'{}')}; } catch {}
const $ = id => document.getElementById(id);
const actions = ['house','stage','backlight','lav','podium','piano','choir','erin','dj','monitors','audio_other','camera','screens'];
const groups = {
  overview: ['sequence','item','kind','time','lead_seconds','trigger','call','confirmed'],
  lighting: ['sequence','item','kind','time','trigger','house','stage','backlight','confirmed'],
  audio: ['sequence','item','kind','time','trigger','lav','podium','piano','choir','erin','dj','monitors','audio_other','confirmed'],
  video: ['sequence','item','kind','time','trigger','camera','screens','confirmed'],
};
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = key => fields.find(f=>f[0]===key)?.[1] || key;
const original = cue => baseline.cues.find(c=>c.id===cue.id);
const changed = cue => { const old = original(cue); return !old || fields.some(([k])=>String(cue[k]??'')!==String(old[k]??'')); };
function script(cue) {
  const prefix=cue.kind==='standby'?'Standby':cue.kind==='set'?'Set':'Go';
  if(cue.kind==='go') {
    const departments=[];
    actions.filter(k=>cue[k]).forEach(k=>{const name=['house','stage','backlight'].includes(k)?'Lights':k==='dj'?'DJ':k==='camera'?'Camera':k==='screens'?'Screens':'Sound';if(!departments.includes(name))departments.push(name);});
    return departments.length?departments.join(', ')+', GO!':'';
  }
  return actions.filter(k=>cue[k]).map(k=>{
    const value=String(cue[k]).replace(/\s+/g,' ').trim(),off=/\boff\b/i.test(value),on=/\bon\b/i.test(value);
    if(['house','stage','backlight'].includes(k))return `${prefix} ${label(k)} ${value.toLowerCase()}`;
    if(k==='dj')return `${prefix} ${off?'DJ music off':cue.kind==='standby'?'DJ music':'DJ'}`;
    if(['camera','screens'].includes(k))return `${prefix} ${k} — ${value.replace(/^(slide[s]?|video)\s*-\s*/i,'')}`;
    const name=({'lav':'Fr Brian lav',podium:'Podium mic',piano:'Piano / pianist',choir:'Choir mics',erin:'Erin handheld',monitors:'Stage monitors',audio_other:'Audio'})[k]||label(k);
    return `${prefix} ${name}${off?' off':on?' on':' — '+value}`;
  }).join('\n');
}
function kindSelect(cue,attribute) {
  return `<select ${attribute} aria-label="Call type">${['standby','go','set','note'].map(k=>`<option value="${k}" ${cue.kind===k?'selected':''}>${k==='standby'?'Standby':k==='go'?'Go':k==='set'?'Set':'Note'}</option>`).join('')}</select>`;
}
function error(message) { $('error').hidden = !message; $('error').textContent = message; }
function status(text) { $('saveState').textContent=text; }
function stats() {
  $('cueCount').textContent=show.cues.filter(c=>c.call).length;
  $('reviewCount').textContent=show.cues.filter(c=>!c.confirmed).length;
  $('changeCount').textContent=show.cues.filter(changed).length;
}
function filtered() {
  const query=$('search').value.toLowerCase(), filter=$('filter').value;
  return show.cues.filter(c=>(!query||Object.values(c).join(' ').toLowerCase().includes(query)) &&
    (filter==='all'||filter==='review'&&!c.confirmed||filter==='changed'&&changed(c)||filter==='calls'&&c.call));
}
function renderTable() {
  const columns=groups[$('department').value]||fields.map(([k])=>k).filter(k=>!['source_row','estimated_time','item_id','moment_id','pair_id'].includes(k));
  let html='<thead><tr>'+columns.map(k=>`<th scope="col">${escape(label(k))}</th>`).join('')+'</tr></thead><tbody>';
  const cues=filtered();
  for(const c of cues) {
    const old=original(c);
    html+=`<tr data-id="${escape(c.id)}">`+columns.map(k=>{
      const diff=!old||String(c[k]??'')!==String(old[k]??'');
      const classes=(diff?'changed ':'')+(['call','activity','screens','review'].includes(k)?'wide':'');
      let content;
      if(k==='sequence') content=`<button class="seq" data-detail="${escape(c.id)}" aria-label="Details for cue ${escape(c.sequence)}">${escape(c.sequence)}</button>${!c.confirmed?'<span class="dot">Review</span>':''}`;
      else if(k==='confirmed') content=`<input type="checkbox" data-key="confirmed" aria-label="Cue ${escape(c.sequence)} reviewed" ${c.confirmed?'checked':''}>`;
      else if(k==='kind') content=kindSelect(c,'data-key="kind"');
      else content=`<textarea data-key="${k}" aria-label="Cue ${escape(c.sequence)} ${escape(label(k))}" rows="${Math.min(6,Math.max(2,String(c[k]||'').split('\n').length))}">${escape(c[k])}</textarea>${k==='time'&&!c.time&&c.estimated_time?`<div class="estimated">Est. ${escape(c.estimated_time)} · review</div>`:''}`;
      return `<td class="${classes}">${content}</td>`;
    }).join('')+'</tr>';
  }
  $('cueTable').innerHTML=html+'</tbody>';
  if(!cues.length) $('cueTable').innerHTML+='<caption class="empty">No cues match these filters.</caption>';
}
function update(cue,key,value) {
  const wasAutomatic=cue.call===script(cue);
  cue[key]=value;
  if((actions.includes(key)||key==='kind')&&wasAutomatic) cue.call=script(cue);
  if(actions.includes(key)&&cue.pair_id)show.cues.filter(c=>c!==cue&&c.pair_id===cue.pair_id).forEach(c=>{
    const automatic=c.call===script(c);c[key]=value;if(automatic)c.call=script(c);c.confirmed=false;
  });
  if(key==='item')show.cues.filter(c=>c.item_id===cue.item_id).forEach(c=>c.item=value);
  if(key==='time'||key==='estimated_time') {
    if(cue.kind==='go')show.cues.filter(c=>c.pair_id===cue.pair_id&&c.kind==='standby').forEach(c=>c.target_time=cue.time||cue.estimated_time);
  }
  const tr=Array.from($('cueTable').querySelectorAll('tr[data-id]')).find(row=>row.dataset.id===cue.id);
  if(tr) {
    const old=original(cue);
    tr.querySelectorAll('[data-key]').forEach(el=>{
      el.closest('td').classList.toggle('changed',!old||String(cue[el.dataset.key]??'')!==String(old[el.dataset.key]??''));
      if(el.dataset.key==='call'&&document.activeElement!==el)el.value=cue.call;
    });
  }
  const detailCall=$('detailBody').querySelector('[data-detail-key="call"]');
  if(detailCall&&document.activeElement!==detailCall)detailCall.value=cue.call;
  dirty=true;
  status('Unsaved changes…'); stats();
  clearTimeout(saveTimer); saveTimer=setTimeout(save,350);
}
async function save() {
  if(!dirty||saving||conflict) return;
  saving=true; dirty=false; status('Saving…');
  try {
    const response=await fetch('/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:show.revision,cues:show.cues})});
    const data=await response.json();
    if(!response.ok) { if(response.status===409) conflict=true; throw new Error(data.error||'Save failed'); }
    show.revision=data.revision;
    status('Saved to working files · revision '+show.revision); error('');
  } catch(e) { dirty=true; error(e.message+' Your edits remain in this page. Download a recovery copy before reloading.'); status('Not saved'); recovery(); }
  finally { saving=false; if(dirty&&!conflict&&!$('error').textContent) saveTimer=setTimeout(save,350); }
}
function recovery() {
  if($('recovery'))return;
  const button=document.createElement('button');button.id='recovery';button.textContent='Download recovery JSON';
  button.onclick=()=>download(JSON.stringify(show,null,2),'gala-recovery.json','application/json');
  $('toolbar').append(button);
}
function download(text,name,type) {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function callCues() { return show.cues.filter(c=>!$('callOnly').checked||c.call); }
function rememberCalling() {
  localStorage.setItem('gala-calling-position',selected);
  localStorage.setItem('gala-calling-timing',JSON.stringify(timing));
}
function chooseCue(cue) {
  if(!cue)return;
  selected=cue.id;timing=ShowTiming.enter(timing,cue,Date.now());rememberCalling();renderCall();
}
function cueTitle(c) { return c.item||(c.activity||c.screens||'Technical transition').split('\n')[0]; }
function typeName(c) { return c.kind==='standby'?'STANDBY':c.kind==='go'?'GO':c.kind==='set'?'SET':'NOTE'; }
function stageDevice(key,name,state,changed,shape='',standby=[],set=[]) {
  const setting=StageState.status(key,state[key]);
  const pending=standby.includes(key),settingNow=set.includes(key);
  return `<div class="stage-device state-${setting.kind} ${pending?'stage-standby':settingNow?'stage-set':changed.includes(key)?'stage-changed':''}"><span class="equipment-shape ${shape}" aria-hidden="true"></span><b>${escape(name)}</b><span class="device-setting">${setting.mark} ${escape(setting.text)}${pending?' · Standby':settingNow?' · SET':changed.includes(key)?' ↗':''}</span></div>`;
}
function stagePicture(state,heading,subtitle,changed=[],standby=[],set=[],calling='',context='') {
  const device=(key,name,shape)=>stageDevice(key,name,state,changed,shape,standby,set);
  return `<article class="stage-picture"><div class="stage-picture-heading"><h3>${escape(heading)}</h3><span>${escape(subtitle)}</span></div>${context}
    <div class="stage-floor"><div class="stage-orientation">UPSTAGE / REAR</div>
      <div class="stage-screen">${device('screens','Projection / screens','screen-shape')}</div>
      <div class="stage-lighting">${device('house','House lights','light-shape')}${device('stage','Stage lighting','light-shape')}</div>
      <div class="stage-performers">${device('piano','Piano / pianist','piano-shape')}${device('choir','Choir mics','mic-shape')}${device('podium','Podium mic','podium-shape')}</div>
      <div class="stage-monitors">${device('monitors','Stage monitors','monitor-shape')}</div>
      <div class="stage-orientation">DOWNSTAGE / AUDIENCE</div>
    </div>
    <div class="stage-house">${device('camera','Camera target','camera-shape')}${device('dj','DJ audio','monitor-shape')}${device('lav','Fr Brian lav','mic-shape')}${device('erin','Erin / auctioneer','mic-shape')}</div>
    ${state.audio_other?`<div class="stage-extra">${device('audio_other','Other audio','')}</div>`:''}
    ${calling}
    <details class="stage-settings"><summary>Exact settings & source calls</summary><dl>${StageState.keys.map(key=>`<div><dt>${escape(label(key))}</dt><dd>${state[key]?escape(state[key].value)+` <small>· Call ${escape(state[key].sequence)}</small>`:'Unspecified'}</dd></div>`).join('')}</dl></details>
  </article>`;
}
function renderStage(current,next) {
  const wantNext=$('stageTarget').value==='next',target=wantNext?next:current;
  const before=StageState.before(show.cues,current.id);
  const currentContext=`<div class="stage-context"><span class="stage-context-label">CURRENT PROGRAM ITEM · CALL ${escape(current.sequence)} · ${typeName(current)}</span><h4>${escape(cueTitle(current))}</h4></div>`;
  const currentInfo=`<div class="stage-current-info"><h4>Stage activity</h4><p>${escape(current.activity||'No stage activity specified for this call.')}</p><p><b>Call when:</b> ${escape(current.trigger||'Trigger not specified — confirm with show team')}</p></div>`;
  if(!target){$('stageViews').innerHTML=stagePicture(before,'Current expected setup',`Before call ${current.sequence}`,[],[],[],currentInfo,currentContext);$('stageDelta').textContent='End of show — no next call to preview.';return;}
  const standby=target.kind==='standby'?StageState.keys.filter(key=>String(target[key]??'').trim()):[];
  const set=target.kind==='set'?StageState.keys.filter(key=>String(target[key]??'').trim()):[];
  // Only the target drawing previews standby values. The accumulated state still
  // applies GO / SET events exclusively, so advancing through standby changes nothing.
  const after=StageState.apply(StageState.before(show.cues,target.id),target.kind==='standby'?{...target,kind:'go'}:target);
  const changed=StageState.keys.filter(key=>(before[key]?.value||'')!==(after[key]?.value||''));
  const targetContext=`<div class="stage-context"><span class="stage-context-label">${wantNext?'NEXT CALL PREVIEW':'TARGET PROGRAM ITEM'} · CALL ${escape(target.sequence)} · ${typeName(target)}</span><h4>${escape(cueTitle(target))}</h4><div class="stage-target-timing" data-stage-time="${escape(target.id)}"></div></div>`;
  const calling=`<div class="stage-call stage-call-${escape(target.kind)}"><div class="stage-call-meta"><span class="event-type ${escape(target.kind)}">${typeName(target)}</span><span>CALL ${escape(target.sequence)}${wantNext?' · NEXT CALL PREVIEW':' · CURRENT CALL'}</span></div><p class="stage-call-trigger"><b>Call when:</b> ${escape(target.trigger||'Trigger not specified — confirm with show team')}</p><div class="stage-call-words"><span>YOUR CALL</span>${escape(target.call||'No technical call specified.')}</div>${!target.confirmed?'<p class="stage-call-review">UNREVIEWED · Confirm wording and trigger with the show team.</p>':''}<button type="button" data-stage-action="${wantNext?'return':'advance'}" ${!wantNext&&!next?'disabled':''}>${wantNext?'Return to current call':next?'Called — next call →':'Final call · no further calls'}</button><button type="button" class="stage-edit-call" data-detail="${escape(target.id)}">Edit call & manage order</button></div>`;
  $('stageViews').innerHTML=stagePicture(before,'Current expected setup',`Before call ${current.sequence}`,[],[],[],currentInfo,currentContext)+stagePicture(after, target.kind==='standby'?'Standby target setup':target.kind==='set'?'Set target setup':'Target setup',target.kind==='standby'?`Call ${target.sequence} · pending GO`:`After call ${target.sequence} · ${typeName(target)}`,changed,standby,set,calling,targetContext);
  $('stageDelta').textContent=target.kind==='standby'?'Standby targets · dotted borders show the intended settings; apply on GO. '+standby.map(key=>`${label(key)} → ${after[key].value}`).join(' · '):target.kind==='set'?'SET targets · blue dashed borders show settings to establish now; no GO needed. '+set.map(key=>`${label(key)} → ${after[key].value}`).join(' · '):changed.length?'Changes: '+changed.map(key=>`${label(key)} → ${after[key].value}`).join(' · '):'No equipment setting changes specified for this preview.';
}
$('stageTarget').addEventListener('change',renderCall);
$('stageViews').addEventListener('click',e=>{
  const button=e.target.closest('[data-stage-action]');if(!button)return;
  if(button.dataset.stageAction==='return'){$('stageTarget').value='current';renderCall();}
  else if($('stageTarget').value==='current')step(1);
});
function timingBadge(c,current,now) {
  const estimate=ShowTiming.estimate(c,current,timing,now);
  return `<strong class="countdown ${estimate.kind}">${escape(estimate.text)}</strong><span>${escape(estimate.note)}</span>`;
}
function stageSchedule(cue) {
  const planned=ShowTiming.planned(cue);
  if(planned===null)return 'On trigger';
  return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(new Date(planned))+' CT';
}
function stageClock(cue,current,now) {
  const estimate=ShowTiming.estimate(cue,current,timing,now);
  if(estimate.kind==='trigger')return 'On trigger';
  if(!timing.running||!timing.anchor||!Number.isFinite(estimate.remaining))return 'Start timing to estimate';
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(now+estimate.remaining))+' CT';
}
function tickStage(current,next,now) {
  document.querySelectorAll('[data-stage-time]').forEach(el=>{
    const cue=show.cues.find(c=>c.id===el.dataset.stageTime);if(!cue)return;
    const estimate=ShowTiming.estimate(cue,current,timing,now);
    const live=timing.running&&timing.anchor&&Number.isFinite(estimate.remaining);
    const expected=stageSchedule(cue);
    const estimated=live?stageClock(cue,current,now):estimate.kind==='trigger'?'On trigger':'Not started';
    const sourceNote=expected==='On trigger'||cue.time?'':cue.kind==='standby'?'Suggested standby':'Source estimate';
    el.innerHTML=`<span class="stage-time-value">Expected time <strong>${escape(expected)}</strong>${sourceNote?` <small>(${sourceNote})</small>`:''}</span><span class="stage-time-value">Live estimate <strong>${escape(estimated)}</strong></span>`;
  });
}
function renderCall() {
  const cues=callCues();
  let index=cues.findIndex(c=>c.id===selected); if(index<0)index=0;
  const c=cues[index];
  $('previous').disabled=index<=0; $('next').disabled=index>=cues.length-1;
  $('position').textContent=cues.length?`${index+1} / ${cues.length}`:'No callable cues';
  if(!c) { $('callCard').textContent='No cues in this view.'; $('upNext').textContent='';$('nextEstimate').textContent='';$('jumpCue').innerHTML='';$('stageViews').textContent='No current call';$('stageDelta').textContent='';return; }

  if(selected!==c.id){selected=c.id;timing=ShowTiming.enter(timing,c,Date.now());}
  rememberCalling();
  $('jumpCue').innerHTML=cues.map(cue=>`<option value="${escape(cue.id)}" ${cue.id===selected?'selected':''}>${escape(cue.sequence)} · ${typeName(cue)} · ${escape(cue.call||cueTitle(cue))}</option>`).join('');
  $('callCard').innerHTML=`<div class="cue-tag"><span class="event-type ${escape(c.kind)}">${typeName(c)}</span> CALL ${escape(c.sequence)} · ${escape(c.kind==='standby'?(c.lead_seconds?c.lead_seconds+'s before linked GO (suggested)':'ON TRIGGER'):c.time|| (c.estimated_time?'EST. '+c.estimated_time:'ON TRIGGER'))}</div><h2>${escape(cueTitle(c))}</h2><div class="trigger"><b>CALL WHEN</b> · ${escape(c.trigger||'Trigger not specified — confirm with show team')}</div><div class="spoken"><span class="say-label">YOUR CALL</span>${escape(c.call||'No technical call specified.')}</div><details class="current-context" ${['go','set'].includes(c.kind)?'open':''}><summary>Actions at this call point & stage activity</summary><div class="action-grid">${actions.filter(k=>c[k]).map(k=>`<div><b>${escape(label(k))}</b>${escape(c[k])}</div>`).join('')}</div>${c.activity?'<p style="white-space:pre-wrap;line-height:1.7">'+escape(c.activity)+'</p>':''}</details>${!c.confirmed?'<p class="review-note">UNREVIEWED · '+escape(c.review)+'</p>':''}<button data-detail="${escape(c.id)}">Edit call & manage order</button>`;
  const upcoming=cues.slice(index+1,index+1+Number($('lookahead').value));
  $('upNext').innerHTML=upcoming.length?upcoming.map((cue,i)=>`<article class="upcoming-cue ${i===0?'first-up':''}"><div class="queue-meta"><span>${i===0?'NEXT':'THEN'} · <span class="event-type ${escape(cue.kind)}">${typeName(cue)}</span> ${escape(cue.sequence)}</span><span>${escape(cue.kind==='standby'?'Before linked GO':cue.time||(cue.estimated_time?'Est. '+cue.estimated_time:'Untimed'))}</span></div><h3>${escape(cueTitle(cue))}${cue.item_id===c.item_id?' <small>· same program item</small>':''}</h3><div class="cue-eta" data-eta="${escape(cue.id)}"></div><p class="queue-call">${escape(cue.call||'No technical call specified.')}</p><p class="queue-trigger"><b>Call when:</b> ${escape(cue.trigger||'Confirm trigger with show team')}</p>${!cue.confirmed?'<span class="unreviewed-tag">Suggested call · needs review</span>':''}</article>`).join(''):'<p class="end-of-show">No further cues. End of show.</p>';
  renderStage(c,cues[index+1]);
  tickCalling();
}
function tickCalling() {
  if(!show||mode!=='call')return;
  const now=Date.now(),cues=callCues(),index=cues.findIndex(c=>c.id===selected),current=cues[index];
  $('wallClock').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(now)+' CT';
  $('elapsed').textContent=timing.running&&timing.enteredAt?'On this cue '+ShowTiming.format(now-timing.enteredAt):'Ready to call';
  $('timerState').textContent=timing.running?'Timing active · manual advance':'Timing not started';
  $('startTiming').textContent=timing.running?'Restart timing here':'Start timing here';
  if(!current)return;
  tickStage(current,cues[index+1],now);
  document.querySelectorAll('[data-eta]').forEach(el=>{const cue=show.cues.find(c=>c.id===el.dataset.eta);if(cue)el.innerHTML=timingBadge(cue,current,now);});
  const next=cues[index+1];
  $('nextEstimate').innerHTML=next?`<span class="next-label">ESTIMATED TIME TO NEXT CALL</span>${timingBadge(next,current,now)}`:'<span class="next-label">FINAL CUE</span><strong>No further calls</strong>';
}
function step(delta) { const cues=callCues(),i=cues.findIndex(c=>c.id===selected),index=i+delta;if(index>=0&&index<cues.length)chooseCue(cues[index]); }
function renderChanges() {
  const list=show.cues.filter(changed);
  $('changesView').innerHTML='<h2>Changes from the clean baseline</h2><p class="hint">Baseline is the extracted source. Suggested calls and estimates already in that baseline are still subject to review.</p>'+(list.length?list.map(c=>{
    const old=original(c);
    return `<article><h3>Cue ${escape(c.sequence)} ${old?'':'· Added'}</h3><table><thead><tr><th>Field</th><th>Baseline</th><th>Working copy</th></tr></thead><tbody>${fields.filter(([k])=>!old||String(c[k]??'')!==String(old[k]??'')).map(([k,l])=>`<tr><td>${escape(l)}</td><td><del>${escape(old?.[k]??'—')}</del></td><td><ins>${escape(c[k])}</ins></td></tr>`).join('')}</tbody></table></article>`;
  }).join(''):'<div class="empty">No changes yet. Edits will appear here as you make them.</div>');
}
function render() { stats(); if(mode==='edit')renderTable();if(mode==='call')renderCall();if(mode==='changes')renderChanges(); }
function setMode(value) {
  mode=value;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  $('editView').hidden=mode!=='edit';$('callView').hidden=mode!=='call';$('changesView').hidden=mode!=='changes';
  $('toolbar').hidden=mode==='call';$('hint').hidden=mode!=='edit';document.body.classList.toggle('calling',mode==='call');if(show)render();
}
function details(id) {
  const c=show.cues.find(c=>c.id===id),src=show.source_records.find(r=>r.source_row===c.source_row);
  $('detailBody').innerHTML=`<h2>${typeName(c)} · Call ${escape(c.sequence)}</h2><p class="hint">Program item: ${escape(c.item)} · Source record ${escape(c.source_row||'—')}</p><div class="event-tools"><button type="button" id="moveEarlier">↑ Move earlier</button><button type="button" id="moveLater">↓ Move later</button><button type="button" id="removeCall">Remove call</button>${removedCall?'<button type="button" id="undoRemove">Undo removal</button>':''}</div><fieldset class="insert-call"><legend>Actions at a call point</legend><label>Department<select id="newDepartment">${actions.map(k=>`<option value="${k}">${escape(label(k))}</option>`).join('')}</select></label><label>Action / target<input id="newAction" placeholder="e.g. Up, spotlight on soloist, award slide"></label><button type="button" id="addActionHere">Add / update action on this screen</button><button type="button" id="insertPair">New call point: Standby + Go</button><button type="button" id="insertSingle">New call point: Go only</button></fieldset>`+fields.filter(([k])=>!['source_row','confirmed','item_id','moment_id','pair_id','sequence'].includes(k)).map(([k,l])=>k==='kind'?`<label>${escape(l)}${kindSelect(c,'data-detail-key="kind"')}</label>`:`<label>${escape(l)}<textarea data-detail-key="${k}" rows="${k==='activity'?5:2}">${escape(c[k])}</textarea></label>`).join('')+`<label><input type="checkbox" id="detailReviewed" ${c.confirmed?'checked':''}> Reviewed with show team</label><h3>Original source record</h3><pre>${escape(src?JSON.stringify(src,null,2):'New call — no source record.')}</pre>`;
  $('detailBody').querySelectorAll('[data-detail-key]').forEach(el=>el.addEventListener('input',()=>update(c,el.dataset.detailKey,el.value)));
  $('detailReviewed').onchange=e=>update(c,'confirmed',e.target.checked);
  const index=show.cues.indexOf(c);
  $('moveEarlier').disabled=index===0;$('moveLater').disabled=index===show.cues.length-1;
  $('moveEarlier').onclick=()=>moveCall(c,-1);$('moveLater').onclick=()=>moveCall(c,1);
  $('removeCall').disabled=show.cues.length===1;
  $('removeCall').onclick=()=>{removedCall={cue:c,index};show.cues.splice(index,1);if(selected===c.id)selected=show.cues[Math.min(index,show.cues.length-1)].id;commitOrder();$('details').close();};
  if($('undoRemove'))$('undoRemove').onclick=()=>{show.cues.splice(removedCall.index,0,removedCall.cue);removedCall=null;commitOrder();details(c.id);};
  $('addActionHere').onclick=()=>{const value=$('newAction').value.trim();if(!value){$('newAction').focus();return;}update(c,$('newDepartment').value,value);details(c.id);};
  $('insertPair').onclick=()=>insertCalls(c,true);$('insertSingle').onclick=()=>insertCalls(c,false);
  if(!$('details').open)$('details').showModal();
}
function commitOrder() {show.cues.forEach((c,i)=>c.sequence=String(i+1).padStart(3,'0'));dirty=true;render();save();}
function moveCall(c,delta) {const i=show.cues.indexOf(c),j=i+delta;if(j<0||j>=show.cues.length)return;[show.cues[i],show.cues[j]]=[show.cues[j],show.cues[i]];commitOrder();details(c.id);}
function insertCalls(parent,paired) {
  const value=$('newAction').value.trim();if(!value){$('newAction').focus();return;}
  const field=$('newDepartment').value,pair='new-'+crypto.randomUUID();
  const fresh=(kind)=>{
    const c=Object.fromEntries(fields.map(([k])=>[k,'']));
    Object.assign(c,{id:pair+'-'+kind,item_id:parent.item_id,item:parent.item,kind,pair_id:pair,moment_id:pair,
      confirmed:false,lead_seconds:kind==='standby'?'30':'',trigger:kind==='standby'?'Before the linked GO — confirm standby point.':'Confirm the action trigger within this program item.',
      review:'New call — confirm wording, order, and timing. Standby lead is a suggestion.',[field]:value});
    c.call=script(c);return c;
  };
  const additions=paired?[fresh('standby'),fresh('go')]:[fresh('go')];
  show.cues.splice(show.cues.indexOf(parent)+1,0,...additions);commitOrder();details(additions[0].id);
}
$('cueTable').addEventListener('input',e=>{const key=e.target.dataset.key;if(!key||key==='confirmed')return;const c=show.cues.find(c=>c.id===e.target.closest('tr').dataset.id);update(c,key,e.target.value);});
$('cueTable').addEventListener('change',e=>{if(e.target.dataset.key!=='confirmed')return;const c=show.cues.find(c=>c.id===e.target.closest('tr').dataset.id);update(c,'confirmed',e.target.checked);});
document.addEventListener('click',e=>{const el=e.target.closest('[data-detail]');if(el)details(el.dataset.detail);});
$('details').addEventListener('close',render);
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
['search','filter','department'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',renderTable));
$('previous').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('callOnly').onchange=renderCall;
$('jumpCue').onchange=e=>chooseCue(show.cues.find(c=>c.id===e.target.value));
$('lookahead').onchange=renderCall;
$('startTiming').onclick=()=>{const cue=show?.cues.find(c=>c.id===selected);if(!cue)return;timing=ShowTiming.enter({running:true,anchor:null},cue,Date.now());rememberCalling();tickCalling();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{error('Full screen is unavailable in this preview. Open the viewer in your browser to use full screen.');}};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
document.addEventListener('keydown',e=>{if(mode!=='call'||!show||$('details').open||e.repeat||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key===' '&&e.target.closest('button'))return;if(['ArrowRight','ArrowDown',' '].includes(e.key)){e.preventDefault();step(1);}if(['ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();step(-1);}});
$('add').onclick=()=>{const cue=Object.fromEntries(fields.map(([k])=>[k,'']));cue.id='new-'+crypto.randomUUID();cue.item_id=cue.id;cue.item='New program item';cue.kind='note';cue.sequence=String(show.cues.length+1).padStart(3,'0');cue.confirmed=false;cue.review='New program item — add Standby and Go calls below.';show.cues.push(cue);dirty=true;render();save();details(cue.id);};
$('export').onclick=async()=>{await save();if(dirty||conflict){error('Resolve the save error or download the recovery JSON before exporting.');return;}const a=document.createElement('a');a.href='/export/working.csv';a.download='gala-working.csv';a.click();};
window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
async function load(initial=false) {
  try {
    const response=await fetch('/api/show');if(!response.ok)throw new Error('Could not read show files');
    const data=await response.json();
    if(!initial&&(dirty||saving||$('details').open||document.activeElement?.tagName==='TEXTAREA'))return;
    const differs=!show||JSON.stringify(show)!==JSON.stringify(data.working)||JSON.stringify(baseline)!==JSON.stringify(data.baseline);
    if(differs){show=data.working;baseline=data.baseline;fields=data.fields;
      if(!show.cues.some(c=>c.id===selected)){const mapped=show.cues.find(c=>c.member_ids?.includes(selected));if(mapped)selected=mapped.id;}
      $('showTitle').textContent=show.title||'Untitled show';
      document.title=(show.title||'Untitled show')+' · Show caller';
      $('fileSource').textContent='Reading '+data.working_file+' · checks for changes every 2 seconds';
      render();}
    status('Saved to working files · revision '+show.revision);error('');
  }catch(e){error(e.message+' · Check that the local server is running.');status('Disconnected');}
}
setMode('call');load(true);setInterval(()=>{if(!conflict&&!dirty&&!saving)load();},2000);setInterval(tickCalling,1000);
