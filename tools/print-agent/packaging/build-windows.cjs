const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const version = require('../package.json').version;
fs.mkdirSync(dist, {recursive:true});
const run = (cmd,args) => execFileSync(cmd,args,{cwd:root,stdio:'inherit'});
const flags = new Set(process.argv.slice(2));
if (!flags.size) {
  const pkg = require('../node_modules/@yao-pkg/pkg/package.json');
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.pkg;
  run(process.execPath,[path.join(root,'node_modules/@yao-pkg/pkg',bin),'ironwaves-print-agent.js','--targets','node22-win-x64','--output','dist/ironwaves-print-agent.exe','--public','--no-bytecode']);
}
if (!flags.has('--zip-only')) {
  const nsis = process.env.MAKENSIS || (process.platform==='win32' ? 'C:\\Program Files (x86)\\NSIS\\makensis.exe' : 'makensis');
  const prefix = process.platform==='win32' ? '/' : '-';
  run(nsis,[`${prefix}DAPP_ROOT=${root}`,`${prefix}DVERSION=${version}`,path.join(__dirname,'installer.nsi')]);
}
if (!flags.has('--installer-only')) {
  const files=['dist/ironwaves-print-agent-setup.exe','setup.bat','setup-windows.ps1','README.txt'];
  const archive=path.join(dist,'ironwaves-print-agent-windows.zip');
  if(process.platform==='win32') {
    const quote=s=>"'"+s.replace(/'/g,"''")+"'";
    run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath @(${files.map(f=>quote(path.join(root,f))).join(',')}) -DestinationPath ${quote(archive)} -Force`]);
  } else run('zip',['-j','-9',archive,...files]);
}
const artifacts=['ironwaves-print-agent.exe','ironwaves-print-agent-setup.exe','ironwaves-print-agent-windows.zip'].filter(n=>fs.existsSync(path.join(dist,n)));
const hashes=Object.fromEntries(artifacts.map(n=>[n,{sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dist,n))).digest('hex'),bytes:fs.statSync(path.join(dist,n)).size}]));
fs.writeFileSync(path.join(dist,'checksums.json'),JSON.stringify({version,source_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'ironwaves-print-agent.js'))).digest('hex'),artifacts:hashes},null,2)+'\n');
