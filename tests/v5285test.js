// TEST FILE — run with: node tests/v5285test.js
// Guards v5.28.5: a blank answer to "name it" is no answer anywhere a name is
// asked (instruction sets, saved prompts), and a saved prompt that vanished
// since its list was drawn cannot throw.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const st={providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',
  prompts:[{id:'p1',title:'Greeting',text:'Hello there'}],maxTokens:4096,effort:'off',showThinking:true,catchThinkTags:true,
  thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
  w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
  w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;w.localStorage.setItem('cozychat:settings',JSON.stringify(st));}});
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
setTimeout(()=>{
  const w=dom.window,d=w.document;
  const errors=[];w.addEventListener('error',e=>errors.push(String(e.message)));
  w.prompt=()=>'   ';
  const sets=w.eval('S.presets.length');
  d.querySelector('#presetNewBtn').click();
  ck('a new instruction set named with spaces is not made', w.eval('S.presets.length')===sets, String(w.eval('S.presets.length')));
  d.querySelector('#presetRenameBtn').click();
  ck('a set renamed to spaces keeps its name', w.eval('PS().name')==='D', JSON.stringify(w.eval('PS().name')));
  const n=w.eval('S.prompts.length');
  d.querySelector('#promptNewBtn').click();
  ck('a saved prompt named with spaces is not made', w.eval('S.prompts.length')===n);
  d.querySelector('#input').value='some words'; d.querySelector('#promptFromInputBtn').click();
  ck('nor one saved from the input with a blank name', w.eval('S.prompts.length')===n);
  w.eval('openPrompts()');
  d.querySelector('[data-promptedit="p1"]').click();
  ck('a saved prompt renamed to spaces keeps its name', w.eval('S.prompts[0].title')==='Greeting');
  // another browser deletes it while this list is on screen
  w.eval('S.prompts=[]');
  d.querySelector('[data-use="p1"] .nm').click();
  d.querySelector('#promptList') && ev(w,d.querySelector('#promptList'),'click');
  ck('tapping a prompt that is gone throws nothing', !errors.length, JSON.stringify(errors));
  ck('and the list is redrawn without it', /Nothing saved yet/.test(d.querySelector('#promptList').textContent));
  // an instruction set from a file whose block has no name
  w.eval(`S.presets.push({id:'imp',name:'Imported',system:'',injections:[{id:'b1',text:'Be brief.',enabled:true}],order:['__main__','b1','__chat__']}); switchPreset('imp'); d=document; d.querySelector('#injList').setAttribute('data-open','b1'); renderInjections();`);
  const nm=d.querySelector('[data-injname="b1"]');
  ck('a nameless block\u2019s name field is empty, not "undefined"', !!nm && nm.value==='', nm && JSON.stringify(nm.value));
  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
  process.exit(fail?1:0);
},800);
