const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('./static/stage-state');
test('accumulates GO and SET; standby, notes and blank fields preserve known settings',()=>{
 const cues=[{id:'a',sequence:'1',kind:'set',podium:'Podium mic on.',stage:'Up'},
 {id:'b',sequence:'2',kind:'standby',podium:'Podium mic off.'},
 {id:'c',sequence:'3',kind:'note',stage:'Down'},
 {id:'d',sequence:'4',kind:'go',podium:'Podium mic off.',stage:''}];
 const before=S.before(cues,'d');assert.equal(before.podium.value,'Podium mic on.');assert.equal(before.stage.value,'Up');assert.equal(before.backlight,undefined);
 const after=S.apply(before,cues[3]);assert.equal(after.podium.value,'Podium mic off.');assert.equal(after.podium.sequence,'4');assert.equal(after.stage.value,'Up');assert.equal(before.podium.value,'Podium mic on.');
 assert.deepEqual(S.before(cues,'a'),{});
});
test('derives state from order for backward jumps and preserves unspecified initial state',()=>{
 const cues=[{id:'a',sequence:'1',kind:'go',house:'Up'},{id:'b',sequence:'2',kind:'go',house:'Down'}];
 assert.equal(S.before(cues,'b').house.value,'Up');assert.deepEqual(S.before(cues,'a'),{});assert.deepEqual(S.before(cues,'missing'),{});
});
test('does not imply off for unknown or interpret screen titles as equipment power',()=>{
 assert.equal(S.status('podium').kind,'unknown');assert.equal(S.status('stage',{value:'Down'}).kind,'off');
 assert.equal(S.status('choir',{value:'Four wireless mics on. Four choral mics on.'}).kind,'on');
 assert.equal(S.status('piano',{value:'Piano keyboard mic on. Volume to allow for conversation at tables.'}).kind,'on');
 assert.equal(S.status('screens',{value:'Slide - Lights off'}).kind,'specified');assert.equal(S.status('podium',{value:'First on, then off'}).kind,'specified');
});
