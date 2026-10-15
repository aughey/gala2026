const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,csv}=require('./static/data-store');
const fs=require('node:fs');
const working=JSON.parse(fs.readFileSync('data/working.json'));
function fixture() {
 const values=new Map(),requests=[];
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let version='first';
 const fetcher=async(path,options)=>{requests.push([path,options]);return {ok:true,json:async()=>({working:structuredClone(working),baseline:working,fields:[],published_version:version})};};
 const make=()=>create({staticMode:true,storage,fetcher,scope:'/gala2026/'});
 return {make,requests,storage,version:v=>version=v};
}
test('static saves survive reload and never send writes or absolute requests',async()=>{
 const f=fixture(),store=f.make(),data=await store.read();
 data.working.cues[0].call='A local edit';data.working.revision=await store.save(data.working);
 const loaded=await f.make().read();assert.equal(loaded.working.cues[0].call,'A local edit');
 assert.equal(loaded.working.revision,working.revision+1);
 assert.ok(f.requests.every(([path,options])=>path==='data/show.json'&&!options));
});
test('stale tabs cannot overwrite newer revisions',async()=>{
 const f=fixture(),one=f.make(),two=f.make();
 const a=await one.read(),b=await two.read();await one.save(a.working);
 await assert.rejects(two.save(b.working),error=>error.conflict===true);
});
test('new deployments preserve local drafts and reset loads published show',async()=>{
 const f=fixture(),store=f.make(),data=await store.read();
 data.working.cues[0].call='Keep me';await store.save(data.working);
 f.version('second');const next=f.make();const loaded=await next.read();
 assert.equal(loaded.working.cues[0].call,'Keep me');assert.equal(loaded.newerPublished,true);
 next.reset();assert.equal((await next.read()).working.cues[0].call,working.cues[0].call);
});
test('CSV exports quotes, multiline cells, booleans and current edits',()=>{
 assert.equal(csv({cues:[{call:'One, "two"\nthree',confirmed:true}]},[['call','Caller script'],['confirmed','Reviewed']]),
 '"Caller script","Reviewed"\r\n"One, ""two""\nthree","True"\r\n');
});
test('storage failure leaves published data intact',async()=>{
 const f=fixture(),store=f.make(),data=await store.read();f.storage.setItem=()=>{throw new Error('Quota exceeded');};
 await assert.rejects(store.save(data.working),/Quota exceeded/);
 assert.equal((await store.read()).working.revision,working.revision);
});
