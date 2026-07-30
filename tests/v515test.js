// TEST FILE — run with: node tests/v515test.js
// Guards v5.15.0, three failures found by audit that every earlier gate missed:
//
//  1. The v5.14.0 "Ask again" button on a failed edit card shipped INVISIBLE.
//     `.edit-card.done .row{display:none}` hid the whole button row, and a
//     failed card carried class "done" because it was not pending. The old
//     test asked whether the button EXISTED and whether clicking it worked —
//     never whether a human could see it. These checks read computed style.
//  2. editWarn belonged to neither syncVariant nor saveVariant, so a
//     truncation warning stuck to the MESSAGE and was shown over — and sent
//     with — a different version of the reply.
//  3. A reply carrying TWO <docedits> blocks (the usual shape when a long
//     batch is split and the tail is cut off) parsed only one. The other
//     block's complete edits vanished with no card and no warning, and its
//     raw JSON was left in the prose for the user to read.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=()=>({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
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
const NL=String.fromCharCode(10);
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
// a button a user cannot see is a button that does not exist
const visible=(w,el)=>{
  for(let n=el;n&&n.nodeType===1;n=n.parentElement){
    const cs=w.getComputedStyle(n);
    if(cs.display==='none'||cs.visibility==='hidden') return false;
  }
  return true;
};

(async()=>{

console.log('=== 1. A FAILED EDIT\u2019S ACTIONS ARE ACTUALLY ON SCREEN ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'hello world'}]);
  w.eval(`(()=>{
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'NOT IN THE FILE AT ALL',replace:'x',reason:'r',status:'pending'}]});
  })()`);
  await w.eval(`applyEdit('A1','e1')`); await sleep(60);
  ck('the apply really failed', w.eval(`current.messages.find(m=>m.id==='A1').edits[0].status`)==='failed');
  w.eval('renderThread()');
  const btn=d.querySelector('[data-reask]');
  ck('failed card offers Ask again', !!btn);
  ck('and it is VISIBLE, not hidden by the done-card rule', btn && visible(w,btn),
     btn ? w.getComputedStyle(btn.parentElement).display : 'no button');
  ck('a failed card is not dimmed as settled — it needs the user',
     !d.querySelector('[data-eid="e1"]').classList.contains('done'));
  ck('and it can be dismissed', !!d.querySelector('[data-eid="e1"] [data-skip]'));
  dom.window.close();
}

console.log('\n=== 2. A SETTLED CARD SHOWS NO DEAD BUTTONS ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`(()=>{
    current.messages.push({id:'A1',role:'assistant',content:'ok',ts:Date.now(),edits:[
      {id:'e1',type:'replace',file:'a.md',find:'alpha',replace:'ALPHA',reason:'r',status:'pending'}]});
  })()`);
  await w.eval(`applyEdit('A1','e1')`); await sleep(60);
  w.eval('renderThread()');
  const card=d.querySelector('[data-eid="e1"]');
  ck('an applied card is dimmed as settled', card.classList.contains('done'));
  ck('no Apply button survives on it', !card.querySelector('[data-apply]'));
  ck('no Skip button survives on it', !card.querySelector('[data-skip]'));
  ck('and no empty button row is emitted', !card.querySelector('.row'));
  dom.window.close();
}

console.log('\n=== 3. editWarn BELONGS TO ITS VERSION, NOT TO THE MESSAGE ===');
{
  const dom=await boot(base()); const w=dom.window;
  await rigChat(w,[{name:'a.md',text:'alpha'}]);
  w.eval(`(()=>{
    const m={id:'A1',role:'assistant',content:'v1',ts:Date.now(),
      edits:[{id:'e1',type:'append',file:'a.md',replace:'x',reason:'r',status:'pending'}],
      editWarn:'the block was cut off'};
    current.messages.push(m);
    saveVariant(m);                                   // version 1 keeps its warning
    m.variants.push({content:'v2',thinking:'',model:null,sources:null,tools:null,
                     approvals:null,edits:null,editError:undefined,editWarn:undefined});
    m.vi=1; syncVariant(m);                           // swipe to a clean version 2
  })()`);
  ck('VARIANT_FIELDS carries editWarn', w.eval(`VARIANT_FIELDS.indexOf('editWarn')`)>=0);
  ck('version 1 stored its own warning', w.eval(`current.messages[0].variants[0].editWarn`)==='the block was cut off');
  ck('swiping to a clean version CLEARS the warning',
     w.eval(`current.messages[0].editWarn`)===undefined, JSON.stringify(w.eval(`current.messages[0].editWarn`)));
  ck('so the clean version shows no "ask for the rest" card',
     !/ask for the rest/i.test(w.eval(`editCardsHtml(current.messages[0])`)));
  ck('and the model is not told about the other version\u2019s truncation',
     !/partial edit block/.test(w.eval(`editStateNote(current.messages[0])`)));
  w.eval(`(()=>{const m=current.messages[0]; saveVariant(m); m.vi=0; syncVariant(m);})()`);
  ck('swiping back restores it', w.eval(`current.messages[0].editWarn`)==='the block was cut off');
  dom.window.close();
}

console.log('\n=== 4. EVERY BLOCK IN A REPLY IS PARSED AND STRIPPED ===');
{
  const dom=await boot(base()); const w=dom.window;
  w.__two='First batch.'+NL+'<docedits>'+NL+'[{"file":"a.md","find":"one","replace":"ONE","reason":"r"}]'+NL+'</docedits>'
        +NL+'And the rest:'+NL+'<docedits>'+NL+'[{"file":"a.md","find":"two","replace":"TWO","reason":"r"}]'+NL+'</docedits>';
  const p=w.eval('parseDocEdits(__two)');
  ck('two complete blocks yield BOTH sets of edits', p.edits.length===2, 'n='+p.edits.length);
  ck('in the order the model emitted them', p.edits.map(e=>e.find).join()==='one,two');
  ck('and both are stripped from what the user reads',
     !/docedits/.test(w.eval('stripDocEdits(__two)')), JSON.stringify(w.eval('stripDocEdits(__two)')));

  // the real-world shape: one good block, then a tail cut off by the token limit
  w.__cut='First batch.'+NL+'<docedits>'+NL+'[{"file":"a.md","find":"one","replace":"ONE","reason":"r"}]'+NL+'</docedits>'
        +NL+'And the rest:'+NL+'<docedits>'+NL+'[{"file":"a.md","find":"two","replace":"TWO","reason":"r"},'+NL+' {"file":"a.md","find":"thr';
  const q=w.eval('parseDocEdits(__cut)');
  ck('a cut-off SECOND block still stages what arrived', q.edits.length===2, 'n='+q.edits.length);
  ck('the salvaged edit is the complete one', q.edits.map(e=>e.find).join()==='one,two');
  ck('and the user is TOLD something never arrived', !!q.warn, JSON.stringify(q.warn));
  ck('no raw JSON is left sitting in the prose',
     !/docedits|\{"file"/.test(w.eval('stripDocEdits(__cut)')), JSON.stringify(w.eval('stripDocEdits(__cut)')));

  // a second block that salvages nothing must still raise a warning, not silence
  w.__dead='Done.'+NL+'<docedits>'+NL+'[{"file":"a.md","find":"one","replace":"ONE","reason":"r"}]'+NL+'</docedits>'
        +NL+'<docedits>'+NL+'[{"file":"a.md","fi';
  const r=w.eval('parseDocEdits(__dead)');
  ck('a dead second block does not swallow the first', r.edits.length===1);
  ck('and it surfaces as a warning rather than silence', !!r.warn, JSON.stringify(r.warn));

  // prose that merely names the tag must not swallow the real block
  w.__prose='I will send a <docedits> block now.'+NL+'<docedits>[{"file":"a.md","find":"x","replace":"y","reason":"r"}]</docedits>';
  const s=w.eval('parseDocEdits(__prose)');
  ck('a prose mention of the tag never swallows the real block', s.edits.length===1 && !s.error,
     'n='+s.edits.length+' err='+s.error);

  // single-block behaviour is untouched
  w.__one='ok<docedits>[{"file":"a.md","find":"x","replace":"y","reason":"r"}]</docedits>';
  ck('one clean block still parses to one edit', w.eval('parseDocEdits(__one)').edits.length===1);
  ck('a lone cut-off block still reports being cut off',
     !!w.eval('parseDocEdits(\'<docedits>[{"file":"a.md","find":"onl\')').error);
  ck('no block at all is silence, not an error',
     w.eval('parseDocEdits("just talking")').edits.length===0 && !w.eval('parseDocEdits("just talking")').error);
  dom.window.close();
}

console.log('\n=== 5. THE WHOLE ROUND TRIP THROUGH send() ===');
{
  const dom=await boot(base()); const w=dom.window,d=w.document;
  await rigChat(w,[{name:'a.md',text:'one'+NL+'two'}]);
  stubStream(w,[
    sse({choices:[{delta:{content:'First.'+NL+'<docedits>[{"file":"a.md","find":"one","replace":"ONE","reason":"r"}]</docedits>'}}]}),
    sse({choices:[{delta:{content:NL+'Rest:'+NL+'<docedits>[{"file":"a.md","find":"two","replace":"TWO","reason":"r"}]</docedits>'}}]}),
    'data: [DONE]'+NL+NL]);
  d.querySelector('#input').value='fix both';
  await w.eval('send()'); await sleep(450);
  const m=JSON.parse(w.eval('JSON.stringify(current.messages[current.messages.length-1])'));
  ck('both blocks became cards on one reply', (m.edits||[]).length===2, 'n='+(m.edits||[]).length);
  ck('in emission order', (m.edits||[]).map(e=>e.find).join()==='one,two');
  ck('the reply the user reads has no block left in it', !/docedits/.test(m.content), JSON.stringify(m.content));
  w.eval('renderThread()');
  ck('both cards are on screen', d.querySelectorAll('.edit-card[data-eid]').length===2,
     'cards='+d.querySelectorAll('.edit-card[data-eid]').length);
  await w.eval(`applyAll(current.messages[current.messages.length-1].id)`); await sleep(150);
  ck('applying them edits the file once each', w.eval(`docs[0].text`)==='ONE'+NL+'TWO',
     JSON.stringify(w.eval(`docs[0].text`)));
  ck('and they share one undo frame', w.eval(`docs[0].undo.length`)===1, 'frames='+w.eval(`docs[0].undo.length`));
  ck('so one Undo returns the whole reply\u2019s work',
     await (async()=>{ await w.eval(`undoBatch(current.messages[current.messages.length-1].edits[0].batch)`);
       await sleep(80); return w.eval(`docs[0].text`)==='one'+NL+'two'; })());
  dom.window.close();
}

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
