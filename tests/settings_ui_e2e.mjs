// Isolated UI test only: all tenant writes are fulfilled locally, never forwarded.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const dir='outputs/settings-redesign-2026-11-21';await fs.mkdir(dir,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const writes=[],errors=[];let failSettings=false;let allowWrites=false;let partialFailure=false;
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
 if(url.port==='17777')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname==='/printers'?{printers:[]}:{ok:true,version:'0.6.1'})});
 if(url.pathname.startsWith('/api/')){
  if(!['GET','OPTIONS','HEAD'].includes(req.method())){writes.push({path:url.pathname,method:req.method(),body:req.postDataJSON()});if(allowWrites)return route.fulfill({status:partialFailure&&url.pathname.includes('table-service')?503:200,contentType:'application/json',body:JSON.stringify({success:true})});return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Audit only: writes blocked"}'});}
  if(failSettings&&url.pathname.endsWith('/settings'))return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"synthetic load failed"}'});
  const data=url.pathname.includes('business-profile')?{company_name:'Audit Café',phone:'',address:''}:url.pathname.endsWith('/settings')?{print_settings:{printer_name:'AUDIT-CASH',kitchen_printer_name:'AUDIT-KITCHEN',paper_width:'58mm',print_engine:'raw_escpos'},session_settings:{staff_pin_length:4,theme_mode:'dark'},role_modules:{staff:['pos'],manager:['pos'],kitchen:['kds']}}:[];
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 }
 return route.continue();
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:18179/tests/settings-ui/index.html');await page.getByText('Biznes Profili',{exact:true}).waitFor();await page.waitForTimeout(1000);
async function metrics(){return page.evaluate(()=>{const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');return {height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,viewport:innerWidth,visiblePanels:[...document.querySelectorAll('[id^="sec-"]')].filter(visible).map(e=>({id:e.id,height:Math.round(e.getBoundingClientRect().height),controls:e.querySelectorAll('input,select,textarea,button').length})),tabs:[...document.querySelectorAll('[role="tab"]')].map(e=>({text:e.innerText,name:e.getAttribute('aria-label')})),unlabelledControls:[...document.querySelectorAll('input,select,textarea')].filter(visible).filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>({tag:e.tagName,placeholder:e.getAttribute('placeholder')}))};});}
const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
await check('One settings form is visible',async()=>{const m=await metrics();if(m.visiblePanels.length!==1)throw Error(JSON.stringify(m.visiblePanels));});
await page.getByLabel('Şirkət adı',{exact:true}).fill('Draft café');
await check('Unsaved changes are shown',async()=>{await page.getByText('bölmədə saxlanmamış dəyişiklik var',{exact:false}).waitFor();});
await page.getByRole('button',{name:'Əməliyyat',exact:true}).click();
await check('Only print form visible in operations',async()=>{const m=await metrics();if(m.visiblePanels.length!==1||m.visiblePanels[0].id!=='sec-print')throw Error('Wrong form');});
await page.getByRole('button',{name:'Ümumi',exact:true}).click();
await check('Draft survives category navigation',async()=>{if(await page.getByLabel('Şirkət adı',{exact:true}).inputValue()!=='Draft café')throw Error('Draft lost');});
await page.getByRole('button',{name:'Bu bölmədəki dəyişiklikləri geri al',exact:true}).click();
await check('Discard restores loaded value',async()=>{if(await page.getByLabel('Şirkət adı',{exact:true}).inputValue()!=='Audit Café')throw Error('Discard failed');});
await page.getByLabel('Ayar axtar',{exact:true}).fill('VÖEN');
await check('VOEN search finds profile',async()=>{await page.getByRole('button',{name:'Profil',exact:true}).waitFor();});
await page.getByRole('button',{name:'Əməliyyat',exact:true}).click();
await check('Category selection clears search',async()=>{if(await page.getByLabel('Ayar axtar',{exact:true}).inputValue()!=='')throw Error('Query retained');});
await page.screenshot({path:'outputs/settings-redesign-2026-11-21/desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});
await check('Mobile categories retain visible names and no page overflow',async()=>{await page.getByRole('button',{name:'Əməliyyat',exact:true}).waitFor();const m=await metrics();if(m.width>m.viewport+2)throw Error('Horizontal page overflow');});
await page.screenshot({path:'outputs/settings-redesign-2026-11-21/mobile.png',fullPage:true});
await page.setViewportSize({width:1440,height:1000});
allowWrites=true;
await page.getByRole('button',{name:'Təhlükəsizlik',exact:true}).click();
const idle=page.locator('#sec-security input[type="number"]').first();await idle.fill('17');
await page.getByRole('button',{name:'İnterfeys',exact:true}).click();
await page.getByRole('button',{name:'Light',exact:true}).click();
await page.waitForTimeout(300);
await check('Theme autosave submits only theme, never draft security fields',async()=>{
 const sent=writes.filter(r=>r.path.endsWith('/settings/session')).at(-1);if(JSON.stringify(sent?.body)!==JSON.stringify({theme_mode:'light'}))throw Error(JSON.stringify(sent));
});
await page.getByRole('button',{name:'Virtual klaviatura',exact:true}).click();await page.waitForTimeout(300);
await check('Keyboard autosave submits only its own setting',async()=>{const sent=writes.filter(r=>r.path.endsWith('/settings/session')).at(-1);if(Object.keys(sent?.body||{}).join(',')!=='virtual_keyboard_enabled')throw Error(JSON.stringify(sent));});
await page.getByRole('button',{name:'Təhlükəsizlik',exact:true}).click();
await check('Theme save preserves unsaved security draft',async()=>{if(await page.locator('#sec-security input[type="number"]').first().inputValue()!=='17')throw Error('Security draft lost');});
await page.getByRole('button',{name:'Ümumi',exact:true}).click();await page.getByLabel('Şirkət adı',{exact:true}).fill('Saved café');
await page.locator('#sec-profile').getByRole('button',{name:'Saxla',exact:true}).click();await page.waitForTimeout(500);
await check('Successful profile save clears only its own dirty flag',async()=>{if(await page.getByRole('button',{name:'Bu bölmədəki dəyişiklikləri geri al',exact:true}).count())throw Error('Profile remained dirty');});
await page.getByRole('button',{name:'Əməliyyat',exact:true}).click();await page.getByRole('button',{name:'Masalar',exact:true}).click();
partialFailure=true;await page.locator('#sec-tables').getByRole('button',{name:'Yadda saxla',exact:true}).click();await page.waitForTimeout(700);
await check('Partial multi-request save explains what already succeeded',async()=>{if(!(await page.locator('#audit-messages').innerText()).includes('Servis haqqı saxlandı'))throw Error(await page.locator('#audit-messages').innerText());});
partialFailure=false;
// A fresh browser context has no cached success and cannot edit on a failed GET.
failSettings=true;const failed=await context.newPage();await failed.goto('http://127.0.0.1:18179/tests/settings-ui/index.html');await failed.getByText('Mövcud ayarlar yüklənmədi.',{exact:false}).waitFor({timeout:20000});
await check('Failed fresh settings load blocks editing and exposes retry',async()=>{if(await failed.getByLabel('Şirkət adı',{exact:true}).isEnabled())throw Error('Editing enabled after failure');await failed.getByRole('button',{name:'Yenidən yoxla',exact:true}).waitFor();});
failSettings=false;await failed.getByRole('button',{name:'Yenidən yoxla',exact:true}).click();await failed.waitForTimeout(500);
await check('Retry restores verified form editing',async()=>{if(!await failed.getByLabel('Şirkət adı',{exact:true}).isEnabled())throw Error('Retry did not unlock editing');});
await failed.close();
await fs.writeFile('outputs/settings-redesign-2026-11-21/browser-results.json',JSON.stringify({results,errors,writes,metrics:await metrics()},null,2));await browser.close();
if(errors.length)throw Error(errors.join(';'));
