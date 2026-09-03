// TEST FILE — run with: node tests/v5241test.js
// Guards v5.24.1: the Instructions tab never promises a switch it cannot
// deliver. While the open chat lives in a project it says so — the project's
// own set is the one on the wire — and the note goes away for chats outside.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'GLOBAL BASE',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],
  projects:[{id:'pr1',name:'Bleach RP',docIds:[],system:'PROJECT PROMPT',
    injections:[{id:'b1',name:'law',text:'PROJECT LAW',role:'system',pos:'relative',depth:0,enabled:true}],
    order:['__main__','b1','__chat__']}],
  temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
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
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{

console.log('=== THE TAB TELLS THE TRUTH ABOUT WHOSE SET SPEAKS ===');
{
  const dom=await boot(base());const w=dom.window,d=w.document;
  w.eval('newConvo(null,"pr1")'); await sleep(120);
  ev(w,d.querySelector('#settingsBtn'),'click'); await sleep(120);
  const note=d.querySelector('#instProjNote');
  ck('inside a project, the note is there', !note.hidden);
  ck('and it names the place', note.textContent.indexOf('Bleach RP')>=0, note.textContent);
  ck('and the project\'s own set', note.textContent.indexOf('project\'s own instruction set')>=0);
  ck('the wire agrees with the note, not the pin', w.eval('(function(){current.messages.push({id:uid(),role:"user",content:"hi",ts:1});return assembleMessages("openai").system;})()')==='PROJECT PROMPT\n\nPROJECT LAW');
  // moving out retires the note
  await w.eval('(function(){delete current.projectId;return persist();})()');
  w.eval('syncSettingsUI()');
  ck('moved out, the note is gone', d.querySelector('#instProjNote').hidden===true);
  ck('and the pin speaks again', w.eval('assembleMessages("openai").system')==='GLOBAL BASE');
  // a fresh global chat never sees it
  w.eval('newConvo()'); await sleep(120);
  w.eval('syncSettingsUI()');
  ck('a plain global chat never sees it', d.querySelector('#instProjNote').hidden===true);
}

console.log('');
console.log(fail?('FAILED '+fail):'ALL PASS','('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
