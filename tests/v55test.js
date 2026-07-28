// TEST FILE — run with: node tests/v55test.js
// Guards v5.5.0: forgetting an archived chat no longer loses it. The count
// row in the sidebar is a door, not a taunt: it opens a browsable list of
// every archived chat with enough of its tail to recognise it. From there a
// chat can be read where it lies, put back in the list, or deleted — and the
// same browser opens from Settings → Data.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],projects:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const click=(w,el)=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
const sleep=ms=>new Promise(r=>setPromiseTimeout(r,ms));
function setPromiseTimeout(r,ms){setTimeout(r,ms);}

(async()=>{

console.log('=== 1. THE COUNT ROW IS A DOOR ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  await w.eval(`(async function(){
    newConvo(); current.title="Zanpakuto lore"; current.messages.push({id:uid(),role:"user",content:"tell me about the release phrase and its history",ts:Date.now()});
    await persist();
    newConvo(); current.title="Grocery list"; current.messages.push({id:uid(),role:"user",content:"eggs and rice",ts:Date.now()});
    await persist();
    newConvo(); current.title="Stays live";
    await persist();
  })()`);
  await sleep(120);
  // archive the first two through the UI
  for (const t of ['Zanpakuto lore','Grocery list']){
    const row=[...d.querySelectorAll('#convoList .convo')].find(r=>r.textContent.indexOf(t)>=0);
    click(w, row.querySelector('[data-arch]'));
    await sleep(80);
  }
  const door=d.querySelector('[data-openarch]');
  ck('the sidebar row is tappable and counts', !!door && /2 archived/.test(door.textContent) && /tap to browse/.test(door.textContent),
     door?door.textContent.trim():'no door');
  ck('nothing about searching from memory', !/search to find/.test(d.querySelector('#convoList').textContent));
  click(w,door); await sleep(80);
  ck('tapping opens the archive', d.querySelector('#archModal').classList.contains('show'));
  const rows=[...d.querySelectorAll('#archList .arch-row')];
  ck('every archived chat is listed', rows.length===2, String(rows.length));
  ck('with its title', rows.some(r=>r.textContent.indexOf('Zanpakuto lore')>=0));
  ck('and enough tail to recognise it', rows.some(r=>r.textContent.indexOf('release phrase')>=0));
  ck('the head counts too', /2/.test(d.querySelector('#archCount').textContent));
}

console.log('=== 2. READ IT WHERE IT LIES ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  await w.eval(`(async function(){
    newConvo(); current.title="Old plan"; current.messages.push({id:uid(),role:"user",content:"the forgotten plan",ts:Date.now()});
    current.archived=true; await persist();
    newConvo(); current.title="Live one"; await persist();
  })()`);
  await sleep(120);
  w.eval('renderSidebar()');
  click(w,d.querySelector('[data-openarch]')); await sleep(80);
  click(w,d.querySelector('#archList .arch-row')); await sleep(100);
  ck('tapping a row opens that chat', w.eval('current.title')==='Old plan');
  ck('still archived — reading is not unarchiving', w.eval('current.archived')===true);
  ck('the browser closed behind it', !d.querySelector('#archModal').classList.contains('show'));
  ck('the thread shows it', d.querySelector('#chatTitle').textContent==='Old plan');
}

console.log('=== 3. PUT BACK, OR DELETE ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  await w.eval(`(async function(){
    newConvo(); current.title="Comes back"; current.archived=true; await persist();
    newConvo(); current.title="Goes away"; current.archived=true; await persist();
    newConvo(); current.title="Live"; await persist();
  })()`);
  await sleep(120);
  w.eval('renderSidebar()');
  click(w,d.querySelector('[data-openarch]')); await sleep(80);
  const back=[...d.querySelectorAll('#archList .arch-row')].find(r=>r.textContent.indexOf('Comes back')>=0);
  click(w, back.querySelector('[data-archback]')); await sleep(120);
  ck('unarchive returns it to the sidebar', [...d.querySelectorAll('#convoList .convo')].some(r=>r.textContent.indexOf('Comes back')>=0));
  ck('and out of the archive list', ![...d.querySelectorAll('#archList .arch-row')].some(r=>r.textContent.indexOf('Comes back')>=0));
  ck('persisted, not cosmetic', await (async function(){
    return new Promise(res=>{const r=w.indexedDB.open('cozychat',2);r.onsuccess=()=>{
      const t=r.result.transaction('convos').objectStore('convos').getAll();
      t.onsuccess=()=>res(t.result.find(c=>c.title==='Comes back').archived===false);};});
  })());
  const gone=[...d.querySelectorAll('#archList .arch-row')].find(r=>r.textContent.indexOf('Goes away')>=0);
  click(w, gone.querySelector('[data-archdel]')); await sleep(120);
  ck('delete removes it for good', w.eval('convos.some(c=>c.title==="Goes away")')===false);
  ck('and the archive shows its empty state', /Nothing archived/.test(d.querySelector('#archList').textContent));
  ck('the sidebar door is gone too', w.eval('renderSidebar()')===undefined && !d.querySelector('[data-openarch]'));
}

console.log('=== 4. THE SECOND DOOR, IN SETTINGS ===');
{
  const dom=await boot(base());
  const w=dom.window,d=w.document;
  await w.eval(`(async function(){ newConvo(); current.title="Filed away"; current.archived=true; await persist(); })()`);
  await sleep(120);
  w.eval('openSettings()');
  click(w,d.querySelector('#archBtn')); await sleep(80);
  ck('Settings → Data opens the same browser', d.querySelector('#archModal').classList.contains('show'));
  ck('listing the chat', d.querySelector('#archList').textContent.indexOf('Filed away')>=0);
  click(w,d.querySelector('#closeArch'));
  ck('closing keeps the scrim for the settings behind it', d.querySelector('#scrim').classList.contains('show'));
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
