import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('tests/.build',{recursive:true});
await build({entryPoints:['src/lib/local_print_agent.ts'],bundle:true,platform:'node',format:'esm',external:['./qz'],outfile:'tests/.build/print_agent_client.mjs',logLevel:'silent'});
const {printDirectOrFallback}=await import('./.build/print_agent_client.mjs');
await build({entryPoints:['src/lib/print_kitchen_ticket.ts'],bundle:true,platform:'node',format:'esm',external:['./qz'],outfile:'tests/.build/print_kitchen_client.mjs',logLevel:'silent'});
const {printKitchenTicket}=await import('./.build/print_kitchen_client.mjs');
const ok=(body={},status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const id='client_job_1234567890123';
function setup(t,fetcher){
 const before={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};const calls=[],browser={prints:0};
 globalThis.window={setTimeout:(fn,ms)=>setTimeout(fn,ms>=6000?10:ms),clearTimeout};
 globalThis.document={getElementById:()=>null,body:{appendChild(){},removeChild(){}},createElement:()=>({style:{},contentWindow:{document:{open(){},write(){},close(){}},focus(){},print(){browser.prints++;}}})};
 globalThis.fetch=async(url,options)=>{calls.push({url,options,body:options.body?JSON.parse(options.body):null});return fetcher(url,options);};
 t.after(()=>Object.assign(globalThis,before));return {calls,browser};
}
const opts={rawCommands:'RAW\n\n',printerName:'Kitchen',jobId:id,allowBrowserFallback:true};
const health=()=>ok({capabilities:{print_jobs:true}});
test('RAW success sends one POST and never starts browser or HTML',async t=>{
 const h=setup(t,async url=>url.endsWith('/health')?health():ok({job:{job_id:id,status:'submitted'}},202));
 const r=await printDirectOrFallback('<html>ticket</html>',opts);assert.equal(r.success,true);assert.equal(r.method,'agent');assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(h.calls.at(-1).body.raw,'RAW\n\n');assert.equal(h.browser.prints,0);
});
test('new agent queue acceptance is explicitly pending, not physical print confirmation',async t=>{
 setup(t,async url=>url.endsWith('/health')?health():ok({job:{job_id:id,status:'queued'}},202));const r=await printDirectOrFallback('ticket',opts);assert.equal(r.success,true);assert.equal(r.pending,true);assert.equal(r.jobId,id);
});
test('lost POST acknowledgement recovers the same job without resubmission',async t=>{
 const h=setup(t,async(url)=>{if(url.endsWith('/health'))return health();if(url.includes('/jobs/'))return ok({job:{job_id:id,status:'processing'}});throw Error('lost acknowledgement');});
 const r=await printDirectOrFallback('ticket',opts);assert.equal(r.success,true);assert.equal(r.pending,true);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert(h.calls.at(-1).url.endsWith('/jobs/'+id));assert.equal(h.browser.prints,0);
});
test('unknown or unobservable job never falls back to HTML or browser',async t=>{
 for(const status of ['unknown','missing']){
  const h=setup(t,async url=>url.endsWith('/health')?health():url.includes('/jobs/')?ok({job:{job_id:id,status}},status==='missing'?404:200):Promise.reject(Error('lost ack')));
  const r=await printDirectOrFallback('ticket',opts);assert.equal(r.success,false);assert.match(r.error,/Təkrar/);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(h.browser.prints,0);
 }
});
test('legacy agent timeout after acceptance cannot trigger a second engine',async t=>{
 const h=setup(t,async(url,options)=>{if(url.endsWith('/health'))return ok({version:'0.5.8'});return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout'))));});
 const r=await printDirectOrFallback('ticket',opts);assert.equal(r.success,false);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(h.calls.length,2);assert.equal(h.browser.prints,0);
});
test('HTTP spool failure also cannot trigger a second engine',async t=>{
 const h=setup(t,async url=>url.endsWith('/health')?ok({}):ok({},500));const r=await printDirectOrFallback('ticket',opts);assert.equal(r.success,false);assert.equal(h.calls.length,2);assert.equal(h.browser.prints,0);
});
test('job ID conflict is not confused with the previous successful job',async t=>{
 const h=setup(t,async url=>url.endsWith('/health')?health():ok({},409));const r=await printDirectOrFallback('ticket',opts);assert.equal(r.success,false);assert.equal(h.calls.length,2);
});
test('browser fallback is allowed only after a preflight failure, with no agent POST',async t=>{
 const h=setup(t,async()=>{throw Error('agent offline');});const r=await printDirectOrFallback('ticket',opts);assert.equal(r.method,'browser');assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'GET');
});
test('disabled browser fallback remains disabled when agent is offline',async t=>{
 const h=setup(t,async()=>{throw Error('agent offline');});const r=await printDirectOrFallback('ticket',{...opts,allowBrowserFallback:false});assert.equal(r.success,false);assert.equal(h.calls.length,1);assert.equal(h.browser.prints,0);
});
test('HTML requested explicitly is submitted once with the same ID',async t=>{
 const h=setup(t,async url=>url.endsWith('/health')?health():ok({job:{job_id:id,status:'submitted'}},202));await printDirectOrFallback('ticket',{...opts,preferHtml:true});assert(h.calls.at(-1).url.endsWith('/print-html'));assert.equal(h.calls.at(-1).body.job_id,id);assert.equal(h.calls.at(-1).body.raw,undefined);
});
test('caller can reuse an explicit job ID while ordinary manual reprints get new IDs',async t=>{
 const h=setup(t,async(url,options)=>url.endsWith('/health')?health():ok({job:{job_id:JSON.parse(options.body).job_id,status:'submitted'}},202));await printDirectOrFallback('ticket',opts);await printDirectOrFallback('ticket',opts);await printDirectOrFallback('ticket',{...opts,jobId:undefined});await printDirectOrFallback('ticket',{...opts,jobId:undefined});const ids=h.calls.filter(c=>c.body).map(c=>c.body.job_id);assert.equal(ids[0],ids[1]);assert.notEqual(ids[2],ids[3]);
});

test('concurrent KDS auto-print calls use one stable tenant-origin job ID; manual reprint uses a new one',async t=>{
 const saved=globalThis.localStorage;const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};t.after(()=>{globalThis.localStorage=saved;});
 const h=setup(t,async(url,options)=>url.endsWith('/health')?health():ok({job:{job_id:JSON.parse(options.body).job_id,status:'queued'}},202));globalThis.window.location={origin:'https://synthetic.ironwaves.store'};
 const ticket={ticket_id:'synthetic-ticket',table_label:'Synthetic',created_at:'2026-11-21T08:00:00Z',items:[{item_name:'Synthetic coffee',qty:1}]};
 const options={ticket,printerName:'Kitchen',dedupe:true,dedupeKey:'kds:Kitchen:synthetic-ticket'};
 await Promise.all([printKitchenTicket(options),printKitchenTicket(options)]);
 const ids=h.calls.filter(c=>c.body).map(c=>c.body.job_id);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.match(ids[0],/^kds_[a-f0-9]{64}$/);
 await printKitchenTicket({...options,dedupe:false});const last=h.calls.at(-1).body.job_id;assert.notEqual(last,ids[0]);
});
test('legacy agent without a RAW route can safely use HTML after explicit 404',async t=>{
 const h=setup(t,async url=>url.endsWith('/health')?ok({version:'0.2.0'}):url.endsWith('/print-raw')?ok({},404):ok({ok:true}));
 const r=await printDirectOrFallback('ticket',{...opts,allowBrowserFallback:false});assert.equal(r.success,true);assert.equal(r.method,'agent');assert.deepEqual(h.calls.filter(c=>c.body).map(c=>c.url.split('/').at(-1)),['print-raw','print-html']);assert.equal(h.browser.prints,0);
});
