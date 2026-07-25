const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function sse(cs){let i=0;return{getReader(){return{read(){
  if(i>=cs.length)return Promise.resolve({done:true});
  return Promise.resolve({done:false,value:new TextEncoder().encode(cs[i++])});}};}};}
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const base=(o={})=>Object.assign({
  providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o);
function boot(st,f){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
      w.localStorage.setItem('cozychat:settings',JSON.stringify(st));
      if(f)w.fetch=f;
    }});
  setTimeout(()=>{try{dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');}catch(_){}res(dom);},750);});}
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const two=`(async()=>{
  const a=await newDoc("draft-a.md","# A\\nAlpha body here.");
  const b=await newDoc("draft-b.md","# B\\nBeta body here.");
  newConvo(); await attachDoc(a.id); await attachDoc(b.id);
  return [a.id,b.id];
})()`;

(async()=>{
console.log('=== 1. A CHAT HOLDS SEVERAL FILES ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  await w.eval(two); await new Promise(r=>setTimeout(r,350));
  ck('both are attached', w.eval('chatDocIds().length')===2, String(w.eval('chatDocIds().length')));
  ck('the icon shows a count', d.querySelector('#fileCount').textContent==='2',
     d.querySelector('#fileCount').textContent);
  ck('the popover lists both', d.querySelectorAll('#fileList .fl-row').length===2);
  ck('it says how many', /2 files attached/.test(d.querySelector('#fileName').textContent),
     d.querySelector('#fileName').textContent);
}

console.log('\n=== 2. BOTH GO TO THE MODEL, LABELLED ===');
{
  const dom=await boot(base());const w=dom.window;
  await w.eval(two); await new Promise(r=>setTimeout(r,350));
  w.eval('current.messages=[{id:"1",role:"user",content:"compare them"}]');
  const sys=w.eval('assembleMessages("openai").system');
  ck('the first file is included', sys.includes('Alpha body here.'));
  ck('the second file is included', sys.includes('Beta body here.'));
  ck('each is under its own heading',
     sys.includes('[FILE: draft-a.md]') && sys.includes('[FILE: draft-b.md]'));
  ck('the protocol names both', /"draft-a\.md", "draft-b\.md"/.test(sys), (sys.match(/attached files:[^\n]*/)||[''])[0]);
  ck('and demands a file on every action', sys.includes('MUST carry a "file"'));
  ck('token estimate counts both', w.eval('estTokens(docs[0].text)+estTokens(docs[1].text)') > 0);
}

console.log('\n=== 3. EDITS TARGET THE NAMED FILE ===');
{
  const dom=await boot(base());const w=dom.window;
  const ids=await w.eval(two); await new Promise(r=>setTimeout(r,350));
  const P=w.eval('parseDocEdits');
  const r=P('<docedits>[{"file":"draft-b.md","find":"Beta body here.","replace":"Beta rewritten.","reason":"asked"}]</docedits>');
  ck('the file name is parsed', r.edits[0].file==='draft-b.md', r.edits[0].file);
  ck('the card names it', w.eval('editKindLabel')(r.edits[0]).includes('draft-b.md'),
     w.eval('editKindLabel')(r.edits[0]));
  w.eval('current.messages=[{id:"m",role:"assistant",content:"ok",edits:'+JSON.stringify(r.edits)+'}]');
  await w.eval('applyEdit("m","'+r.edits[0].id+'")');
  await new Promise(r2=>setTimeout(r2,300));
  ck('the named file changed', w.eval('docs.find(d=>d.name==="draft-b.md").text').includes('Beta rewritten.'));
  ck('the other file is untouched', w.eval('docs.find(d=>d.name==="draft-a.md").text').includes('Alpha body here.'));
}

console.log('\n=== 4. AN UNNAMED OR WRONG TARGET IS REFUSED, NOT GUESSED ===');
{
  const dom=await boot(base());const w=dom.window;
  await w.eval(two); await new Promise(r=>setTimeout(r,350));
  const P=w.eval('parseDocEdits');
  const noFile=P('<docedits>[{"find":"Alpha body here.","replace":"X"}]</docedits>').edits;
  w.eval('current.messages=[{id:"m1",role:"assistant",content:"ok",edits:'+JSON.stringify(noFile)+'}]');
  await w.eval('applyEdit("m1","'+noFile[0].id+'")');
  await new Promise(r=>setTimeout(r,250));
  ck('no file named with two attached → refused',
     w.eval('current.messages[0].edits[0].status')==='failed', w.eval('current.messages[0].edits[0].status'));
  ck('and it says why', /didn't say which file/.test(w.eval('current.messages[0].edits[0].note')),
     w.eval('current.messages[0].edits[0].note'));
  ck('nothing was written', w.eval('docs.find(d=>d.name==="draft-a.md").text').includes('Alpha body here.'));

  const wrong=P('<docedits>[{"file":"nope.md","find":"Alpha body here.","replace":"X"}]</docedits>').edits;
  w.eval('current.messages=[{id:"m2",role:"assistant",content:"ok",edits:'+JSON.stringify(wrong)+'}]');
  await w.eval('applyEdit("m2","'+wrong[0].id+'")');
  await new Promise(r=>setTimeout(r,250));
  ck('an unknown file name → refused', w.eval('current.messages[0].edits[0].status')==='failed');
  ck('naming the missing file', /nope\.md/.test(w.eval('current.messages[0].edits[0].note')),
     w.eval('current.messages[0].edits[0].note'));
}

console.log('\n=== 5. ONE FILE STILL NEEDS NO NAMING ===');
{
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const a=await newDoc("only.md","body one");newConvo();await attachDoc(a.id);})()');
  await new Promise(r=>setTimeout(r,300));
  const e=w.eval('parseDocEdits')('<docedits>[{"find":"body one","replace":"body two"}]</docedits>').edits;
  w.eval('current.messages=[{id:"m",role:"assistant",content:"ok",edits:'+JSON.stringify(e)+'}]');
  await w.eval('applyEdit("m","'+e[0].id+'")');
  await new Promise(r=>setTimeout(r,250));
  ck('applies to the only attached file', w.eval('docs[0].text')==='body two', w.eval('docs[0].text'));
  const sys=w.eval('(function(){current.messages=[{id:"1",role:"user",content:"U"}];return assembleMessages("openai").system;})()');
  ck('and the protocol does not demand a name', !sys.includes('MUST carry a "file"'));
}

console.log('\n=== 6. MANAGING THE LIST ===');
{
  const dom=await boot(base());const w=dom.window,d=dom.window.document;
  const ids=await w.eval(two); await new Promise(r=>setTimeout(r,350));
  ev(w,d.querySelector('#fileBtn'),'click');
  d.querySelector('[data-fdetach="'+ids[0]+'"]').dispatchEvent(new w.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));
  ck('removing one leaves the other', w.eval('chatDocIds().length')===1, String(w.eval('chatDocIds().length')));
  ck('the file itself still exists', w.eval('docs.length')===2);
  ck('the count badge hides at one', d.querySelector('#fileCount').hidden===true);
  ck('attaching again is idempotent',
     (w.eval('attachDoc("'+ids[1]+'")'), true));
  await new Promise(r=>setTimeout(r,250));
  ck('no duplicate entry', w.eval('chatDocIds().length')===1, String(w.eval('chatDocIds().length')));
  await w.eval('(async()=>{ openDocId="'+ids[1]+'"; await DB.docDel("'+ids[1]+'"); docs=docs.filter(x=>x.id!=="'+ids[1]+'"); current.docIds=chatDocIds(); await persist(); })()');
  await new Promise(r=>setTimeout(r,250));
  ck('deleting a file drops it from the chat', w.eval('chatDocIds().length')===0);
}

console.log('\n=== 7. OLD SINGLE-FILE CHATS CARRY OVER ===');
{
  const dom=await boot(base());const w=dom.window;
  await w.eval('(async()=>{const a=await newDoc("legacy.md","old body");newConvo();current.docId=a.id;delete current.docIds;await persist();})()');
  await new Promise(r=>setTimeout(r,300));
  ck('the old field is read', w.eval('chatDocs().length')===1, String(w.eval('chatDocs().length')));
  ck('and folded into the list', w.eval('current.docIds && current.docIds.length')===1);
  ck('the old field is cleared', w.eval('current.docId')===undefined);
  ck('its contents still reach the model',
     w.eval('(function(){current.messages=[{id:"1",role:"user",content:"U"}];return assembleMessages("openai").system;})()').includes('old body'));
}

console.log('\n=== 8. REGRESSIONS ===');
{
  const dom=await boot(base());const w=dom.window;
  ck('fuzzy safety intact',
     w.eval('applyEditToText("the quick brown fox runs",{type:"replace",find:"the quick brown cat runs",replace:"X"})').text===null);
  ck('create_file still works', w.eval('parseDocEdits')('<docedits>[{"create_file":"n.md","replace":"x"}]</docedits>').edits[0].type==='create');
  ck('per-chat settings intact', w.eval('newConvo(); !!current.cfg')===true);
  ck('order helpers intact', w.eval('orderMove')(['a','b'],'a',1).join()==='b,a');
}
console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
