// TEST FILE — run with: node tests/v514test.js
// Guards v5.14.0, three reported failures fixed at the root:
//  A. A failed edit had no way back — feedback only reached the model on the
//     user's next typed message. Failed cards, unreadable blocks and cut-off
//     batches now each carry a one-tap re-request that sends itself.
//  B. The model apologized for edits it made itself: the docedits block is
//     stripped from the stored reply, so it read a changed file with no
//     record of changing it. Every injected file now states its authorship.
//  C. One bad character voided an entire 300-edit block. Complete objects are
//     now salvaged and staged; only the broken or missing ones are re-asked.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const NL=String.fromCharCode(10);
const base=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false},seeded513:true});
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
const call=(w,expr)=>JSON.parse(w.eval('JSON.stringify('+expr+')'));
async function rigChat(w, files){
  await w.eval(`(async()=>{
    current = null; convos = []; docs = [];
    const c = newConvo(); c.filesOn = true;
    for (const f of ${JSON.stringify(files)}){
      const d = await newDoc(f.name, f.text);
      chatDocIds(c).push(d.id);
    }
  })()`);
}
function stubStream(w, chunks){
  const rec={body:null,calls:0};
  w.fetch=(url,opt)=>{rec.calls++;rec.body=opt&&opt.body;let i=0;
    return Promise.resolve({ok:true,body:{getReader(){return{read(){
      if(i>=chunks.length)return Promise.resolve({done:true});
      return Promise.resolve({done:false,value:new TextEncoder().encode(chunks[i++])});
    }};}}});};
  return rec;
}
const sse=o=>'data: '+JSON.stringify(o)+NL+NL;

(async()=>{

console.log('=== A1. A FAILED EDIT HAS A ONE-TAP WAY BACK ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'the real text'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'fix it',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'text the model imagined',replace:'x',reason:'',status:'pending'}]});
  })()`);
  await w.eval(`applyEdit('A1','e1')`); await sleep(60);
  ck('the apply really failed', w.eval(`current.messages.find(m=>m.id==='A1').edits[0].status`)==='failed');
  w.eval('renderThread()');
  const btn=d.querySelector('[data-reask]');
  ck('failed card offers Ask again', !!btn);
  const rec=stubStream(w,[sse({choices:[{delta:{content:'retrying'}}]}),'data: [DONE]'+NL+NL]);
  btn.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(450);
  ck('one tap actually sent a request', rec.calls===1, 'calls='+rec.calls);
  ck('the request names the failure reason', /could|find/.test(String(rec.body))&&/That edit failed/.test(String(rec.body)));
  ck('and demands character-for-character re-quoting', /character-for-character/.test(String(rec.body)));
  ck('and scopes it to ONE edit only', /only this edit/.test(String(rec.body)));
  const asked=w.eval(`current.messages.find(m=>m.id==='A1').edits[0].asked`);
  ck('the card remembers it was asked', asked===true);
  dom.window.close();
}

console.log('=== A2. AN UNREADABLE BLOCK HAS ONE TOO (IT HAD NO BUTTON AT ALL) ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`(()=>{
    current.messages.push({id:'A1',role:'assistant',content:'here',ts:Date.now(),
      editError:"the edit block wasn't valid JSON \\u2014 ask for it again"});
    renderThread();
  })()`);
  const btn=d.querySelector('[data-reblock]');
  ck('parse-failure card offers Ask again', !!btn);
  const rec=stubStream(w,[sse({choices:[{delta:{content:'ok'}}]}),'data: [DONE]'+NL+NL]);
  btn.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(450);
  ck('it sends a re-send request', rec.calls===1);
  ck('naming valid JSON and smaller blocks', /strictly valid JSON/.test(String(rec.body))&&/smaller blocks/.test(String(rec.body)));
  dom.window.close();
}

console.log('=== B. THE MODEL IS TOLD IT CHANGED THE FILE ITSELF ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha beta'}]);
  w.eval(`(()=>{
    current.messages.push({id:'U1',role:'user',content:'change it',ts:Date.now()});
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'alpha',replace:'ALPHA',reason:'',status:'pending'}]});
  })()`);
  await w.eval(`applyEdit('A1','e1')`); await sleep(60);
  const asm=call(w,`assembleMessages('openai')`);
  ck('file heading claims authorship', /YOU changed this file/.test(asm.system), asm.system.slice(-190));
  ck('forbids the third-party apology explicitly', /never tell the user the file was already edited by someone else/i.test(asm.system));
  ck('forbids re-applying', /do not re-apply those edits/i.test(asm.system));
  ck('counts the applied edits', /includes 1 edit you proposed/.test(asm.system));
  const wire=JSON.stringify(asm.messages);
  ck('state note points at the file text', /already present in the file text/.test(wire));
  ck('protocol repeats the rule for every turn', /never tell the user someone else changed the file/i.test(asm.system));
  dom.window.close();
}

console.log('=== B2. NO APPLIED EDITS → NO AUTHORSHIP CLAIM (NO FALSE POSITIVES) ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`current.messages.push({id:'U1',role:'user',content:'hi',ts:Date.now()})`);
  const asm=call(w,`assembleMessages('openai')`);
  ck('an untouched file makes no authorship claim', !/YOU changed this file/.test(asm.system));
  dom.window.close();
}

console.log('=== C1. SALVAGE: ONE BAD EDIT NO LONGER VOIDS THE BATCH ===');
{
  const dom=await boot(base()); const w=dom.window;
  // 300 edits, one with a raw unescaped quote breaking the whole array
  const good=[];
  for (let i=0;i<299;i++) good.push('{"file":"a.md","find":"anchor'+i+'","replace":"new'+i+'","reason":"r"}');
  const bad='{"file":"a.md","find":"has a " raw quote","replace":"x","reason":"r"}';
  const block='<docedits>['+good.slice(0,150).join(',')+','+bad+','+good.slice(150).join(',')+']</docedits>';
  const pd=call(w,'parseDocEdits('+JSON.stringify(block)+')');
  ck('299 good edits survive', pd.edits.length===299, 'got '+pd.edits.length);
  ck('no fatal error', !pd.error);
  ck('the report names how many were skipped', /unreadable and skipped/.test(pd.warn||''), pd.warn);
  ck('order preserved', pd.edits[0].find==='anchor0'&&pd.edits[298].find==='anchor298', pd.edits[298]&&pd.edits[298].find);
  dom.window.close();
}

console.log('=== C2. A CUT-OFF BLOCK IS NO LONGER INVISIBLE ===');
{
  const dom=await boot(base()); const w=dom.window;
  // truncated mid-object, no closing tag at all — the token-ceiling case
  const cut='<docedits>[{"file":"a.md","find":"one","replace":"1","reason":"r"},'
    +'{"file":"a.md","find":"two","replace":"2","reason":"r"},{"file":"a.md","find":"thr';
  const pd=call(w,'parseDocEdits('+JSON.stringify(cut)+')');
  ck('the complete edits still stage', pd.edits.length===2, 'got '+pd.edits.length);
  ck('truncation is reported, not silence', /cut off/.test(pd.warn||''), pd.warn);
  ck('and says to re-send only the missing ones', /ONLY the missing ones/.test(pd.warn||''));
  const none='<docedits>[{"file":"a.md","find":"onl';
  const pd2=call(w,'parseDocEdits('+JSON.stringify(none)+')');
  ck('nothing usable → a clear error, never silence', !!pd2.error&&/cut off/.test(pd2.error), pd2.error);
  ck('and it advises smaller blocks', /fewer edits per block/.test(pd2.error||''));
  dom.window.close();
}

console.log('=== C3. THE WARNING SURFACES AND CAN BE ANSWERED IN ONE TAP ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'one two'}]);
  const cut='Fixing those now.'+NL+'<docedits>[{"file":"a.md","find":"one","replace":"1","reason":"r"},{"file":"a.md","find":"tw';
  stubStream(w,[sse({choices:[{delta:{content:cut}}]}),'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='fix them';
  await w.eval('send()'); await sleep(450);
  const m=JSON.parse(w.eval('JSON.stringify(current.messages[current.messages.length-1])'));
  ck('the salvaged edit is carded', m.edits&&m.edits.length===1);
  ck('the truncation warning is stored', /cut off/.test(m.editWarn||''), m.editWarn);
  ck('the dangling block is stripped from the reply', !/docedits/.test(m.content), JSON.stringify(m.content));
  w.eval('renderThread()');
  const btn=d.querySelector('[data-reblock]');
  ck('Ask for the rest is offered', !!btn);
  const rec=stubStream(w,[sse({choices:[{delta:{content:'ok'}}]}),'data: [DONE]'+NL+NL]);
  btn.dispatchEvent(new w.Event('click',{bubbles:true})); await sleep(450);
  ck('one tap asks only for what never arrived', rec.calls===1&&/ONLY the ones that never arrived/.test(String(rec.body)));
  ck('and forbids repeating the staged ones', /Do not repeat the ones already listed/.test(String(rec.body)));
  const wire=String(rec.body);
  ck('the wire carries the partial-block state', /partial edit block/.test(wire));
  dom.window.close();
}

console.log('=== C4. CLEAN BLOCKS ARE UNAFFECTED (NO SALVAGE TAX) ===');
{
  const dom=await boot(base()); const w=dom.window;
  const ok='<docedits>[{"file":"a.md","find":"x","replace":"y","reason":"r"},{"create_file":"n.md","replace":"body","reason":"r"}]</docedits>';
  const pd=call(w,'parseDocEdits('+JSON.stringify(ok)+')');
  ck('valid block parses with no warning', pd.edits.length===2&&!pd.warn&&!pd.error);
  const nl='<docedits>[{"file":"a.md","find":"x","replace":"line1'+NL+'line2","reason":"r"},]</docedits>';
  const pd2=call(w,'parseDocEdits('+JSON.stringify(nl)+')');
  ck('the old tolerant repairs still run first (no warning)', pd2.edits.length===1&&!pd2.warn, JSON.stringify(pd2.warn));
  ck('and the raw newline survives intact', pd2.edits[0].replace==='line1'+NL+'line2');
  dom.window.close();
}

console.log(NL+'RESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
