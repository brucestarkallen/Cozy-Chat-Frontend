// TEST FILE — run with: node tests/v521test.js
// Guards v5.2.1: reordering instructions by drag works on a touchscreen.
// The browser decides who owns a touch when it STARTS, from touch-action at
// that moment — so the grip must be touch-action:none from first contact,
// and the drag must engage immediately (no long-press gate a fast finger
// falls through).
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'sys',order:['__main__','__chat__'],injections:[
    {id:'a',name:'Alpha',text:'x',role:'system',pos:'relative',depth:0,enabled:true},
    {id:'b',name:'Beta',text:'y',role:'system',pos:'relative',depth:0,enabled:true},
    {id:'c',name:'Gamma',text:'z',role:'system',pos:'relative',depth:0,enabled:true}]}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},750);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// lay the rows out at 40px pitch and return helpers bound to this render
function layout(w){
  const rows=Array.from(w.document.querySelectorAll('#injList [data-row]'));
  rows.forEach((el,i)=>{el.getBoundingClientRect=()=>({top:i*40,height:40,bottom:i*40+40,left:0,right:100,width:100});});
  return rows;
}
function pev(w,type,y){const e=new w.Event(type,{bubbles:true});e.clientY=y;e.pointerId=1;return e;}
function setOrder(w,ord){w.eval(`(function(){const p=S.presets[0];p.order=${JSON.stringify(ord)};saveSettings();renderInjections();})()`);}
const ordNow=w=>w.eval('S.presets[0].order.slice()');
const gripOf=(w,id)=>w.document.querySelector('#injList [data-grip="'+id+'"]');

(async()=>{

console.log('=== 1. THE GRIP OWNS ITS GESTURE FROM FIRST CONTACT ===');
{
  const rule=(html.match(/\.ord-grip\{[\s\S]*?\}/)||[''])[0];
  ck('the grip is touch-action:none at rest', /touch-action:\s*none/.test(rule), rule.replace(/\s+/g,' ').slice(0,120));
  ck('the pan-y fossil is gone', !/touch-action:\s*pan-y/.test(html));
  ck('no mid-gesture touch-action swap on arming', !/\.ord-grip\.armed\{[^}]*touch-action/.test(html));
  ck('text selection cannot hijack a long drag', /user-select:\s*none/.test(rule));
}

console.log('\n=== 2. GRAB AND MOVE, NO WAITING — THE GESTURE A FINGER MAKES ===');
{
  const dom=await boot(base());const w=dom.window;
  setOrder(w,['a','__main__','__chat__','b','c']);
  layout(w);
  const g=gripOf(w,'a');
  ck('setup: every row has a grip', !!g && w.document.querySelectorAll('#injList [data-grip]').length===5);
  g.dispatchEvent(pev(w,'pointerdown',20));
  ck('the row is grabbed on contact', g.classList.contains('armed'), g.className);
  ck('and marked as the one moving', w.document.querySelector('#injList [data-row="a"]').classList.contains('dragging'));
  g.dispatchEvent(pev(w,'pointermove',150));
  ck('the drop slot highlights mid-drag', !!w.document.querySelector('#injList .drop-target'));
  g.dispatchEvent(pev(w,'pointermove',190));
  g.dispatchEvent(pev(w,'pointerup',190));
  ck('released below the last row, it lands last', ordNow(w).join(',')==='__main__,__chat__,b,c,a', ordNow(w).join(','));
}

console.log('\n=== 3. DRAGGING UP WORKS THE SAME ===');
{
  const dom=await boot(base());const w=dom.window;
  setOrder(w,['__main__','__chat__','a','b','c']);
  layout(w);
  const g=gripOf(w,'c');
  g.dispatchEvent(pev(w,'pointerdown',180));
  g.dispatchEvent(pev(w,'pointermove',95));
  g.dispatchEvent(pev(w,'pointerup',95));
  ck('a row dragged above two others lands there', ordNow(w).join(',')==='__main__,__chat__,c,a,b', ordNow(w).join(','));
}

console.log('\n=== 4. A TAP ON THE GRIP MOVES NOTHING ===');
{
  const dom=await boot(base());const w=dom.window;
  setOrder(w,['__main__','__chat__','a','b','c']);
  layout(w);
  const before=ordNow(w).join(',');
  const g=gripOf(w,'b');
  g.dispatchEvent(pev(w,'pointerdown',141));
  g.dispatchEvent(pev(w,'pointerup',141));
  ck('down-and-up in place is a no-op', ordNow(w).join(',')===before, ordNow(w).join(','));
  ck('nothing is left grabbed', !w.document.querySelector('#injList .armed, #injList .dragging, #injList .drop-target'));
}

console.log('\n=== 5. A CANCELLED POINTER LEAVES THE LIST UNTOUCHED ===');
{
  const dom=await boot(base());const w=dom.window;
  setOrder(w,['__main__','__chat__','a','b','c']);
  layout(w);
  const before=ordNow(w).join(',');
  const g=gripOf(w,'a');
  g.dispatchEvent(pev(w,'pointerdown',100));
  g.dispatchEvent(pev(w,'pointermove',180));
  g.dispatchEvent(pev(w,'pointercancel',180));
  ck('the order is unchanged', ordNow(w).join(',')===before);
  ck('no drag styling survives the cancel', !w.document.querySelector('#injList .armed, #injList .dragging, #injList .drop-target'));
  // and a pointerup arriving after the cancel must not fire a move
  g.dispatchEvent(pev(w,'pointerup',180));
  ck('a stray pointerup after cancel does nothing', ordNow(w).join(',')===before);
}

console.log('\n=== 6. THE ARROWS STILL CALL THE SAME HELPERS ===');
{
  const dom=await boot(base());const w=dom.window;
  setOrder(w,['__main__','__chat__','a','b','c']);
  const up=w.document.querySelector('#injList [data-up="b"]');
  ck('rows still offer arrows', !!up);
  up.dispatchEvent(new w.Event('click',{bubbles:true}));
  ck('arrow-up swaps with the row above', ordNow(w).join(',')==='__main__,__chat__,b,a,c', ordNow(w).join(','));
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
