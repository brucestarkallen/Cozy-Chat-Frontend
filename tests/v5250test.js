// TEST FILE — run with: node tests/v5250test.js
// Guards v5.25.0: the phone keeps a copy. Served by its own Termux server,
// Cozy mirrors everything to cozy-vault.json on disk and a wiped browser is
// restored on open. The empty-over-full write can never happen, an
// intentional delete-all does empty the vault, and on any other host the app
// is exactly the PWA it was.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
/* the Termux server injects this tag when it serves the page — vault tests
   see the advertised build, every other test the plain one */
const htmlVault=html.replace('</head>','<meta name="cozy-vault" content="1"></head>');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
/* Cross-section cleanup goes through one long-lived window's own DB handle —
   deleting the database outright would block on every other window's open
   connection and hang the run, which is why the house fixtures never delete. */
let cleaner=null;
async function cleanSlate(){ await cleaner.window.eval('Promise.all([DB.clear(),DB.docClear()])'); }
const VAULT_BLOB={
  app:"cozy-chat",kind:"vault",version:"5.24.3",savedAt:"2026-09-02T00:00:00Z",
  settings:{providers:[],activeProvider:null,presets:[{id:'d',name:'D',system:'BASE',injections:[]}],activePreset:'d',
    prompts:[],projects:[],temperature:0.42,maxTokens:4096,effort:'off',squashSystem:true,
    showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'light',
    search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},
  conversations:[{id:'c1',title:'The Story So Far',createdAt:1,updatedAt:2,
    messages:[{id:'m1',role:'user',content:'hello from the past',ts:1},{id:'m2',role:'assistant',content:'I remember everything',ts:2}]}],
  docs:[{id:'d1',name:'canon.md',text:'The hero is Jovan Oda.',createdAt:1,updatedAt:1,mode:'full'}]};
/* a fetch that only speaks vault: GET answers from `served`, PUT is recorded */
function vaultFetch(w,served){
  w.__puts=[]; w.__gets=0;
  let blob=served;
  return (url,opts)=>{
    url=String(url);
    if (url.indexOf("api/vault")<0) return Promise.reject(new Error("no such endpoint"));
    const method=(opts&&opts.method)||"GET";
    if (method==="PUT"){
      w.__puts.push(opts.body);
      blob=JSON.parse(opts.body);
      return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({ok:true})});
    }
    w.__gets++;
    if (blob===null) return Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({error:"no vault yet"})});
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(blob)});
  };
}
function deadFetch(){return ()=>Promise.reject(new Error("offline"));}
function countingFetch(w){ w.__calls=[]; return (url,opts)=>{ w.__calls.push(String(url)); return Promise.reject(new Error("offline")); }; }
function boot(st,f,withVault){return new Promise(res=>{
  const dom=new JSDOM(withVault===false?html:htmlVault,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      if (st) w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if (f) w.fetch=f(w);
    }});
  setTimeout(()=>res(dom),750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const baseSettings=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'BASE',injections:[]}],activePreset:'d',
  prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});

(async()=>{

cleaner=await boot(null,null);
await sleep(800);

console.log('=== 1. A WIPED BROWSER MEETS ITS RESCUE COPY ===');
{
  await cleanSlate();
  const dom=await boot(null,w=>vaultFetch(w,VAULT_BLOB));
  const w=dom.window,d=w.document;
  await sleep(600);
  ck('the chats came back', w.eval('convos.length')===1 && w.eval('convos[0].title')==='The Story So Far', w.eval('convos[0] && convos[0].title'));
  ck('the messages came back', d.querySelector('#threadInner').textContent.indexOf('hello from the past')>=0);
  ck('the files came back', w.eval('docs.length')===1 && w.eval('docs[0].text')==='The hero is Jovan Oda.');
  ck('the settings came back too', w.eval('S.temperature')===0.42 && w.eval('S.theme')==='light');
  ck('and it says so out loud', d.querySelector('#toast').textContent.indexOf('Restored 1 chats and 1 files')>=0,
     d.querySelector('#toast').textContent);
  ck('the panel tells the user the disk has their back', d.querySelector('#vaultStat').textContent.indexOf('cozy-vault.json')>=0);
}

console.log('=== 2. A CLEAN FIRST RUN STAYS CLEAN ===');
{
  await cleanSlate();
  const dom=await boot(null,w=>vaultFetch(w,null));
  const w=dom.window,d=w.document;
  await sleep(400);
  ck('nothing to restore, nothing restored', w.eval('convos.length')===0 && d.querySelector('#toast').textContent.indexOf('Restored')<0);
  ck('the mirror is still promised', d.querySelector('#vaultStat').textContent.indexOf('cozy-vault.json')>=0);
}

console.log('=== 3. EVERY CHANGE MIRRORS TO DISK ===');
{
  await cleanSlate();
  const dom=await boot(baseSettings(),w=>vaultFetch(w,null));
  const w=dom.window;
  await sleep(300);
  w.eval('newConvo(); current.title="Mirror me";');
  await w.eval('persistConvo(current)');
  await sleep(1800);
  ck('a write went to the server', w.__puts.length>=1, String(w.__puts.length));
  const landed=w.__puts.map(b=>JSON.parse(b)).filter(v=>(v.conversations||[]).some(c=>c.title==='Mirror me'));
  ck('and it carries the chat', landed.length===1, String(w.__puts.length));
  ck('shaped like a backup anyone could restore', landed[0].app==='cozy-chat' && Array.isArray(landed[0].docs) && landed[0].settings && landed[0].settings.providers.length===1);
}

console.log('=== 4. NO SERVER, NO VAULT — THE APP IS THE PWA IT ALWAYS WAS ===');
{
  await cleanSlate();
  const dom=await boot(baseSettings(),w=>countingFetch(w),false);
  const w=dom.window,d=w.document;
  await sleep(300);
  w.eval('newConvo();');
  await w.eval('persistConvo(current)');
  await sleep(1600);
  ck('an unadvertised host is never even probed', w.__calls.filter(u=>u.indexOf('api/vault')>=0).length===0,
     w.__calls.join(','));
  ck('the panel says the honest thing', d.querySelector('#vaultStat').textContent.indexOf('No disk copy')>=0);
  ck('and the app works exactly as before', w.eval('convos.length')===1);
}

console.log('=== 5. DELETING EVERYTHING BY HAND EMPTIES THE VAULT TOO ===');
{
  await cleanSlate();
  const dom=await boot(baseSettings(),w=>vaultFetch(w,VAULT_BLOB));
  const w=dom.window;
  await sleep(300);
  await w.eval('(function(){convos=[];return DB.clear();})()');
  await sleep(1800);
  const empties=w.__puts.map(b=>JSON.parse(b)).filter(v=>(v.conversations||[]).length===0 && !(v.docs||[]).length);
  ck('the empty state reached the vault — it was a choice, not a wipe', empties.length>=1, String(w.__puts.length));
}

console.log('=== 6. A BROWSER WIPED UNDER A RUNNING APP CANNOT BURN THE VAULT ===');
{
  await cleanSlate();
  const dom=await boot(baseSettings(),w=>vaultFetch(w,VAULT_BLOB));
  const w=dom.window;
  await sleep(300);
  w.eval('newConvo();');
  await w.eval('persistConvo(current)');
  await sleep(1800);
  const before=w.__puts.length;
  ck('healthy mirroring first', before>=1);
  // the user clears site data with the app still open: storage vanishes
  await w.eval('localStorage.clear()');
  await w.eval('Promise.all([DB.clear(),DB.docClear()])');
  await sleep(1800);
  ck('not one empty write got through', w.__puts.length===before, String(w.__puts.length-before));
}

console.log('=== 7. THE PLUMBING, PINNED ===');
{
  const sw=fs.readFileSync(__dirname+'/../sw.js','utf8');
  ck('the service worker never caches the vault', sw.indexOf('url.pathname.indexOf("/api/")')>=0);
  ck('the shipped page carries no tag — static hosts are never probed', html.indexOf('<meta name="cozy-vault" content="1">')<0);
  const py=fs.readFileSync(__dirname+'/../serve.py','utf8');
  ck('the server injects it at serve time instead', py.indexOf('cozy-vault')>=0 && py.indexOf('def _serve_index')>=0);
  ck('the server takes writes', py.indexOf('def do_PUT')>=0);
  ck('writes land atomically', py.indexOf('os.replace(')>=0);
  ck('and garbage is refused before it can overwrite', py.indexOf('not a cozy vault blob')>=0 && py.indexOf('VAULT_LIMIT')>=0);
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
