const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const source = fs.readFileSync(path.join(__dirname, '..', 'ironwaves-print-agent.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function harness(t, root, platform='win32') {
  root ||= fs.mkdtempSync(path.join(os.tmpdir(), 'iw-print-test-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  let handler;
  const context = { Buffer, URL, setTimeout, console:{log(){},warn(){},error(){}}, process:{platform,env:{}}, require(name) {
    if(name==='os') return {homedir:()=>root,tmpdir:()=>root};
    if(name==='http') return {createServer(fn){handler=fn;return {on(){},listen(){throw new Error('Test must not listen');}};}};
    if(name==='child_process') return {execFile(){throw new Error('Physical printing is forbidden in tests');},spawn(){throw new Error('No browser spawning in tests');},exec(){throw new Error('No OS mutation in tests');}};
    return require(name);
  }};
  vm.createContext(context);
  vm.runInContext(source.replace(/startServer\(\);\s*$/, '') + `\nglobalThis.api={submit:submitPrintJob,read:readJob,raw:printRaw,html:printHtml,rawInternal:printRawInternal,queue:queuePrinterTask,queues:rawPrinterQueues,fs,root:jobDirectory(),native:RAW_EXE_PATH};\nresolvePrintTarget=async p=>String(p.printer_name||'DEFAULT').trim();`, context);
  return {context,api:context.api,root,run:s=>vm.runInContext(s,context),request:async(method,url,payload)=>{
    const req=Readable.from(payload===undefined?[]:[JSON.stringify(payload)]);Object.assign(req,{method,url,headers:{}});
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body?JSON.parse(body):null;}};
    await handler(req,res);return res;
  }};
}
const job = (id='job_1234567890123456',raw='ticket')=>({job_id:id,raw,printer_name:'Kitchen'});
test('RAW on a different printer proceeds while the first printer is blocked', async t=>{
 const h=harness(t),gate=deferred(),seen=[];h.context.work=async(p)=>{seen.push(p.printer_name);if(p.printer_name==='Cash')await gate.promise;};h.run('printRawInternal=work');
 const a=h.api.raw({printer_name:'Cash'});await tick();await h.api.raw({printer_name:'Kitchen'});assert.deepEqual(seen,['Cash','Kitchen']);gate.resolve();await a;
});
test('same resolved printer aliases remain FIFO',async t=>{
 const h=harness(t),gate=deferred(),seen=[];h.context.work=async p=>{seen.push(p.n);if(p.n===1)await gate.promise;};h.run('printRawInternal=work');
 const a=h.api.raw({printer_name:' Kitchen ',n:1}),b=h.api.raw({printer_name:'kitchen',n:2});await tick();assert.deepEqual(seen,[1]);gate.resolve();await Promise.all([a,b]);assert.deepEqual(seen,[1,2]);await tick();assert.equal(h.api.queues.size,0);
});
test('HTML keeps the global default-printer lock across printers',async t=>{
 const h=harness(t),gate=deferred(),seen=[];h.context.work=async p=>{seen.push(p.n);if(p.n===1)await gate.promise;};h.run('printHtmlInternal=work');
 const a=h.api.html({printer_name:'Cash',n:1}),b=h.api.html({printer_name:'Kitchen',n:2});await tick();assert.deepEqual(seen,[1]);gate.resolve();await Promise.all([a,b]);assert.deepEqual(seen,[1,2]);
});
test('RAW bypasses HTML on another printer but waits for HTML on its own printer',async t=>{
 const h=harness(t),gate=deferred(),seen=[];h.context.work=async()=>{seen.push('html');await gate.promise;};h.context.rawWork=async p=>seen.push(p.printer_name);h.run('printHtmlInternal=work;printRawInternal=rawWork');
 const a=h.api.html({printer_name:'Cash'});await tick();const b=h.api.raw({printer_name:'Cash'});await h.api.raw({printer_name:'Kitchen'});assert.deepEqual(seen,['html','Kitchen']);gate.resolve();await Promise.all([a,b]);assert.deepEqual(seen,['html','Kitchen','Cash']);
});
test('a failed job releases its printer queue',async t=>{
 const h=harness(t);await assert.rejects(h.api.queue('Kitchen',async()=>{throw Error('offline');}));assert.equal(await h.api.queue('Kitchen',async()=>42),42);
});
test('concurrent submissions with one ID spool exactly once',async t=>{
 const h=harness(t),gate=deferred();let calls=0;h.context.work=async()=>{calls++;await gate.promise;};h.run('printRawInternal=work');
 const first=h.api.submit('raw',job());for(let i=0;i<20;i++)h.api.submit('raw',job());await tick();assert.equal(calls,1);assert.equal(first.status,'queued');gate.resolve();await tick();assert.equal(h.api.read(job().job_id).status,'submitted');
});
test('same ID with different content or print engine is rejected',t=>{
 const h=harness(t);h.run('printRawInternal=async()=>{}');h.api.submit('raw',job());assert.throws(()=>h.api.submit('raw',job(undefined,'different')),e=>e.statusCode===409);assert.throws(()=>h.api.submit('html',{...job(),html:'ticket'}),e=>e.statusCode===409);
});
test('submitted IDs survive agent restart without replay and journal has no receipt content',async t=>{
 const h=harness(t);h.run('printRawInternal=async()=>{}');h.api.submit('raw',job(undefined,'SECRET_RECEIPT_TEXT'));await tick();
 const stored=fs.readFileSync(path.join(h.api.root,job().job_id+'.json'),'utf8');assert(!stored.includes('SECRET_RECEIPT_TEXT'));
 const restarted=harness(t,h.root);let calls=0;restarted.context.work=async()=>calls++;restarted.run('printRawInternal=work');assert.equal(restarted.api.submit('raw',job(undefined,'SECRET_RECEIPT_TEXT')).status,'submitted');await tick();assert.equal(calls,0);
});
test('an interrupted job becomes unknown after restart and never replays',async t=>{
 const h=harness(t),gate=deferred();h.context.work=()=>gate.promise;h.run('printRawInternal=work');h.api.submit('raw',job());await tick();
 const restarted=harness(t,h.root);assert.equal(restarted.api.submit('raw',job()).status,'unknown');gate.resolve();await tick();
});
test('journal write failure prevents the spool attempt',async t=>{
 const h=harness(t);let calls=0;h.context.work=async()=>calls++;h.run('printRawInternal=work');h.api.read(job().job_id);const original=fs.openSync;
 try{fs.openSync=()=>{throw Error('disk full');};assert.throws(()=>h.api.submit('raw',job()),/disk full/);}finally{fs.openSync=original;}
 await tick();assert.equal(calls,0);
});
test('native spool failure never starts PowerShell as a second print',async t=>{
 const h=harness(t);fs.writeFileSync(h.api.native,'synthetic');let calls=0;h.context.command=async()=>{calls++;throw Error('lost ack');};h.run('runCommand=command;runPowerShell=async()=>{throw Error("Unexpected duplicate PowerShell print")};');
 await assert.rejects(h.api.rawInternal({raw:'ticket'},'Kitchen'),/lost ack/);assert.equal(calls,1);
});
test('RAW trailing feed bytes are preserved',async t=>{
 const h=harness(t,undefined,'darwin');let bytes;h.context.command=async(cmd,args)=>{bytes=fs.readFileSync(args.at(-1),'latin1');};h.run('runCommand=command');await h.api.rawInternal({raw:'\x1b@ticket\n\n'},'Kitchen');assert.equal(bytes,'\x1b@ticket\n\n');
});
test('job protocol returns 202 immediately, supports status, conflict, and health',async t=>{
 const h=harness(t),gate=deferred();h.context.work=()=>gate.promise;h.run('printRawInternal=work');
 const accepted=await h.request('POST','/print-raw',job());assert.equal(accepted.status,202);assert.equal(accepted.body.job.job_id,job().job_id);
 assert.equal((await h.request('GET','/health')).body.capabilities.print_jobs,true);
 assert.equal((await h.request('GET','/jobs/'+job().job_id)).status,200);
 assert.equal((await h.request('POST','/print-raw',job(undefined,'changed'))).status,409);
 assert.equal((await h.request('GET','/jobs/invalid')).status,400);
 gate.resolve();await tick();
});
test('legacy callers still wait for submission and manual reprints with new IDs remain possible',async t=>{
 const h=harness(t);let calls=0;h.context.work=async()=>{calls++;return {method:'mock'};};h.run('printRawInternal=work');
 const legacy=await h.request('POST','/print-raw',{raw:'ticket',printer_name:'Kitchen'});assert.equal(legacy.status,200);
 h.api.submit('raw',job());h.api.submit('raw',job('manual_1234567890123'));await tick();assert.equal(calls,3);
});
test('concurrent cold printer discovery shares one PowerShell enumeration',async t=>{
 const h=harness(t),gate=deferred();let calls=0;h.context.enumerate=async()=>{calls++;await gate.promise;return JSON.stringify([{Name:'Kitchen',Default:true}]);};h.run('runPowerShell=enumerate;globalThis.enumeration=()=>listPrinters()');
 const a=h.context.enumeration(),b=h.context.enumeration();assert.equal(calls,1);gate.resolve();await Promise.all([a,b]);await h.context.enumeration();assert.equal(calls,1);
});
test('spool failure stays unknown and retries with the same ID do not spool again',async t=>{
 const h=harness(t);let calls=0;h.context.work=async()=>{calls++;throw Error('partial submission');};h.run('printRawInternal=work');h.api.submit('raw',job());await tick();assert.equal(h.api.read(job().job_id).status,'unknown');h.api.submit('raw',job());await tick();assert.equal(calls,1);
});
test('corrupt journal and full journal fail closed before any print',async t=>{
 const h=harness(t);let calls=0;h.context.work=async()=>calls++;h.run('printRawInternal=work');h.api.read(job().job_id);h.run('journalCount=10000');assert.throws(()=>h.api.submit('raw',job()),/journal is full/);await tick();assert.equal(calls,0);
 const damaged=harness(t);fs.mkdirSync(damaged.api.root,{recursive:true});fs.writeFileSync(path.join(damaged.api.root,job().job_id+'.json'),'{bad json');assert.throws(()=>damaged.api.submit('raw',job()));
});
