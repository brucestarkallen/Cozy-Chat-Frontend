// TEST FILE — run with: node tests/v5280test.js
// Guards v5.28.0, Cozy Tavern's library brought to Cozy Chat: projects fold
// (folded until opened, remembered in the settings), the order is chosen
// (last used, name, newest) for projects and chats alike, a paused project
// rests in its own folded corner, the chip under the title is a Quick switch
// for the chat's connection (A to Z, like every connection list now), and an
// open tab takes a new version by itself when nothing is in progress.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[
    {id:'pz',preset:'custom',kind:'openai',name:'Zeta',url:'https://z/v1',apiKey:'k',model:'zeta-1',ctx:100000},
    {id:'pa',preset:'custom',kind:'openai',name:'Alpha',url:'https://a/v1',apiKey:'k',model:'alpha-1',ctx:100000},
    {id:'pm',preset:'custom',kind:'openai',name:'Mid',url:'https://m/v1',apiKey:'k',model:'mid-1',ctx:100000}],
  activeProvider:'pz',
  presets:[{id:'d',name:'D',system:'BASE',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  projects:[{id:'mu00000a01',name:'Zebra project',injections:[],order:['__main__','__chat__'],docIds:[],createdAt:1000},
            {id:'mu00000b02',name:'apple project',injections:[],order:['__main__','__chat__'],docIds:[],createdAt:3000}],
  showThinking:true,showTools:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      if (st) w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if (f) w.fetch=f(w);
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const titles=d=>[...d.querySelectorAll('#convoList .convo-title')].map(e=>e.textContent);
const seed=w=>w.eval(`convos=[
  {id:'c1',title:'beta chat',createdAt:100,updatedAt:9500,projectId:'mu00000a01',cfg:{},messages:[]},
  {id:'c2',title:'Alpha chat',createdAt:300,updatedAt:9200,projectId:'mu00000a01',cfg:{},messages:[]},
  {id:'c3',title:'gamma loose',createdAt:200,updatedAt:9900,cfg:{},messages:[]},
  {id:'c4',title:'Delta loose',createdAt:400,updatedAt:9100,cfg:{},messages:[]},
  {id:'c5',title:'in apple',createdAt:50,updatedAt:9050,projectId:'mu00000b02',cfg:{},messages:[]},
  {id:'c6',title:'Pinned one',createdAt:10,updatedAt:10,pinned:true,cfg:{},messages:[]}];
  current=convos[2]; renderSidebar(); renderThread();`);

(async()=>{

console.log('=== 1. PROJECTS FOLD — FOLDED UNTIL OPENED, AND REMEMBERED ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;seed(w);
  const heads=[...d.querySelectorAll('.proj-head')];
  ck('every project shows as a folded head', heads.length===2 && heads.every(h=>h.classList.contains('folded')));
  ck('… with how many chats it holds', heads.map(h=>h.querySelector('.ph-n').textContent).sort().join(',')==='1,2');
  ck('folded: its chats are not in the list', titles(d).indexOf('beta chat')<0 && titles(d).indexOf('in apple')<0);
  ck('the loose chats and the pinned stay open', titles(d).indexOf('gamma loose')>=0 && titles(d).indexOf('Pinned one')>=0);
  ck('the pinned head still reads Pinned', d.querySelector('.sec-head').textContent==='Pinned');
  d.querySelector('[data-fold="p:mu00000a01"]').click(); await sleep(30);
  ck('a tap opens it', titles(d).indexOf('beta chat')>=0 && !d.querySelector('[data-proj="mu00000a01"]').classList.contains('folded'));
  ck('and the settings remember it', w.eval('S.ui.fold["p:mu00000a01"]')===false && JSON.parse(w.localStorage.getItem('cozychat:settings')).ui.fold['p:mu00000a01']===false);
  d.querySelector('[data-fold="loose"]').click(); await sleep(30);
  ck('the loose chats fold too', titles(d).indexOf('gamma loose')<0 && w.eval('S.ui.fold.loose')===true);
  d.querySelector('[data-fold="pinned"]').click(); await sleep(30);
  ck('and the pinned', titles(d).indexOf('Pinned one')<0);
  d.querySelector('[data-projnew="mu00000b02"]').click(); await sleep(60);
  ck('+ on a folded project opens it and starts a chat there', w.eval('current.projectId')==='mu00000b02' && !d.querySelector('[data-proj="mu00000b02"]').classList.contains('folded'));
  const dom2=await boot(JSON.parse(w.localStorage.getItem('cozychat:settings')));const w2=dom2.window,d2=dom2.window.document;seed(w2);
  ck('a fresh open keeps every fold as it was left', !d2.querySelector('[data-proj="mu00000a01"]').classList.contains('folded') && titles(d2).indexOf('gamma loose')<0);
}

console.log('=== 2. THE ORDER IS YOURS — PROJECTS AND CHATS ALIKE ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;seed(w);
  w.eval('S.ui.fold["p:mu00000a01"]=false; S.ui.fold["p:mu00000b02"]=false; renderSidebar();');
  const projOrder=()=>[...d.querySelectorAll('.proj-head .ph-name')].map(e=>e.textContent);
  ck('last used first by default: the project whose chat moved last leads', projOrder().join('|')==='Zebra project|apple project', projOrder().join('|'));
  ck('… and chats by last use', titles(d).filter(t=>/chat$/.test(t)).join('|')==='beta chat|Alpha chat');
  const sel=d.querySelector('#convoSort');
  sel.value='name'; ev(w,sel,'change'); await sleep(20);
  ck('by name: projects A to Z, any case', projOrder().join('|')==='apple project|Zebra project', projOrder().join('|'));
  ck('by name: chats A to Z', titles(d).filter(t=>/loose$/.test(t)).join('|')==='Delta loose|gamma loose');
  sel.value='newest'; ev(w,sel,'change'); await sleep(20);
  ck('newest made first: projects', projOrder().join('|')==='apple project|Zebra project');
  ck('newest made first: chats', titles(d).filter(t=>/chat$/.test(t)).join('|')==='Alpha chat|beta chat');
  ck('the choice is kept', JSON.parse(w.localStorage.getItem('cozychat:settings')).ui.sort==='newest');
}

console.log('=== 3. A PAUSED PROJECT RESTS AT THE FOOT ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;seed(w);
  d.querySelector('[data-projrest="mu00000a01"]').click(); await sleep(30);
  ck('it leaves the list for a folded corner', !d.querySelector('[data-proj="mu00000a01"]') && /1 resting project/.test(d.querySelector('[data-fold="resting"]').textContent));
  ck('its chats are untouched', w.eval('convos.filter(c=>c.projectId==="mu00000a01").length')===2 && w.eval('S.projects.find(p=>p.id==="mu00000a01").archived')===true);
  d.querySelector('[data-fold="resting"]').click(); await sleep(30);
  ck('opening the corner shows it, with a way to wake it', !!d.querySelector('[data-proj="mu00000a01"] [data-projrest]') && !d.querySelector('[data-proj="mu00000a01"] [data-projnew]'));
  d.querySelector('[data-projrest="mu00000a01"]').click(); await sleep(30);
  ck('waking puts it back', !d.querySelector('[data-fold="resting"]') && !!d.querySelector('[data-proj="mu00000a01"]'));
  ck('the project picker reads A to Z and names a resting one', w.eval('syncSettingsUI(), [...document.querySelectorAll("#chatProj option")].map(o=>o.textContent).join("|")')==='— none —|apple project|Zebra project');
}

console.log('=== 4. QUICK SWITCH ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo();');
  const opts=()=>[...d.querySelectorAll('#quickSwitch option')].map(o=>o.textContent);
  ck('the chip opens the connections, A to Z, and the way to manage them', opts().join('|')==='alpha-1|mid-1|zeta-1|Connections…', opts().join('|'));
  ck('the one in use is the one selected', d.querySelector('#quickSwitch').value==='pz');
  const qs=d.querySelector('#quickSwitch'); qs.value='pa'; ev(w,qs,'change'); await sleep(30);
  ck('picking one is this chat\'s connection', w.eval('current.cfg.providerId')==='pa' && w.eval('current.cfg.model')==null);
  ck('the chip says so', d.querySelector('#modelChip').textContent.indexOf('alpha-1')>=0);
  ck('the next request goes there', w.eval('(current.messages.push({id:"u",role:"user",content:"q"}), buildPayload({},current).url)')==='https://a/v1/chat/completions');
  qs.value='__manage'; ev(w,qs,'change'); await sleep(30);
  ck('Connections… opens Settings', d.querySelector('#settingsModal').classList.contains('show'));
  ck('… whose list reads A to Z', [...d.querySelectorAll('#provList .prov-name')].map(e=>e.textContent).join('|')==='Alpha|Mid|Zeta');
}

console.log('=== 5. A NEW VERSION TAKES OVER AN OPEN TAB BY ITSELF ===');
{
  const newer=w=>(url)=>{ if (String(url).indexOf('index.html?v=')===0) return Promise.resolve({ok:true,text:()=>Promise.resolve('<script>const VERSION = "9.9.9";</script>')}); return Promise.reject(new Error('no')); };
  const dom=await boot(base(),newer);const w=dom.window,d=w.document;
  w.__reloads=0; w.eval('reloadPage=function(){ window.__reloads++; }');
  await w.eval('lookForUpdate(true)');
  ck('nothing in progress: it reloads into the new version', w.__reloads===1);
  await w.eval('lookForUpdate(true)');
  ck('one try per version — a reload that did not take never loops', w.__reloads===1 && !d.querySelector('#updateBanner').hidden);
  ck('… it says so in one line instead', /9\.9\.9 is here/.test(d.querySelector('#updateBanner').textContent));
  const dom2=await boot(base(),newer);const w2=dom2.window,d2=dom2.window.document;
  w2.__reloads=0; w2.eval('reloadPage=function(){ window.__reloads++; }');
  d2.querySelector('#input').value='half a thought';
  await w2.eval('lookForUpdate(true)');
  ck('with words typed it never reloads under you', w2.__reloads===0 && !d2.querySelector('#updateBanner').hidden);
  d2.querySelector('#updateBanner').click();
  ck('a tap on the line takes the new version', w2.__reloads===1);
  ck('the site is asked at most once an hour on its own', (await w2.eval('(async()=>{ const n=window.__reloads; await lookForUpdate(false); return window.__reloads===n; })()')));
}

console.log('=== 6. COPIES ON THE PHONE ARE A PHONE THING ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  await w.eval('renderCopies()');
  ck('in the browser alone there is no such section', d.querySelector('#copiesField').hidden);
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
