const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',prompts:[],temperature:1,maxTokens:4096,effort:'off',showThinking:true,
  catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:true,theme:'dark',
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
  setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const B=(id,over)=>Object.assign({id:id,name:id,text:id.toUpperCase(),role:'system',pos:'relative',depth:0,enabled:true},over||{});

(async()=>{
console.log('=== 1. MIGRATION FROM top/depth/bottom ===');
{
  const dom=await boot(base({
    system:'MAIN', 
    injections:[
      {id:'a',name:'a',text:'A',role:'system',pos:'top',depth:0,enabled:true},
      {id:'b',name:'b',text:'B',role:'system',pos:'bottom',depth:0,enabled:true},
      {id:'c',name:'c',text:'C',role:'system',pos:'depth',depth:2,enabled:true}]}));
  const w=dom.window;
  const p=w.eval('JSON.parse(JSON.stringify(PS()))');
  ck('order was built', Array.isArray(p.order), JSON.stringify(p.order));
  ck('old "top" landed before the conversation',
     p.order.indexOf('a') < p.order.indexOf('__chat__'));
  ck('old "bottom" landed after the conversation',
     p.order.indexOf('b') > p.order.indexOf('__chat__'));
  ck('main prompt is first', p.order[0]==='__main__');
  ck('"top"/"bottom" became relative',
     p.injections.find(i=>i.id==='a').pos==='relative' && p.injections.find(i=>i.id==='b').pos==='relative');
  ck('"depth" became in-chat, depth kept',
     p.injections.find(i=>i.id==='c').pos==='chat' && p.injections.find(i=>i.id==='c').depth===2);
}

console.log('\n=== 2. ORDER DRIVES THE PAYLOAD ===');
{
  const dom=await boot(base({presets:[{id:'d',name:'D',system:'MAIN',
    injections:[B('x'),B('y'),B('z')],order:['__main__','x','y','__chat__','z']}],activePreset:'d'}));
  const w=dom.window;
  w.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"U1"},{id:"2",role:"assistant",content:"A1"}]}');
  let a=w.eval('assembleMessages("openai")');
  ck('system holds main then the two before chat', a.system==='MAIN\n\nX\n\nY', JSON.stringify(a.system));
  ck('the after-chat block trails the conversation',
     a.messages[a.messages.length-1].content==='Z', JSON.stringify(a.messages.map(m=>m.content)));
  // reorder: y now after chat
  w.eval('ordApply(["__main__","x","__chat__","y","z"])');
  a=w.eval('assembleMessages("openai")');
  ck('moving a block below the conversation removes it from system',
     a.system==='MAIN\n\nX', JSON.stringify(a.system));
  ck('and it now trails, in order',
     a.messages.slice(-1)[0].content==='Y\n\nZ' || a.messages.slice(-2).map(m=>m.content).join('|').includes('Y'),
     JSON.stringify(a.messages.map(m=>m.content)));
  // main prompt itself is draggable
  w.eval('ordApply(["x","__chat__","__main__"])');
  a=w.eval('assembleMessages("openai")');
  ck('main prompt can be dragged after the conversation', a.system==='X', JSON.stringify(a.system));
  ck('and appears at the end instead',
     JSON.stringify(a.messages).includes('MAIN'), JSON.stringify(a.messages.map(m=>m.content)));
}

console.log('\n=== 3. RELATIVE ORDER IS RESPECTED, NOT ALPHABETICAL ===');
{
  const dom=await boot(base({presets:[{id:'d',name:'D',system:'',
    injections:[B('one'),B('two'),B('three')],order:['three','one','two','__chat__','__main__']}],activePreset:'d'}));
  const w=dom.window;
  w.eval('current={id:"c",title:"t",messages:[{id:"1",role:"user",content:"U"}]}');
  const a=w.eval('assembleMessages("openai")');
  ck('system follows list order exactly', a.system==='THREE\n\nONE\n\nTWO', JSON.stringify(a.system));
}

console.log('\n=== 4. IN-CHAT BLOCKS IGNORE THE ORDER ===');
{
  const dom=await boot(base({presets:[{id:'d',name:'D',system:'MAIN',
    injections:[B('deep',{pos:'chat',depth:1,text:'DEEP'})],order:['__main__','deep','__chat__']}],activePreset:'d'}));
  const w=dom.window;
  w.eval(`current={id:"c",title:"t",messages:[
    {id:"1",role:"user",content:"U1"},{id:"2",role:"assistant",content:"A1"},{id:"3",role:"user",content:"U2"}]}`);
  const a=w.eval('assembleMessages("openai")');
  const idx=a.messages.findIndex(m=>String(m.content).includes('DEEP'));
  ck('in-chat block is NOT folded into system', !a.system.includes('DEEP'), a.system);
  ck('it sits one message up from the newest', idx===a.messages.length-2 || String(a.messages[a.messages.length-2].content).includes('DEEP'),
     JSON.stringify(a.messages.map(m=>m.role+':'+String(m.content).slice(0,6))));
}

console.log('\n=== 5. REORDER HELPERS (pure) ===');
{
  const dom=await boot(base()); const w=dom.window;
  const mv=w.eval('orderMove'), mt=w.eval('orderMoveTo');
  ck('move up', mv(['a','b','c'],'b',-1).join()==='b,a,c');
  ck('move down', mv(['a','b','c'],'b',1).join()==='a,c,b');
  ck('cannot move past the top', mv(['a','b','c'],'a',-1).join()==='a,b,c');
  ck('cannot move past the bottom', mv(['a','b','c'],'c',1).join()==='a,b,c');
  ck('unknown id is a no-op', mv(['a','b'],'zz',1).join()==='a,b');
  ck('move to index', mt(['a','b','c','d'],'a',2).join()==='b,c,a,d', mt(['a','b','c','d'],'a',2).join());
  ck('move to end', mt(['a','b','c'],'a',9).join()==='b,c,a');
  ck('original array not mutated', (()=>{const o=['a','b','c'];mv(o,'a',1);return o.join()==='a,b,c';})());
}

console.log('\n=== 6. THE LIST UI ===');
{
  const dom=await boot(base({presets:[{id:'d',name:'D',system:'MAIN',
    injections:[B('x'),B('y')],order:['__main__','x','__chat__','y']}],activePreset:'d'}));
  const w=dom.window,d=dom.window.document;
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  const rows=Array.from(d.querySelectorAll('#injList [data-row]')).map(r=>r.dataset.row);
  ck('every item has a row, conversation included', rows.join()==='__main__,x,__chat__,y', rows.join());
  ck('the conversation row is present and labelled',
     d.querySelector('[data-row="__chat__"]').textContent.includes('conversation'));
  ck('each row has a drag handle', d.querySelectorAll('#injList [data-grip]').length===4);
  ck('first row cannot move up', d.querySelector('[data-up="__main__"]').disabled===true);
  ck('last row cannot move down', d.querySelector('[data-down="y"]').disabled===true);
  ck('a block before chat says so', d.querySelector('[data-row="x"] .ord-sub').textContent.includes('Before'));
  ck('a block after chat says so', d.querySelector('[data-row="y"] .ord-sub').textContent.includes('After'));

  d.querySelector('[data-down="x"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('arrow reorders and persists', w.eval('PS().order').join()==='__main__,__chat__,x,y', w.eval('PS().order').join());
  ck('label updates after the move',
     d.querySelector('[data-row="x"] .ord-sub').textContent.includes('After'));
  ck('payload followed the move', !w.eval(`(function(){current={id:'c',title:'t',messages:[{id:'1',role:'user',content:'U'}]};
     return assembleMessages("openai").system;})()`).includes('X'));

  d.querySelector('[data-edit="x"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('tapping a row opens its editor', !!d.querySelector('.ord-editor [data-injtext="x"]'));
  const posSel=d.querySelector('[data-injpos="x"]');
  ck('position choices are Relative and In-chat',
     Array.from(posSel.options).map(o=>o.value).join()==='relative,chat',
     Array.from(posSel.options).map(o=>o.value).join());
  posSel.value='chat'; ev(w,posSel,'change');
  ck('switching to In-chat shows a depth field', !!d.querySelector('[data-injdepth="x"]'));
  ck('row now reports its depth', d.querySelector('[data-row="x"] .ord-sub').textContent.toLowerCase().includes('depth'));

  const before=w.eval('PS().order.length');
  d.querySelector('[data-injdel="x"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('deleting removes the block', w.eval('PS().injections').every(i=>i.id!=='x'));
  ck('and removes it from the order', w.eval('PS().order').indexOf('x')===-1 && w.eval('PS().order.length')===before-1);
}

console.log('\n=== 7. ADDING ===');
{
  const dom=await boot(base({presets:[{id:'d',name:'D',system:'M',injections:[],order:['__main__','__chat__']}],activePreset:'d'}));
  const w=dom.window,d=dom.window.document;
  ev(w,d.querySelector('#settingsBtn'),'click');
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  ev(w,d.querySelector('#addInjBtn'),'click');
  const o=w.eval('PS().order');
  ck('new block lands just before the conversation', o.indexOf(o[1])===1 && o[2]==='__chat__', o.join());
  ck('new block defaults to relative', w.eval('PS().injections[0].pos')==='relative');
  ck('its editor opens straight away', !!d.querySelector('.ord-editor textarea'));
}

console.log('\n=== 8. SELF-HEALING + REGRESSIONS ===');
{
  const dom=await boot(base({presets:[{id:'d',name:'D',system:'M',
    injections:[B('a')],order:['__main__','ghost','a','a','__chat__']}],activePreset:'d'}));
  const w=dom.window;
  const o=w.eval('PS().order');
  ck('unknown id dropped from order', o.indexOf('ghost')===-1, o.join());
  ck('duplicate id collapsed', o.filter(x=>x==='a').length===1, o.join());
  ck('missing markers restored', o.indexOf('__main__')>=0 && o.indexOf('__chat__')>=0);
  const dom2=await boot(base({presets:[{id:'d',name:'D',system:'M',injections:[B('a')]}],activePreset:'d'}));
  const o2=dom2.window.eval('PS().order');
  ck('a preset with no order at all gets one', o2.length===3, o2.join());
  const w2=dom2.window;
  ck('markdown intact', w2.eval('renderMarkdown("**b**")')==='<p><strong>b</strong></p>');
  ck('matching engine intact', w2.eval('applyEditToText("a\\nb",{type:"replace",find:"b",replace:"Z"})').text==='a\nZ');
  ck('thinking styles intact', w2.eval('reasonStyle({kind:"openai",preset:"custom",model:"glm-5.2"})')==='zai');
  ck('six themes', Object.keys(w2.eval('THEMES')).length===6);
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
