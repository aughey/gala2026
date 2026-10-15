const {test}=require('node:test');
const assert=require('node:assert/strict');
const timing=require('./static/timing.js');

test('scheduled gaps become live estimates anchored to manual advancement',()=>{
  const current={id:'a',time:'6:15 PM'},next={id:'b',time:'6:30 PM'};
  assert.equal(timing.estimate(next,current,{running:false},0).remaining,15*60000);
  let state=timing.enter({running:true,anchor:null},current,1000);
  assert.equal(timing.estimate(next,current,state,61000).remaining,14*60000);
  // Entering the next cue late re-anchors subsequent estimates to the actual call.
  state=timing.enter(state,next,20*60000);
  assert.equal(timing.estimate({time:'6:34 PM'},next,state,21*60000).remaining,3*60000);
});

test('untimed cues wait on triggers while retaining the last timed anchor',()=>{
  const first={id:'a',time:'6:36 PM'},untimed={id:'b',time:''};
  let state=timing.enter({running:true,anchor:null},first,0);
  state=timing.enter(state,untimed,60000);
  assert.equal(timing.estimate(untimed,first,state,60000).kind,'trigger');
  assert.equal(timing.estimate({time:'6:43 PM'},untimed,state,120000).remaining,5*60000);
  assert.equal(state.enteredAt,60000);
});

test('expired estimates do not mutate current position or advance the show',()=>{
  const current={id:'a',time:'7:30 PM'},next={id:'b',estimated_time:'7:31 PM'};
  const state=timing.enter({running:true,anchor:null},current,0);
  const snapshot=JSON.stringify(state);
  const estimate=timing.estimate(next,current,state,90000);
  assert.equal(estimate.kind,'overdue');
  assert.equal(estimate.text,'−0:30');
  assert.equal(JSON.stringify(state),snapshot);
  assert.equal(state.selected,'a');
});

test('missing anchors and clock parsing do not invent a countdown',()=>{
  assert.equal(timing.planned({time:'8:30 PM - \n10:00 PM'}),20.5*3600000);
  assert.equal(timing.planned({time:'12:00 AM'}),0);
  assert.equal(timing.planned({time:'13:99 PM'}),null);
  const state=timing.enter({running:true,anchor:null},{id:'a'},0);
  assert.equal(timing.estimate({time:'8:00 PM'},{id:'a'},state,0).kind,'schedule');
});

test('standby is a distinct call before its linked GO with editable lead',()=>{
  const standby={id:'standby',kind:'standby',lead_seconds:'30',target_time:'6:30 PM'};
  const go={id:'go',kind:'go',time:'6:30 PM'};
  assert.equal(timing.planned(go)-timing.planned(standby),30000);
  const state=timing.enter({running:true,anchor:null},standby,0);
  assert.equal(timing.estimate(go,standby,state,10000).remaining,20000);
  assert.equal(state.selected,'standby');
  assert.equal(timing.planned({...standby,lead_seconds:'60'}),timing.planned(go)-60000);
  assert.equal(timing.planned({...standby,target_time:''}),null);
  assert.equal(timing.planned({...standby,lead_seconds:''}),null);
});
