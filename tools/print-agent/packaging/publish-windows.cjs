const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),dest=path.resolve(root,'../../public/downloads');
const metadata=JSON.parse(fs.readFileSync(path.join(dist,'checksums.json'),'utf8'));
if(metadata.version!==require('../package.json').version)throw Error('Version mismatch');
const source=fs.readFileSync(path.join(root,'ironwaves-print-agent.js'),'utf8').replace(/\r\n/g,'\n');
const sourceHashes=[source,source.replace(/\n/g,'\r\n')].map(text=>crypto.createHash('sha256').update(text).digest('hex'));
if(!sourceHashes.includes(metadata.source_sha256))throw Error('Source changed since package build');
for(const name of ['ironwaves-print-agent-setup.exe','ironwaves-print-agent-windows.zip']){
 const data=fs.readFileSync(path.join(dist,name));if(crypto.createHash('sha256').update(data).digest('hex')!==metadata.artifacts[name].sha256)throw Error('Artifact checksum mismatch');
}
for(const name of ['ironwaves-print-agent-setup.exe','ironwaves-print-agent-windows.zip'])fs.copyFileSync(path.join(dist,name),path.join(dest,name));
fs.writeFileSync(path.join(dest,'print-agent-windows-checksums.json'),JSON.stringify(metadata,null,2)+'\n');
