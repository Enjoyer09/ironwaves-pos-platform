import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.argv[2];
if(!base)throw Error('Pass a server base URL');
const expected=JSON.parse(await fs.readFile(new URL('../../../public/downloads/print-agent-windows-checksums.json',import.meta.url),'utf8'));
const manifestResponse=await fetch(base+'/downloads/print-agent-latest.json');assert.equal(manifestResponse.status,200);assert.match(manifestResponse.headers.get('cache-control'),/no-cache/);
const manifest=await manifestResponse.json();assert.equal(manifest.latest_windows_version,expected.version);
const results=[];
for(const name of ['ironwaves-print-agent-setup.exe','ironwaves-print-agent-windows.zip']){
 const metadata=expected.artifacts[name];const url=base+'/downloads/'+name;
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.match(head.headers.get('cache-control'),/no-cache/);assert.equal(Number(head.headers.get('content-length')),metadata.bytes);assert.equal((await head.arrayBuffer()).byteLength,0);
 const response=await fetch(url);assert.equal(response.status,200);const hash=crypto.createHash('sha256');let bytes=0,signature;
 for await(const chunk of response.body){signature||=Buffer.from(chunk).subarray(0,4);bytes+=chunk.length;hash.update(chunk);}
 assert.equal(bytes,metadata.bytes);assert.equal(hash.digest('hex'),metadata.sha256);
 assert.equal(signature.subarray(0,2).toString(),name.endsWith('.exe')?'MZ':'PK');results.push({file:name,status:200,bytes,sha256_verified:true});
}
const checksumResponse=await fetch(base+'/downloads/print-agent-windows-checksums.json');assert.equal(checksumResponse.status,200);assert.deepEqual(await checksumResponse.json(),expected);
console.log(JSON.stringify({base,version:expected.version,downloads:results,manifest_verified:true}));
