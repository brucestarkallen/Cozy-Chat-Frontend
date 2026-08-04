// TEST FILE — run with: node tests/v519test.js
// Guards v5.19.0: an app note is not something the assistant said.
//
// The loop this exists to break. In a files chat, Cozy appended a note to
// every assistant turn on the wire — including, on a zero-edit reply, "no file
// edits were proposed in this reply … making them requires a <docedits>
// block." It went inside the assistant's own turn, unattributed, on every
// reply, on every request. The model read its past replies as ending that way
// and started writing the note itself. And because the note spelled the tag,
// each echo landed an unclosed <docedits> in the reply: findBlocks() called
// that a cut-off block, parseEditBlock() reported "the edit block was cut off
// before anything usable arrived", and stripDocEdits() deleted from the tag to
// the end — so the visible message ended mid-sentence at "…making them
// requires a", with an Ask again card under it. Next turn, that reply still
// had no edits, so it got the note again. Self-sustaining.
//
// Four separate defects, each with its own mutation below:
//   1. an unclosed opener was a cut-off block even when nothing behind it
//      looked like one, so prose that merely names the tag was destroyed;
//   2. the note spelled the tag at all;
//   3. the note was unattributed, inside the turn, on every reply;
//   4. a block cut off after emptying lost its warning entirely and was
//      reported as a reply that proposed no edits.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const st={providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'be helpful',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}};
function boot(){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
    }});
  setTimeout(async()=>{try{await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');}catch(_){}res(dom);},800);});}
const J=(w,expr)=>JSON.parse(w.eval('JSON.stringify('+expr+')'));
const call=(w,fn,arg)=>J(w,fn+'('+JSON.stringify(arg)+')');
const OPEN='<'+'docedits'+'>';

(async()=>{
const dom=await boot();const w=dom.window;

/* ---- 1. the exact echo the user saw ------------------------------------ */
const NOTE='[no file edits were proposed in this reply \u2014 nothing was changed. '
  +'If the user asked for changes, they have NOT been made; making them requires a '+OPEN+' block.]';
const echoed='Here are the changes I described.\n\n'+NOTE;
let r=call(w,'parseDocEdits',echoed);
ck('an echoed note raises no edit error', !r.error, r.error||'');
ck('an echoed note stages nothing', r.edits.length===0);
ck('an echoed note leaves the reply whole',
  w.eval('stripDocEdits('+JSON.stringify(echoed)+')')===echoed);

/* the beheading was exact: everything from the tag onward vanished */
ck('the reply no longer ends mid-sentence',
  /block\.\]$/.test(w.eval('stripDocEdits('+JSON.stringify(echoed)+')')));

/* ---- 2. ordinary prose naming the tag ---------------------------------- */
const prose='You can ask me to use a '+OPEN+' block whenever you want the file changed.';
r=call(w,'parseDocEdits',prose);
ck('prose naming the tag is not a block', r.edits.length===0 && !r.error);
ck('prose naming the tag is not truncated',
  w.eval('stripDocEdits('+JSON.stringify(prose)+')')===prose);

/* ---- 3. a real truncation is still a real truncation -------------------- */
const cut='ok\n'+OPEN+'\n[{"file":"f.md","find":"BODY","replace":"NEW"},{"file":"f.md","fi';
r=call(w,'parseDocEdits',cut);
ck('a genuinely cut-off block still stages what arrived', r.edits.length===1, r.edits.length);
ck('and still warns that the rest never came', /cut off/.test(r.warn||''));
ck('the cut-off block is still stripped from the prose',
  w.eval('stripDocEdits('+JSON.stringify(cut)+')')==='ok');

const nothing='ok\n'+OPEN+'\n[{"fi';
r=call(w,'parseDocEdits',nothing);
ck('a cut-off block with nothing usable still errors',
  r.edits.length===0 && /cut off before anything usable/.test(r.error||''));

const fenced='ok\n'+OPEN+'\n```json\n[{"file":"f.md","append":true,"replace":"x"}]';
ck('a fenced open block is still recognised', call(w,'parseDocEdits',fenced).edits.length===1);
const obj='ok\n'+OPEN+'\n{"file":"f.md","append":true,"replace":"x"}';
ck('a bare object open block is still recognised', call(w,'parseDocEdits',obj).edits.length===1);

/* ---- 4. a block cut off after emptying keeps its warning ---------------- */
r=call(w,'parseDocEdits','ok\n'+OPEN+'\n[]');
ck('an emptied cut-off block is not reported as "no edits proposed"', !!r.error, JSON.stringify(r));
ck('and its error names the missing closing tag', /closing tag/.test(r.error||''));
/* a properly closed empty block is a real "no edits", and must stay silent */
r=call(w,'parseDocEdits','ok\n'+OPEN+'\n[]\n</'+'docedits'+'>');
ck('a closed empty block stays silent', r.edits.length===0 && !r.error && !r.warn);

/* ---- 5. the note is the app's voice, not the assistant's ---------------- */
w.eval(`convos=[];docs=[{id:'d1',name:'f.md',text:'BODY',updatedAt:1,undo:[]}];
current={id:'c1',title:'t',docIds:['d1'],filesOn:true,messages:[
 {id:'u1',role:'user',content:'hi',ts:1},
 {id:'a1',role:'assistant',content:'First reply.',ts:2},
 {id:'u2',role:'user',content:'more',ts:3},
 {id:'a2',role:'assistant',content:'Second reply.',ts:4}]};convos=[current];`);
let p=J(w,'assembleMessages("openai",current)');
const asst=p.messages.filter(m=>m.role==='assistant');
ck('an older zero-edit reply carries no note', !/nothing was changed/.test(asst[0].content));
ck('the newest zero-edit reply does', /nothing was changed/.test(asst[1].content));
ck('exactly one such note in the whole payload',
  (JSON.stringify(p.messages).match(/nothing was changed/g)||[]).length===1,
  (JSON.stringify(p.messages).match(/nothing was changed/g)||[]).length);
ck('the note names the app as its author', /\[cozy \u2014 machine state/.test(asst[1].content));
ck('the note is closed', /\[\/cozy\]$/.test(asst[1].content));
ck('the note tells the model never to write one', /Never write a block like this/.test(asst[1].content));
ck('no conversation turn spells the tag',
  !p.messages.some(m=>String(m.content).indexOf(OPEN)>=0));
ck('the system prompt still teaches the tag', p.system.indexOf(OPEN)>=0);
ck('the reply\'s own prose still comes first', /^Second reply\./.test(asst[1].content));

/* the edit-state note is app-authored too */
w.eval(`current.messages[3].edits=[{id:'e1',type:'append',file:'f.md',find:null,
  replace:'t',reason:'',status:'applied'}];`);
p=J(w,'assembleMessages("openai",current)');
const withEdits=p.messages.filter(m=>m.role==='assistant')[1].content;
ck('the edit-state note is attributed as well', /\[cozy \u2014 machine state/.test(withEdits));
ck('and still reports the edit state', /applied by the user/.test(withEdits));
ck('and still spells no tag', withEdits.indexOf(OPEN)<0);

w.eval(`current.messages[3].edits=[];current.messages[3].editError='the edit block was cut off before anything usable arrived';`);
p=J(w,'assembleMessages("openai",current)');
const withErr=p.messages.filter(m=>m.role==='assistant')[1].content;
ck('a parse-failure note is attributed', /\[cozy \u2014 machine state/.test(withErr));
ck('a parse-failure note spells no tag', withErr.indexOf(OPEN)<0);
ck('a parse-failure note still says how to fix it', /strictly valid JSON/.test(withErr));

/* ---- 6. none of this touches a chat with no files ---------------------- */
w.eval(`current.docIds=[];current.filesOn=false;
 delete current.messages[3].editError;current.messages[3].edits=[];`);
p=J(w,'assembleMessages("openai",current)');
ck('a chat without files gets no note at all',
  !/cozy \u2014 machine state/.test(JSON.stringify(p.messages))
  && !/nothing was changed/.test(JSON.stringify(p.messages)));

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
