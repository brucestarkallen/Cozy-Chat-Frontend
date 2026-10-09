// TEST FILE — run with: node tests/v5291filestest.js        (some sections: node tests/v5291filestest.js 3,5)
// Guards the files the model edits and the files you attach, second round,
// through the live path: the model's reply comes back through send(), its
// edit block becomes cards, the real buttons are tapped, and what is read
// back is the file, the cards, the toasts and the next request.
//   1. More on a reply with edits adds the continuation's edits to its cards
//   2. an edit applied in one chat is applied on every copy of it (Branch)
//   3. a full rewrite is refused exactly when its request sent the file as excerpts
//   4. "Create file" with the name of a file already attached is refused
//   5. edit actions Cozy does not understand are reported, never dropped
//   6. a renamed file is not announced as "no longer attached"
//   7. a file you attach reaches the model unless it is provably the editable file
//   8. a reply's Undo offers the batch applied most recently
//   9. a file save the browser refuses is said and rolled back; no double Apply all
//  10. "Replace everywhere" leaves the name inside longer words alone
//  11. Check: no false "invalid JSON"; transplant notepad and field labels
//  12. "Export ST worldbook" keeps a SillyTavern export's own settings
//  13. a stored reply whose edits are not a list breaks nothing
//  14. Delete takes the file out before the delete is awaited
//  15. UTF-16 and Windows-1252 text files read correctly; Import checks like attach
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
// a precondition of a scenario, not a check of a feature: it is not counted when it holds, and its failure is a failure
const pre=(n,ok,x)=>{if(ok){console.log('  (set)',n);return;}console.log('  FAIL','(setup) '+n,x===undefined?'':'→ '+x);fail++;};
const ONLY=(process.argv[2]||'').split(',').filter(Boolean);
const want=n=>!ONLY.length||ONLY.includes(String(n));
const base=(o)=>Object.assign({
  providers:[{id:'o',preset:'custom',kind:'openai',name:'O',url:'https://o.test/v1',apiKey:'k',model:'m',ctx:200000}],
  activeProvider:'o',presets:[{id:'d',name:'D',system:'',injections:[],order:['__main__','__chat__']}],activePreset:'d',prompts:[],
  maxTokens:1024,effort:'off',showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}},o||{});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=(w,el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
const enc=t=>new TextEncoder().encode(t);
const sse=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const OPEN='<'+'docedits'+'>', CLOSE='</'+'docedits'+'>';
const block=arr=>OPEN+'\n'+JSON.stringify(arr)+'\n'+CLOSE;
const J=(w,expr)=>{const v=w.eval('JSON.stringify('+expr+')');return v===undefined?undefined:JSON.parse(v);};
async function until(fn,ms){const t=Date.now();for(;;){let v;try{v=fn();}catch(_){v=false;}if(v||Date.now()-t>(ms||6000))return v;await sleep(25);}}
/* The model: every chat request is answered with the next queued reply. */
function model(w){
  w.__reqs=[];w.__replies=[];
  return (url,opts)=>{
    const u=String(url);
    if(!/\/chat\/completions$/.test(u))return Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({}),text:()=>Promise.resolve('')});
    w.__reqs.push(JSON.parse(opts.body));
    const r=w.__replies.length?w.__replies.shift():'ok';
    let i=0;const chunks=[sse(r)];
    return Promise.resolve({ok:true,status:200,body:{getReader(){return{read(){
      return Promise.resolve(i<chunks.length?{done:false,value:enc(chunks[i++])}:{done:true});}};}}});
  };
}
function boot(st){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);w.confirm=()=>true;w.navigator.clipboard={writeText:async()=>{}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify(st||base()));
    w.fetch=model(w);
  }});
  setTimeout(async()=>{try{
    await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');
    dom.window.eval('convos=[];current=null;docs=[];renderSidebar();renderThread();');
  }catch(_){}res(dom);},800);});}
function watchToasts(w){const out=[];const t=w.document.querySelector('#toast');
  new w.MutationObserver(()=>{if(t.textContent&&out[out.length-1]!==t.textContent)out.push(t.textContent);}).observe(t,{childList:true,characterData:true,subtree:true});return out;}
const settled=w=>!w.eval('streaming')&&!w.eval('current.messages.some(m=>m.pending)');
async function say(w,text,reply){
  if(reply!==undefined)w.__replies.push(reply);
  const d=w.document,n=w.__reqs.length;
  d.querySelector('#input').value=text;ev(w,d.querySelector('#input'),'input');
  d.querySelector('#sendBtn').click();
  await until(()=>w.__reqs.length>n&&settled(w));await sleep(60);
}
async function more(w,reply){
  w.__replies.push(reply);const n=w.__reqs.length;
  const id=J(w,'current.messages.filter(m=>m.role==="assistant").slice(-1)[0].id');
  w.eval('byAttr(document,"data-continue",'+JSON.stringify(id)+')').click();
  await until(()=>w.__reqs.length>n&&settled(w));await sleep(60);
}
const sysOf=w=>{const r=w.__reqs[w.__reqs.length-1];const s=r&&r.messages.find(m=>m.role==='system');return s?s.content:'';};
const wireOf=w=>JSON.stringify(w.__reqs[w.__reqs.length-1]);
const lastReply=w=>J(w,'current.messages.filter(m=>m.role==="assistant").slice(-1)[0]');
const msgNode=(w,mid)=>w.eval('msgEl('+JSON.stringify(mid)+')');
const cardsOf=(w,mid)=>{const m=msgNode(w,mid);return m?m.querySelectorAll('.edit-card[data-eid]'):[];};
async function tap(w,el){if(!el){console.log('    (nothing to tap)');return false;}el.click();await sleep(120);return true;}
async function applyCard(w,mid,i){const c=cardsOf(w,mid)[i],b=c&&c.querySelector('[data-apply]');if(!b){console.log('    (card '+i+' has no Apply button)');return false;}await tap(w,b);return true;}
const docText=(w,name)=>J(w,'(docs.find(d=>d.name==='+JSON.stringify(name)+')||{}).text');
const edits=(w,mid)=>J(w,'(convos.flatMap(c=>c.messages).find(m=>m.id==='+JSON.stringify(mid)+')||{}).edits');
const stateLines=(w,k)=>{const a=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='assistant')[k];
  const s=typeof a.content==='string'?a.content:JSON.stringify(a.content);
  const m=/\[state of the edits you proposed in this reply\]\n([\s\S]*?)\n\[\/state\]/.exec(s);return m?m[1]:'';};

(async()=>{

if(want(1)){
console.log('=== 1. MORE ADDS THE CONTINUATION\'S EDITS TO THE CARDS ===');
{
  const dom=await boot();const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("roster.md","one two three four");newConvo();await attachDoc(doc.id);})()');
  // the block is cut off by the token limit after three complete edits
  await say(w,'capitalize the roster','Updating.\n\n'+OPEN+'\n[{"find":"one","replace":"ONE"},{"find":"two","replace":"TWO"},{"find":"three","replace":"THREE"},{"find":"fo');
  const a=lastReply(w);
  pre('three edits arrive with a cut-off warning', a.edits.length===3 && /cut off/.test(a.editWarn||''));
  await applyCard(w,a.id,0); await applyCard(w,a.id,1);
  await more(w,' Continuing.\n\n'+block([{find:'four',replace:'FOUR'}]));
  const e=edits(w,a.id);
  ck('More adds the continuation\'s edit to the three cards', JSON.stringify(e.map(x=>x.find))==='["one","two","three","four"]', JSON.stringify(e.map(x=>x.find+':'+x.status)));
  ck('the two applied cards stay applied, the third still waits', e[0].status==='applied'&&e[1].status==='applied'&&e[2].status==='pending', JSON.stringify(e.map(x=>x.status)));
  ck('the cut-off warning the continuation answered is gone', !J(w,'current.messages.find(m=>m.id==='+JSON.stringify(a.id)+').editWarn'));
  await applyCard(w,a.id,3);
  ck('the new card applies', docText(w,'roster.md')==='ONE TWO three FOUR', JSON.stringify(docText(w,'roster.md')));
  await say(w,'status?','ok');
  ck('the next request tells the model about all four', /^1\. [^\n]*applied[\s\S]*\n2\. [^\n]*applied[\s\S]*\n3\. [^\n]*pending[\s\S]*\n4\. [^\n]*applied/.test(stateLines(w,0)), JSON.stringify(stateLines(w,0).slice(0,200)));
  ck('and still tells it the file holds its applied edits', /already includes 3 edits you proposed/.test(sysOf(w)), (sysOf(w).match(/already includes[^\]]*/)||['none'])[0]);
}
{
  const dom=await boot();const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("roster.md","one two three");newConvo();await attachDoc(doc.id);})()');
  await say(w,'capitalize one and two','Done.\n'+block([{find:'one',replace:'ONE'},{find:'two',replace:'TWO'}]));
  const a=lastReply(w);
  await applyCard(w,a.id,0);
  await more(w,' And also:\n'+OPEN+'\n[{"find":"three", "replace": "THREE" oops]\n'+CLOSE);
  const m=J(w,'current.messages.find(m=>m.id==='+JSON.stringify(a.id)+')');
  ck('a continuation whose block is broken keeps the cards there, drawn', (m.edits||[]).length===2 && m.edits[0].status==='applied' && cardsOf(w,a.id).length===2, JSON.stringify((m.edits||[]).map(x=>x.status))+' drawn:'+cardsOf(w,a.id).length);
  ck('and says so above them, as a warning - the broken block not left in the reply', /valid JSON/.test(m.editWarn||'') && !m.editError && !/docedits|oops/.test(m.content), JSON.stringify([m.editWarn,m.editError,m.content]));
}
{
  const dom=await boot();const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("log.md","# Log");newConvo();await attachDoc(doc.id);})()');
  await say(w,'log it','Logged.\n'+block([{append:true,replace:'- Day 3'}]));
  const a=lastReply(w);
  await more(w,' Again, to be sure:\n'+block([{append:true,replace:'- Day 3'}]));
  const e=edits(w,a.id);
  await tap(w,msgNode(w,a.id).querySelector('[data-applyall]'));
  ck('a continuation that re-sends a waiting edit leaves one to apply, so Apply all writes it once', e.filter(x=>x.status==='pending').length===1 && e.length===2 && e[0].status==='superseded' && docText(w,'log.md')==='# Log\n- Day 3', JSON.stringify([e.map(x=>x.status),docText(w,'log.md')]));
  await more(w,' Nothing else.');
  ck('a continuation with no block leaves the cards as they were', edits(w,a.id).length===2, edits(w,a.id).length);
}
}

if(want(2)){
console.log('\n=== 2. AN EDIT APPLIED IN ONE CHAT IS APPLIED ON EVERY COPY OF IT ===');
{
  const dom=await boot();const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("log.md","# Log");newConvo();await attachDoc(doc.id);})()');
  await say(w,'log it','Logged.\n'+block([{append:true,replace:'- Day 3: the bridge fell.'}]));
  const a=lastReply(w), orig=J(w,'current.id');
  await tap(w,msgNode(w,a.id).querySelector('[data-branch]'));          // Branch from this reply
  const br=J(w,'current.id'), brMsg=J(w,'current.messages.filter(m=>m.role==="assistant").slice(-1)[0].id');
  pre('the branch has its own copy of the card', br!==orig && J(w,'current.messages.slice(-1)[0].edits[0].status')==='pending');
  await applyCard(w,brMsg,0);                                             // applied in the branch
  await w.eval('(async()=>{current=convos.find(c=>c.id==='+JSON.stringify(orig)+');renderThread();})()');
  ck('the card in the chat it was branched from is applied too', edits(w,a.id)[0].status==='applied', edits(w,a.id)[0].status);
  ck('and offers no Apply - the file holds the line once', !cardsOf(w,a.id)[0].querySelector('[data-apply]') && docText(w,'log.md')==='# Log\n- Day 3: the bridge fell.', JSON.stringify(docText(w,'log.md')));
  const stored=(await w.eval('DB.all()')).find(c=>c.id===orig);
  ck('the other chat is saved that way', stored && stored.messages.find(m=>m.id===a.id).edits[0].status==='applied');
  // undo here undoes both copies, and applying again here applies both
  await tap(w,msgNode(w,a.id).querySelector('[data-undobatch]'));
  ck('Undo here marks both copies undone', edits(w,a.id)[0].undone===true && edits(w,brMsg)[0].undone===true && docText(w,'log.md')==='# Log', JSON.stringify([edits(w,a.id)[0].status,edits(w,brMsg)[0].status]));
  await applyCard(w,a.id,0);
  ck('Re-apply here applies both again, and writes the line once', edits(w,brMsg)[0].status==='applied' && docText(w,'log.md')==='# Log\n- Day 3: the bridge fell.', edits(w,brMsg)[0].status+' '+JSON.stringify(docText(w,'log.md')));
}
{
  const dom=await boot();const w=dom.window;
  w.eval('newConvo(); current.filesOn=true;');
  await say(w,'make a plan','Made.\n'+block([{create_file:'plan.md',replace:'The plan.'}]));
  const a=lastReply(w), orig=J(w,'current.id');
  await tap(w,msgNode(w,a.id).querySelector('[data-branch]'));
  const brMsg=J(w,'current.messages.filter(m=>m.role==="assistant").slice(-1)[0].id');
  await applyCard(w,brMsg,0);
  await w.eval('(async()=>{current=convos.find(c=>c.id==='+JSON.stringify(orig)+');renderThread();})()');
  await applyCard(w,a.id,0);
  ck('a Create file card applied in a branch cannot make the file a second time', J(w,'docs.filter(d=>d.name==="plan.md").length')===1 && edits(w,a.id)[0].status==='applied', J(w,'docs.filter(d=>d.name==="plan.md").length'));
}
}

if(want(3)){
console.log('\n=== 3. A FULL REWRITE IS REFUSED EXACTLY WHEN ITS REQUEST SENT EXCERPTS ===');
const paras=n=>Array.from({length:n},(_,i)=>'Paragraph '+i+' about topic'+i+' with several more words.').join('\n\n');
{
  // smart, but small enough to go whole
  const dom=await boot();const w=dom.window;
  const body=paras(40);
  await w.eval(`(async()=>{const doc=await newDoc("story.md",${JSON.stringify(body)});doc.mode="smart";await saveDoc(doc);newConvo();await attachDoc(doc.id);})()`);
  await say(w,'rewrite the whole file in a fresh style','Here.\n'+block([{replace_all:true,replace:'NEW WHOLE FILE'}]));
  pre('a smart file of '+body.length+' characters goes whole, with no excerpt heading', sysOf(w).includes('[FILE: story.md]\n') && sysOf(w).includes(body));
  const a=lastReply(w); await applyCard(w,a.id,0);
  ck('so its full rewrite applies', edits(w,a.id)[0].status==='applied' && docText(w,'story.md')==='NEW WHOLE FILE', edits(w,a.id)[0].status+' '+JSON.stringify(edits(w,a.id)[0].note));
}
{
  // sent as excerpts; the file is switched to Full before Apply
  const dom=await boot();const w=dom.window,d=w.document;
  const body=paras(300);
  await w.eval(`(async()=>{const doc=await newDoc("lore.md",${JSON.stringify(body)});doc.mode="smart";await saveDoc(doc);newConvo();await attachDoc(doc.id);})()`);
  await say(w,'tidy topic5 please','Tidied.\n'+block([{replace_all:true,replace:'Paragraph 5 about topic5, tidied.'}]));
  pre('the request carried excerpts of it', /\[FILE: lore\.md \u2014 relevant excerpts/.test(sysOf(w)));
  const a=lastReply(w);
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fmode]'));
  pre('the file is now Full', J(w,'docs[0].mode')==='full');
  await applyCard(w,a.id,0);
  const e=edits(w,a.id)[0];
  ck('a rewrite written from excerpts is refused even after the file is switched to Full', e.status==='failed' && /shown as excerpts/.test(e.note||'') && docText(w,'lore.md')===body, e.status+' '+JSON.stringify(e.note)+' '+J(w,'docs[0].text.length'));
  await say(w,'now?','ok');
  ck('the model is told why', /full rewrite: FAILED \u2014 this file was shown as excerpts/.test(stateLines(w,0)), JSON.stringify(stateLines(w,0).slice(0,120)));
}
{
  const dom=await boot();const w=dom.window;
  const body=paras(300);
  await w.eval(`(async()=>{const doc=await newDoc("lore.md",${JSON.stringify(body)});newConvo();await attachDoc(doc.id);})()`);
  await say(w,'rewrite all of it','Here.\n'+block([{replace_all:true,replace:'ALL NEW'}]));
  const a=lastReply(w);
  await w.eval('(async()=>{docs[0].mode="smart";await saveDoc(docs[0]);})()');
  await applyCard(w,a.id,0);
  ck('a rewrite written from the whole file applies even after the file is switched to Smart', edits(w,a.id)[0].status==='applied' && docText(w,'lore.md')==='ALL NEW', edits(w,a.id)[0].status+' '+JSON.stringify(edits(w,a.id)[0].note));
}
}

if(want(4)){
console.log('\n=== 4. "CREATE FILE" WITH THE NAME OF A FILE ALREADY ATTACHED IS REFUSED ===');
{
  const dom=await boot();const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("notes.md","OLD NOTES: Kira is a mage.");const o=await newDoc("lore.md","x");newConvo();await attachDoc(doc.id);})()');
  await say(w,'start the notes over','New notes.\n'+block([{create_file:'notes.md',replace:'NEW NOTES.'},{create_file:'Notes.MD',replace:'NEWER.'},{create_file:'lore.md',replace:'LORE.'}]));
  const a=lastReply(w);
  await applyCard(w,a.id,0); await applyCard(w,a.id,1); await applyCard(w,a.id,2);
  const e=edits(w,a.id);
  ck('a file called notes.md is not made beside the attached notes.md - lore.md, in Files but not attached here, is made and attached', e[0].status==='failed' && e[0].note==='"notes.md" already exists \u2014 edit or rewrite it' && J(w,'docs.filter(x=>x.name.toLowerCase()==="notes.md").length')===1
     && e[2].status==='applied' && J(w,'allChatDocs(current).filter(x=>x.name==="lore.md").length')===1 && J(w,'allChatDocs(current).find(x=>x.name==="lore.md").text')==='LORE.', e[0].status+' '+JSON.stringify(e[0].note)+' '+e[2].status);
  ck('nor one whose name differs only in capitals', e[1].status==='failed' && /already exists/.test(e[1].note||''), e[1].status+' '+JSON.stringify(e[1].note));
  ck('the attached file is untouched', docText(w,'notes.md')==='OLD NOTES: Kira is a mage.');
  await say(w,'?','ok');
  ck('the model is told why', /create_file "notes\.md": FAILED \u2014 "notes\.md" already exists/.test(stateLines(w,0)), JSON.stringify(stateLines(w,0).slice(0,140)));
}
{
  // the same name reaching a chat another way: Attach, and Rename
  const dom=await boot();const w=dom.window,d=w.document;
  const ts=watchToasts(w); w.prompt=()=>'notes.md';
  await w.eval('(async()=>{const a=await newDoc("notes.md","A");const b=await newDoc("notes.md","B");const c=await newDoc("lore.md","L");newConvo();await attachDoc(a.id);})()');
  w.eval('openDocEditor(docs.find(x=>x.text==="B").id)'); await tap(w,d.querySelector('#docAttachBtn'));
  ck('a second file called notes.md is not attached beside the first', JSON.stringify(J(w,'allChatDocs(current).map(x=>x.text)'))==='["A"]' && /already in this chat/.test(ts.join(' ')), JSON.stringify(J(w,'allChatDocs(current).map(x=>x.text)'))+' '+JSON.stringify(ts.slice(-1)));
  await w.eval('(async()=>{await attachDoc(docs.find(x=>x.name==="lore.md").id);})()');
  w.eval('openDocEditor(docs.find(x=>x.name==="lore.md").id)'); await tap(w,d.querySelector('#docRenameBtn')); w.eval('hideDocEdit()');
  ck('a file in a chat cannot be renamed to the name of another file in it', J(w,'docs.filter(x=>x.name==="notes.md"&&x.text==="L").length')===0 && /already in a chat with this one/.test(ts.join(' ')), JSON.stringify(ts.slice(-1)));
}
}

if(want(5)){
console.log('\n=== 5. EDIT ACTIONS COZY DOES NOT UNDERSTAND ARE REPORTED, NEVER DROPPED ===');
{
  const dom=await boot();const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("notes.md","alpha beta gamma");newConvo();await attachDoc(doc.id);})()');
  await say(w,'three changes','Done.\n'+block([{find:'alpha',replace:'ALPHA'},{file:'notes.md',search:'beta',replace:'BETA'},{find:'gamma',replace:'GAMMA'}]));
  let a=lastReply(w);
  ck('an action with no find, insert_after, append, replace_all or create_file is reported', a.edits.length===2 && /1 action Cozy doesn't understand/.test(a.editWarn||'') && /search/.test(a.editWarn||''), JSON.stringify([a.edits.length,a.editWarn]));
  ck('above the two cards that arrived', cardsOf(w,a.id).length===2 && /doesn't understand/.test(msgNode(w,a.id).querySelector('.edits').textContent));
  await say(w,'?','ok');
  ck('and the model is told', /\[partial edit block: [^\]]*doesn't understand/.test(JSON.stringify(w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='assistant')[0].content)));
  await say(w,'log it','Logged.\n'+block([{file:'notes.md',action:'append',text:'- delta'}]));
  a=lastReply(w);
  ck('a block where nothing is understood is an error with Ask again', !(a.edits||[]).length && /doesn't understand/.test(a.editError||'') && !!msgNode(w,a.id).querySelector('[data-reblock]'), JSON.stringify(a.editError||null));
  ck('and the block is not left in the reply', a.content==='Logged.', JSON.stringify(a.content));
  await say(w,'add it','Added.\n'+block([{file:'notes.md',append:'true',replace:'- delta'}]));
  a=lastReply(w);
  ck('"append": "true" is read as what it says', (a.edits||[]).length===1 && a.edits[0].type==='append', JSON.stringify(a.edits));
  await say(w,'anything to change?','No, nothing to change.\n'+block([]));
  a=lastReply(w);
  ck('an empty block stages nothing, says nothing, and is not left in the reply', !(a.edits||[]).length && !a.editError && !a.editWarn && a.content==='No, nothing to change.', JSON.stringify([a.content,a.editError||null,a.editWarn||null]));
}
}

if(want(6)){
console.log('\n=== 6. A RENAMED FILE IS NOT ANNOUNCED AS "NO LONGER ATTACHED" ===');
{
  const dom=await boot();const w=dom.window,d=w.document;
  w.prompt=()=>'kira.md';
  await w.eval('(async()=>{const doc=await newDoc("notes.md","Kira is a mage.");newConvo();await attachDoc(doc.id);})()');
  await say(w,'one','ok');
  w.eval('openDocEditor(docs[0].id)'); await tap(w,d.querySelector('#docRenameBtn')); w.eval('hideDocEdit()');
  await say(w,'two','ok');
  const sys2=sysOf(w);
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fdetach]'));
  await say(w,'three','ok');
  const sys3=sysOf(w);
  ck('after a rename the next request carries the file under its new name and does not call it gone - taking it off the chat still does, by the name it was last sent under',
     sys2.includes('[FILE: kira.md]') && !/no longer attached/.test(sys2) && /no longer attached to this chat: kira\.md/.test(sys3),
     JSON.stringify([(sys2.match(/\[no longer attached[^\]]*/)||[''])[0].slice(0,90),(sys3.match(/\[no longer attached[^\]]*/)||['none'])[0].slice(0,80)]));
}
}

if(want(7)){
console.log('\n=== 7. A FILE YOU ATTACH REACHES THE MODEL UNLESS IT IS PROVABLY THE EDITABLE FILE ===');
{
  const dom=await boot();const w=dom.window,d=w.document;
  await w.eval('(async()=>{const doc=await newDoc("worldbook.json","[{\\"name\\":\\"Alice\\",\\"content\\":\\"OLD\\"}]");newConvo();await attachDoc(doc.id);})()');
  // a new SillyTavern export with the same file name, to be merged in
  await w.eval('addAttachments')([new w.File(['[{"name":"Alice","content":"FROM ST EXPORT"},{"name":"Zed","content":"NEW ENTRY ZED"}]'],'worldbook.json',{type:'application/json'})]);
  await say(w,'merge this export into our worldbook','ok');
  const u=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user').pop().content, once=(sysOf(w).match(/\[FILE: worldbook\.json\]/g)||[]).length===1;
  // the same text as the editable file is still sent once only
  await w.eval('addAttachments')([new w.File([J(w,'docs[0].text')],'worldbook.json',{type:'application/json'})]);
  await say(w,'here it is again','ok');
  const u2=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user').pop().content;
  ck('a file attached with the editable file\'s name but other text reaches the model - while a copy with exactly its text is not repeated', /NEW ENTRY ZED/.test(u) && !/"OLD"/.test(u2) && /Its current contents are in your instructions under \[FILE: worldbook\.json\]/.test(u2), JSON.stringify([u.slice(0,160),u2.slice(0,160)]));
  ck('marked as not being the editable file, which still rides once, in the instructions', /not the editable file/.test(u) && once);
}
{
  const dom=await boot();const w=dom.window;
  w.eval('newConvo()');
  await w.eval('addAttachments')([new w.File(['CHAPTER ONE TEXT'],'chapter.txt',{type:'text/plain'}),new w.File(['CHAPTER TWO TEXT'],'chapter.txt',{type:'text/plain'}),new w.File(['CHAPTER ONE TEXT'],'chapter.txt',{type:'text/plain'})]);
  await say(w,'compare these two chapters','ok');
  const u=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user').pop().content;
  ck('two different files with one name in one message both reach the model - the same file attached twice goes once', /CHAPTER ONE TEXT/.test(u) && /CHAPTER TWO TEXT/.test(u) && (u.match(/CHAPTER ONE TEXT/g)||[]).length===1, JSON.stringify(u.slice(0,200)));
}
}

if(want(8)){
console.log('\n=== 8. A REPLY\'S UNDO OFFERS THE BATCH APPLIED MOST RECENTLY ===');
{
  const dom=await boot();const w=dom.window;
  const ts=watchToasts(w);
  await w.eval('(async()=>{const doc=await newDoc("n.md","alpha beta gamma");newConvo();await attachDoc(doc.id);})()');
  await say(w,'two changes','Done.\n'+block([{find:'alpha',replace:'ALPHA'},{find:'gamma',replace:'GAMMA'}]));
  const a=lastReply(w);
  await applyCard(w,a.id,1); await sleep(20); await applyCard(w,a.id,0);    // the second card first
  pre('both applied', docText(w,'n.md')==='ALPHA beta GAMMA');
  await tap(w,msgNode(w,a.id).querySelector('[data-undobatch]'));
  ck('Undo reverts the change applied last', docText(w,'n.md')==='alpha beta GAMMA', JSON.stringify(docText(w,'n.md'))+' '+JSON.stringify(ts.slice(-1)));
  await tap(w,msgNode(w,a.id).querySelector('[data-undobatch]'));
  ck('and Undo again the one before it', docText(w,'n.md')==='alpha beta gamma', JSON.stringify(docText(w,'n.md'))+' '+JSON.stringify(ts.slice(-1)));
  ck('never "buried"', !ts.some(t=>/buried/.test(t)), JSON.stringify(ts));
}
}

if(want(9)){
console.log('\n=== 9. A FILE SAVE THE BROWSER REFUSES IS SAID AND ROLLED BACK; NO DOUBLE APPLY ALL ===');
// a refused save used to escape as an unhandled rejection; that one is collected here, not left to stop
// the run - anything else unhandled is a broken test, and still stops it
const unhandled=[];const onUR=e=>{const s=String((e&&e.message)||e);if(/QuotaExceededError/.test(s)){unhandled.push(s);return;}console.log('  FAIL (unhandled)',(e&&e.stack)||s);process.exit(1);};
process.on('unhandledRejection',onUR);
const QUOTA='new Error("QuotaExceededError: the quota has been exceeded")';
const refuse=(w,k)=>w.eval('window.__real=window.__real||{docPut:DB.docPut,put:DB.put};DB.'+k+'=()=>Promise.reject('+QUOTA+')');
const allow=w=>w.eval('if(window.__real){DB.docPut=window.__real.docPut;DB.put=window.__real.put;}');
const storedText=async(w,name)=>{const all=await w.eval('IDB.docAll()');const f=all.find(x=>x.name===name);return f?f.text:null;};
const stText=(w,mid,i)=>{const c=cardsOf(w,mid)[i];return c?c.querySelector('.st').textContent:'(no card)';};
const hasApply=(w,mid,i)=>{const c=cardsOf(w,mid)[i];return !!(c&&c.querySelector('[data-apply]'));};
const frames=(w,name)=>J(w,'((docs.find(d=>d.name==='+JSON.stringify(name)+')||{}).undo||[]).length');
const last=ts=>ts[ts.length-1]||'';
const COULDNT=/^Couldn't save n\.md — QuotaExceededError/;
async function setup(edits,text){
  const dom=await boot();const w=dom.window;const ts=watchToasts(w);
  await w.eval('(async()=>{const doc=await newDoc("n.md",'+JSON.stringify(text||'alpha beta gamma')+');newConvo();await attachDoc(doc.id);})()');
  if(edits)await say(w,'change it','Done.\n'+block(edits));
  return {w,d:w.document,ts,a:edits?lastReply(w):null};
}
const TWO=[{find:'alpha',replace:'ALPHA'},{find:'gamma',replace:'GAMMA'}];
{
  const {w,ts,a}=await setup(TWO);
  refuse(w,'docPut'); ts.length=0;
  await applyCard(w,a.id,0);
  ck('Apply whose file save the browser refuses says so, by the file\'s name', COULDNT.test(last(ts)), JSON.stringify(ts));
  ck('the card offers Apply again and says why', hasApply(w,a.id,0) && /Couldn't save n\.md/.test(stText(w,a.id,0)), JSON.stringify(stText(w,a.id,0))+' apply:'+hasApply(w,a.id,0));
  ck('the file stays as it is stored, with nothing new to undo', docText(w,'n.md')==='alpha beta gamma' && (await storedText(w,'n.md'))==='alpha beta gamma' && frames(w,'n.md')===0, JSON.stringify([docText(w,'n.md'),await storedText(w,'n.md'),frames(w,'n.md')]));
  ck('the model is not told it was applied', J(w,'current.messages.find(m=>m.id==='+JSON.stringify(a.id)+').edits[0].status')==='pending');
  allow(w); ts.length=0;
  await applyCard(w,a.id,0);
  ck('once the browser stores again, the same Apply lands', docText(w,'n.md')==='ALPHA beta gamma' && (await storedText(w,'n.md'))==='ALPHA beta gamma' && /^Applied/.test(stText(w,a.id,0)) && frames(w,'n.md')===1, JSON.stringify([docText(w,'n.md'),stText(w,a.id,0),frames(w,'n.md')]));
  ck('no save failure went unhandled', !unhandled.length, JSON.stringify(unhandled)); unhandled.length=0;
}
{
  const {w,ts,a}=await setup(TWO);
  refuse(w,'docPut'); ts.length=0;
  await tap(w,msgNode(w,a.id).querySelector('[data-applyall]')); await sleep(150);
  ck('Apply all whose file save is refused never says "applied"', !ts.some(t=>/applied/.test(t)) && COULDNT.test(last(ts)), JSON.stringify(ts));
  ck('both cards still offer Apply; the file and its undo are untouched', hasApply(w,a.id,0)&&hasApply(w,a.id,1) && docText(w,'n.md')==='alpha beta gamma' && frames(w,'n.md')===0, JSON.stringify([stText(w,a.id,0),stText(w,a.id,1),docText(w,'n.md'),frames(w,'n.md')]));
  allow(w); ts.length=0;
  await tap(w,msgNode(w,a.id).querySelector('[data-applyall]')); await sleep(150);
  ck('Apply all again, stored: "2 applied", one undo step', last(ts)==='2 applied' && (await storedText(w,'n.md'))==='ALPHA beta GAMMA' && frames(w,'n.md')===1, JSON.stringify([ts,frames(w,'n.md')]));
  // Undo, the file store refusing
  refuse(w,'docPut'); ts.length=0;
  w.document.querySelector('#fileBtn').click(); await tap(w,w.document.querySelector('[data-fundo]'));
  ck('the file\'s undo whose save is refused says so, never "Undone"', COULDNT.test(last(ts)) && !ts.includes('Undone'), JSON.stringify(ts));
  ck('the file keeps the change, still one undo away, and its cards still say Applied', docText(w,'n.md')==='ALPHA beta GAMMA' && (await storedText(w,'n.md'))==='ALPHA beta GAMMA' && frames(w,'n.md')===1 && /^Applied/.test(stText(w,a.id,0)) && /^Applied/.test(stText(w,a.id,1)), JSON.stringify([docText(w,'n.md'),frames(w,'n.md'),stText(w,a.id,0)]));
  ts.length=0;
  await tap(w,msgNode(w,a.id).querySelector('[data-undobatch]'));
  ck('the reply\'s Undo whose save is refused says so, never "Undid"', COULDNT.test(last(ts)) && !ts.some(t=>/^Undid/.test(t)), JSON.stringify(ts));
  const kept=[docText(w,'n.md'),frames(w,'n.md'),stText(w,a.id,1)];
  allow(w); ts.length=0;
  await tap(w,msgNode(w,a.id).querySelector('[data-undobatch]'));
  ck('and leaves the file and its cards as they were - so once stored again, the same Undo works', kept[0]==='ALPHA beta GAMMA' && kept[1]===1 && /^Applied/.test(kept[2])
     && docText(w,'n.md')==='alpha beta gamma' && (await storedText(w,'n.md'))==='alpha beta gamma' && /^Undid 1 file/.test(last(ts)), JSON.stringify([kept,docText(w,'n.md'),ts]));
  ck('no save failure went unhandled', !unhandled.length, JSON.stringify(unhandled)); unhandled.length=0;
}
{
  // the chat store refuses: the files are stored, the chat is not - the success toast must not cover that
  const {w,ts,a}=await setup(TWO);
  refuse(w,'put'); ts.length=0;
  await tap(w,msgNode(w,a.id).querySelector('[data-applyall]')); await sleep(150);
  ck('Apply all whose chat save is refused leaves "Couldn\'t save this chat" on screen, not "2 applied"', /^Couldn't save this chat/.test(last(ts)) && !ts.includes('2 applied'), JSON.stringify(ts));
  ts.length=0;
  w.document.querySelector('#fileBtn').click(); await tap(w,w.document.querySelector('[data-fundo]'));
  ck('so does the file\'s undo, not "Undone"', /^Couldn't save this chat/.test(last(ts)) && !ts.includes('Undone'), JSON.stringify(ts));
  allow(w);
}
{
  // the editor: Close, Save, a Check fix, Rename, the Full/Smart switch
  const {w,d,ts}=await setup(null,'one  two');
  w.eval('openDocEditor(docs[0].id)'); d.querySelector('#docEditArea').value='typed by hand';
  refuse(w,'docPut'); ts.length=0;
  const asked=[]; w.confirm=q=>{asked.push(q);return false;};          // Cancel: keep the typing
  await tap(w,d.querySelector('#closeDocEdit'));
  ck('closing the editor when the save is refused asks, and Cancel keeps it open with the typing', /Couldn't save n\.md\. Close without saving/.test(asked[0]||'') && d.querySelector('#docEditModal').classList.contains('show') && d.querySelector('#docEditArea').value==='typed by hand', JSON.stringify(asked)+' '+d.querySelector('#docEditModal').className);
  ck('and says so, never "Saved"', COULDNT.test(last(ts)) && !ts.some(t=>/^Saved/.test(t)), JSON.stringify(ts));
  ck('the file stays as it is stored, with nothing new to undo', docText(w,'n.md')==='one  two' && (await storedText(w,'n.md'))==='one  two' && frames(w,'n.md')===0, JSON.stringify([docText(w,'n.md'),frames(w,'n.md')]));
  ts.length=0;
  await tap(w,d.querySelector('#docSaveBtn'));
  ck('Save, refused, says so and not "Saved"', COULDNT.test(last(ts)) && !ts.includes('Saved'), JSON.stringify(ts));
  ts.length=0; d.querySelector('#docEditArea').value='one  two';
  await tap(w,d.querySelector('#docCheckBtn'));
  const fix=[...d.querySelectorAll('#docFixRow button')].find(b=>/Collapse double spaces/.test(b.textContent));
  await tap(w,fix);
  ck('a Check fix whose save is refused leaves the file and the editor as they were', docText(w,'n.md')==='one  two' && d.querySelector('#docEditArea').value==='one  two' && frames(w,'n.md')===0 && COULDNT.test(last(ts)) && !ts.some(t=>/collapsed/.test(t)), JSON.stringify([docText(w,'n.md'),d.querySelector('#docEditArea').value,frames(w,'n.md'),ts]));
  ts.length=0; w.prompt=()=>'kira.md';
  await tap(w,d.querySelector('#docRenameBtn'));
  ck('a rename whose save is refused keeps the stored name', J(w,'docs[0].name')==='n.md' && d.querySelector('#docEditTitle').textContent==='n.md' && /^Couldn't save/.test(last(ts)), JSON.stringify([J(w,'docs[0].name'),d.querySelector('#docEditTitle').textContent,ts]));
  ts.length=0; w.confirm=()=>true;                                      // OK: close without saving
  d.querySelector('#docEditArea').value='second try';
  await tap(w,d.querySelector('#closeDocEdit'));
  ck('OK closes the editor with the file as it is stored - a full browser never traps you in it', !d.querySelector('#docEditModal').classList.contains('show') && docText(w,'n.md')==='one  two' && (await storedText(w,'n.md'))==='one  two' && frames(w,'n.md')===0 && /^Closed without saving/.test(last(ts)), JSON.stringify([docText(w,'n.md'),frames(w,'n.md'),ts]));
  ts.length=0;
  d.querySelector('#fileBtn').click(); await tap(w,d.querySelector('[data-fmode]'));
  ck('the Full/Smart switch whose save is refused keeps the stored mode, and says so', (J(w,'docs[0].mode')||'full')==='full' && /^Couldn't save/.test(last(ts)) && !ts.some(t=>/^Smart/.test(t)), JSON.stringify([J(w,'docs[0].mode'),ts]));
  allow(w); ts.length=0;
  w.eval('openDocEditor(docs[0].id)'); d.querySelector('#docEditArea').value='typed by hand';
  await tap(w,d.querySelector('#closeDocEdit'));
  ck('stored again, Close saves and closes', !d.querySelector('#docEditModal').classList.contains('show') && (await storedText(w,'n.md'))==='typed by hand' && last(ts)==='Saved n.md' && frames(w,'n.md')===1, JSON.stringify([ts,frames(w,'n.md')]));
  ck('no save failure went unhandled', !unhandled.length, JSON.stringify(unhandled)); unhandled.length=0;
}
{
  // a new file the browser refuses to store is not left in the list
  const {w,d,ts,a}=await setup([{create_file:'plan.md',replace:'PLAN'}]);
  refuse(w,'docPut'); ts.length=0;
  await applyCard(w,a.id,0);
  ck('Create file whose save is refused makes no file and says so', !J(w,'docs.some(x=>x.name==="plan.md")') && /^Couldn't save plan\.md — QuotaExceededError/.test(last(ts)) && !ts.some(t=>/^Created/.test(t)), JSON.stringify([J(w,'docs.map(x=>x.name)'),ts]));
  ck('its card offers Apply again, and the chat lists no missing file', hasApply(w,a.id,0) && /Couldn't save plan\.md/.test(stText(w,a.id,0)) && J(w,'chatDocIds(current).every(id=>docs.some(x=>x.id===id))'), JSON.stringify([stText(w,a.id,0),J(w,'chatDocIds(current)')]));
  ts.length=0; w.prompt=()=>'fresh.md';
  w.eval('openDocs()'); await tap(w,d.querySelector('#docNewBtn'));
  ck('Files → New file whose save is refused leaves no file behind, and opens nothing', !J(w,'docs.some(x=>x.name==="fresh.md")') && !d.querySelector('#docEditModal').classList.contains('show') && /^Couldn't save fresh\.md/.test(last(ts)), JSON.stringify([J(w,'docs.map(x=>x.name)'),ts]));
  allow(w); w.eval('closeDocs()'); ts.length=0;
  await applyCard(w,a.id,0);
  ck('stored again, the same card creates it once', J(w,'docs.filter(x=>x.name==="plan.md").length')===1 && last(ts)==='Created plan.md', JSON.stringify([J(w,'docs.map(x=>x.name)'),ts]));
  ck('no save failure went unhandled', !unhandled.length, JSON.stringify(unhandled)); unhandled.length=0;
}
// a double tap on Apply all, with the browser's own storage timing
for(const gap of [0,15]){
  const orig=Array.from({length:12},(_,i)=>'line '+i+' word'+i+';').join('\n');
  const {w,d,a}=await setup(Array.from({length:12},(_,i)=>({find:'word'+i+';',replace:'WORD'+i+';'})),orig);
  const b=msgNode(w,a.id).querySelector('[data-applyall]'); b.click(); await sleep(gap);
  const b2=msgNode(w,a.id).querySelector('[data-applyall]'); (b2||b).click();
  await until(()=>J(w,'current.messages.find(m=>m.id==='+JSON.stringify(a.id)+').edits.every(e=>e.status==="applied")'),4000); await sleep(400);
  const e=edits(w,a.id);
  ck('a second tap on Apply all '+gap+' ms later makes one batch, one undo step', e.every(x=>x.status==='applied') && new Set(e.map(x=>x.batch)).size===1 && frames(w,'n.md')===1, 'batches '+new Set(e.map(x=>x.batch)).size+', frames '+frames(w,'n.md')+', '+JSON.stringify([...new Set(e.map(x=>x.status))]));
  await tap(w,msgNode(w,a.id).querySelector('[data-undobatch]')); await sleep(200);
  ck('so its Undo gets the original back', docText(w,'n.md')===orig, JSON.stringify(docText(w,'n.md').slice(0,60)));
}
{
  // a double tap on a create card, and two cards making one name tapped back to back - with the
  // file store as slow as a phone's (30 ms a save), so the second tap lands while the first saves
  const {w,a}=await setup([{create_file:'plan.md',replace:'PLAN'}]);
  w.eval('{const put=DB.docPut;DB.docPut=d=>new Promise(r=>setTimeout(r,30)).then(()=>put(d));}');
  const c=cardsOf(w,a.id)[0].querySelector('[data-apply]'); c.click(); await sleep(0);
  const c2=cardsOf(w,a.id)[0].querySelector('[data-apply]'); (c2||c).click(); await sleep(400);
  ck('a double tap on a create card makes one file', J(w,'docs.filter(x=>x.name==="plan.md").length')===1, J(w,'docs.filter(x=>x.name==="plan.md").length'));
  await say(w,'two more','Sure.\n'+block([{create_file:'todo.md',replace:'A'},{create_file:'todo.md',replace:'B'}]));
  const r=lastReply(w);
  cardsOf(w,r.id)[0].querySelector('[data-apply]').click(); await sleep(0);
  cardsOf(w,r.id)[1].querySelector('[data-apply]').click(); await sleep(400);
  ck('two cards making todo.md, tapped back to back, make one; the second is told it exists', J(w,'docs.filter(x=>x.name==="todo.md").length')===1 && /already exists/.test(stText(w,r.id,1)), J(w,'docs.filter(x=>x.name==="todo.md").length')+' '+JSON.stringify(stText(w,r.id,1)));
}
process.off('unhandledRejection',onUR);
}

if(want(10)){
console.log('\n=== 10. "REPLACE EVERYWHERE" LEAVES THE NAME INSIDE LONGER WORDS ALONE ===');
const stOf=(w,mid,i)=>{const c=cardsOf(w,mid)[i];return c?c.querySelector('.st').textContent:'(no card)';};
async function renames(text,eds){
  const dom=await boot();const w=dom.window;
  await w.eval('(async()=>{const doc=await newDoc("story.md",'+JSON.stringify(text)+');newConvo();await attachDoc(doc.id);})()');
  await say(w,'rename them','Done.\n'+block(eds.map(e=>Object.assign({all:true},e))));
  const a=lastReply(w);
  for(let i=0;i<eds.length;i++) await applyCard(w,a.id,i);
  return {w,a};
}
{
  const {w,a}=await renames("Bob met Bobby. Bob's hat. Ren and Renata. Kira, Kiran and Kira.",[{find:'Bob',replace:'Robert'},{find:'Ren',replace:'Rhea'},{find:'Kira',replace:'Mira'}]);
  ck('a rename leaves the name inside longer words alone (Bobby, Renata, Kiran)', docText(w,'story.md')==="Robert met Bobby. Robert's hat. Rhea and Renata. Mira, Kiran and Mira.", JSON.stringify(docText(w,'story.md')));
  ck('and its card says how many it left alone', stOf(w,a.id,0)==='Applied · replaced 2 occurrences · 1 inside a longer word left alone', JSON.stringify(stOf(w,a.id,0)));
  await say(w,'thanks','ok');
  ck('the model is told the rule', /one inside a\s+longer word is left alone/.test(sysOf(w)), (sysOf(w).match(/Add "all": true[^\n]*\n[^\n]*\n?[^\n]*/)||['none'])[0]);
}
{
  // letters of any script, accents and combining marks included
  const {w}=await renames('Zoë and Zoëlle. José and Jose. Иван и Иванов, Иван. Bob\u{10330} and \u{10330}Bob and Bob\u{1F600}.',
    [{find:'Zoë',replace:'Chloé'},{find:'Jose',replace:'Pepe'},{find:'Иван',replace:'Пётр'},{find:'Bob',replace:'Rob'}]);
  ck('in any script: Zoëlle, José (an accent added after the e), Иванов and a letter outside the BMP are words of their own', docText(w,'story.md')==='Chloé and Zoëlle. José and Pepe. Пётр и Иванов, Пётр. Bob\u{10330} and \u{10330}Bob and Rob\u{1F600}.', JSON.stringify(docText(w,'story.md')));
}
{
  // Chinese, Japanese and Korean put no space between a name and the next word: there, every occurrence is renamed
  const {w}=await renames('Bob met Bobby. 小明说：小明的书。メアリは来た。철수가 왔다. 철수는 웃었다.',
    [{find:'Bob',replace:'Robert'},{find:'小明',replace:'小红'},{find:'メアリ',replace:'アンナ'},{find:'철수',replace:'영희'}]);
  ck('Bobby is left alone, while names in unspaced scripts are renamed everywhere', docText(w,'story.md')==='Robert met Bobby. 小红说：小红的书。アンナは来た。영희가 왔다. 영희는 웃었다.', JSON.stringify(docText(w,'story.md')));
}
{
  const {w,a}=await renames('Bobby and Bobbie came.',[{find:'Bob',replace:'Robert'}]);
  ck('a rename found only inside longer words changes nothing, and the card says why', docText(w,'story.md')==='Bobby and Bobbie came.' && /^Failed · found only inside longer words \(2\)/.test(stOf(w,a.id,0)), JSON.stringify([docText(w,'story.md'),stOf(w,a.id,0)]));
  await say(w,'and?','ok');
  ck('which is what the model is told', /1\. find "Bob" \(every occurrence\): FAILED — found only inside longer words/.test(stateLines(w,0)), JSON.stringify(stateLines(w,0).slice(0,160)));
}
}

if(want(11)){
console.log('\n=== 11. CHECK: NO FALSE "INVALID JSON"; TRANSPLANT NOTEPAD AND FIELD LABELS ===');
const dom=await boot();const w=dom.window,d=w.document;
async function check(name,text){
  await w.eval('(async()=>{const doc=await newDoc('+JSON.stringify(name)+','+JSON.stringify(text)+');openDocEditor(doc.id);})()');
  await tap(w,d.querySelector('#docCheckBtn'));
  const out=d.querySelector('#docLintOut').textContent, buttons=[...d.querySelectorAll('#docFixRow button')].map(b=>b.textContent);
  w.eval('hideDocEdit()');
  return {out,buttons,repair:buttons.includes('Repair JSON')};
}
const persona=await check('persona.md','{{user}} is a 27-year-old swordsman from Bali.\n{{char}} distrusts him at first.');
const card=await check('card.txt','{{char}} is a quiet librarian who hides a dragon.');
const broken=await check('notes.txt','{"name": "Kira", "role": "mage",}');
ck('Check reads "{{user}} is…" and "{{char}} is…" as prose, not invalid JSON - a broken object in a .txt still is', !/invalid JSON/.test(persona.out+card.out) && /invalid JSON/.test(broken.out) && broken.repair, JSON.stringify([persona.out.split('\n')[0],card.out.split('\n')[0],broken.out.split('\n')[0]]));
const refs=await check('sources.md','[1] Smith, The Long Road, 2019.\n[2] Doe, Rivers, 2021.');
const todo=await check('todo.md','[ ] buy ink\n[x] call Mira');
const list=await check('people.txt','[{"name": "Kira"},\n {"name": "Ren",}]');
ck('and "[1] Smith…" references and a "[ ] buy ink" checklist too - a broken list of objects still is', !/invalid JSON/.test(refs.out+todo.out) && /invalid JSON/.test(list.out), JSON.stringify([refs.out.split('\n')[0],todo.out.split('\n')[0],list.out.split('\n')[0]]));
ck('none of the notes offers "Repair JSON"', !persona.repair && !card.repair && !refs.repair && !todo.repair, JSON.stringify([persona.buttons,card.buttons,refs.buttons,todo.buttons]));

// a transplant as Summaryception writes it (buildTransplantExport), then damaged the ways an auditor damages it
const tp=(notepad,ledger,extra)=>'# SUMMARYCEPTION MEMORY TRANSPLANT\n<!-- SC-TRANSPLANT {"v":1} -->\n\n## NOTEPAD\n<!-- SC-NOTEPAD -->\n'+notepad+'\n<!-- /SC-NOTEPAD -->\n\n'+(extra||'')
  +'## CHARACTER LEDGER\n<!-- SC-LEDGER {"name":"Kira"} -->\n'+(ledger||'CORE: mage\nSTATE: injured\nARC: grows\nTHREADS:\n- the debt')+'\n<!-- /SC-LEDGER -->\n\n## MEMORY SNIPPETS (story order)\n<!-- SC-SNIPPET {"turns":"0-4"} -->\nThey met.\n<!-- /SC-SNIPPET -->\n';
const clean=await check('memory.md',tp('Kira and Ren travel north.'));
const two=await check('memory.md',tp('Kira and Ren travel north. The king is dead.',null,'<!-- SC-NOTEPAD -->\n\n<!-- /SC-NOTEPAD -->\n\n'));
ck('a second NOTEPAD is an error - the importer keeps only the last - and the inventory says what it keeps', /✖ a second SC-NOTEPAD/.test(two.out) && /notepad: no/.test(two.out) && /no marker damage/.test(clean.out) && /notepad: yes/.test(clean.out), JSON.stringify(two.out.split('\n').filter(l=>/NOTEPAD|notepad/.test(l))));
const open=await check('memory.md',tp('Kira and Ren travel north.').replace('<!-- /SC-NOTEPAD -->',''));
ck('a NOTEPAD with no closer is warned about, like every other block', /⚠ SC-NOTEPAD has no closer/.test(open.out), JSON.stringify(open.out.split('\n').slice(-3)));
const lower=await check('memory.md',tp('x','CORE: mage\nstate: injured\nARC: grows'));
ck('a lower-case "state:" is warned about - the importer files it into CORE', /⚠ SC-LEDGER "Kira": "state:" is not read as a field/.test(lower.out) && /into CORE/.test(lower.out), JSON.stringify(lower.out.split('\n').slice(-3)));
const bold=await check('memory.md',tp('x','**CORE:** mage\nSTATE: injured'));
ck('so is "**CORE:**" - before any field, the importer drops the line', /⚠ SC-LEDGER "Kira": "\*\*CORE:\*\*" is not read as a field/.test(bold.out) && /dropped/.test(bold.out), JSON.stringify(bold.out.split('\n').slice(-3)));
}

if(want(12)){
console.log('\n=== 12. "EXPORT ST WORLDBOOK" KEEPS A SILLYTAVERN EXPORT\'S OWN SETTINGS ===');
const dom=await boot();const w=dom.window,d=w.document;
// a SillyTavern World Info export, opened in Cozy and exported back
const E=(o)=>Object.assign({uid:0,key:[],keysecondary:[],comment:'',content:'',constant:false,vectorized:false,selective:true,selectiveLogic:0,addMemo:true,order:100,
  position:1,disable:false,excludeRecursion:false,preventRecursion:false,delayUntilRecursion:false,probability:100,useProbability:true,depth:4,group:'',groupOverride:false,
  groupWeight:100,scanDepth:null,caseSensitive:null,matchWholeWords:null,useGroupScoring:null,automationId:'',role:null,sticky:0,cooldown:0,delay:0,displayIndex:0},o);
const st={entries:{
  "0":E({uid:0,key:['castle'],keysecondary:['night','storm'],selectiveLogic:1,comment:'Castle',content:'The castle at night.',position:0,displayIndex:0}),
  "1":E({uid:1,key:['oath'],comment:'Oath',content:'The oath binds.',position:4,depth:2,role:1,displayIndex:1}),
  "2":E({uid:2,key:['draft'],comment:'Old draft',content:'Unused.',disable:true,displayIndex:2}),
  "3":E({uid:3,key:['note'],comment:'AN top',content:'A note.',position:2,displayIndex:3}),
  "4":E({uid:4,key:['king','crown'],comment:'King',content:'The king rules.',constant:true,selective:false,group:'royals',sticky:2,cooldown:1,excludeRecursion:true,scanDepth:6,caseSensitive:true,matchWholeWords:true,displayIndex:4}),
  // one written in Cozy's own words that also carries a uid: its position is mapped, not passed through as text
  "5":{uid:5,name:'Mixed',keys:['mix'],content:'Both.',strategy:'green',position:'before_char'}}};
await w.eval('(async()=>{const doc=await newDoc("lore.json",'+JSON.stringify(JSON.stringify(st,null,2))+');openDocEditor(doc.id);})()');
w.eval('window.__dl=[];download=function(n,t){window.__dl.push({n:n,t:t});}');
await tap(w,d.querySelector('#docCheckBtn'));
const btn=[...d.querySelectorAll('#docFixRow button')].find(b=>b.textContent==='Export ST worldbook');
await tap(w,btn);
const got=J(w,'window.__dl')||[];
const out=got[0]?JSON.parse(got[0].t).entries:{};
const by=name=>Object.values(out).find(x=>x.comment===name)||{};
const mixed=Object.values(out).find(x=>x.content==='Both.')||{};
ck('positions are kept: before the character (0), at depth (4), after (1), the Author\'s Note top (2) - and one in Cozy\'s words is mapped', by('Castle').position===0&&by('Oath').position===4&&by('Old draft').position===1&&by('AN top').position===2&&mixed.position===0&&JSON.stringify(mixed.key)==='["mix"]',
  JSON.stringify(['Castle','Oath','Old draft','AN top'].map(n=>by(n).position).concat([mixed.position,mixed.key])));
ck('an at-depth entry keeps its depth and its role', by('Oath').depth===2&&by('Oath').role===1, JSON.stringify([by('Oath').depth,by('Oath').role]));
ck('a disabled entry stays disabled', by('Old draft').disable===true, by('Old draft').disable);
ck('secondary keys and their logic are kept', JSON.stringify(by('Castle').keysecondary)==='["night","storm"]'&&by('Castle').selectiveLogic===1, JSON.stringify([by('Castle').keysecondary,by('Castle').selectiveLogic]));
ck('a constant entry keeps its keys, and every other setting it had (group, timing, recursion, scan depth, matching)',
  JSON.stringify(by('King').key)==='["king","crown"]'&&by('King').constant===true&&by('King').vectorized===false&&by('King').group==='royals'&&by('King').sticky===2&&by('King').cooldown===1
  &&by('King').excludeRecursion===true&&by('King').scanDepth===6&&by('King').caseSensitive===true&&by('King').matchWholeWords===true,
  JSON.stringify(by('King')).slice(0,300));
ck('so the export is the file it came from, entry for entry', ['Castle','Oath','Old draft','AN top','King'].every((n,i)=>JSON.stringify(by(n))===JSON.stringify(st.entries[String(i)])),
  ['Castle','Oath','Old draft','AN top','King'].filter((n,i)=>JSON.stringify(by(n))!==JSON.stringify(st.entries[String(i)])).join(','));
}

if(want(13)){
console.log('\n=== 13. A STORED REPLY WHOSE EDITS ARE NOT A LIST BREAKS NOTHING ===');
// a restored backup, or a record from another version, can hold anything where a reply's edits should be
// (an error in this test script itself still stops the run)
const errs=[];const onUR=e=>{const st=String((e&&e.stack)||e);if(/v5291filestest\.js/.test(st)){console.log('  FAIL (test crashed)',st);process.exit(1);}errs.push(String((e&&e.message)||e));};
process.on('unhandledRejection',onUR);
const dom=await boot();const w=dom.window,d=w.document;
w.addEventListener('error',e=>errs.push(String(e.message)));
const ts=watchToasts(w);
await w.eval('(async()=>{const doc=await newDoc("n.md","alpha beta gamma");newConvo();await attachDoc(doc.id);})()');
await w.eval(`(async()=>{
  const good={id:"e1",type:"replace",find:"alpha",replace:"ALPHA",file:"n.md",status:"pending"};
  current.messages.push(
    {id:"u1",role:"user",content:"one",ts:1},{id:"a1",role:"assistant",content:"first",ts:2,edits:"oops"},
    {id:"u2",role:"user",content:"two",ts:3},{id:"a2",role:"assistant",content:"second",ts:4,edits:{"0":{status:"applied",file:"n.md"}}},
    {id:"u3",role:"user",content:"three",ts:5},{id:"a3",role:"assistant",content:"third",ts:6,edits:[null,5,"x",good],vi:0,
      variants:[{content:"third",edits:[null,5,"x",good]},{content:"other",edits:"bad"}]},
    {id:"u4",role:"user",content:"four",ts:7},{id:"a4",role:"assistant",content:"fourth",ts:8,edits:42,editWarn:"the block was cut off"});
  await persist(); renderThread();
})()`);
const drawn=cardsOf(w,'a3').length;
await say(w,'and beta?','Sure.\n'+block([{find:'beta',replace:'BETA'}]));
ck('the thread draws its one real card, the next request goes out, and its reply\'s card arrives', drawn===1 && w.__reqs.length===1 && cardsOf(w,lastReply(w).id).length===1, drawn+' '+w.__reqs.length+' '+JSON.stringify(errs));
const st3=w.__reqs.length?stateLines(w,2):'';
ck('telling the model the state of the one real edit', /^1\. find "alpha" in "n\.md": pending/.test(st3) && !/\n2\./.test(st3), JSON.stringify(st3.slice(0,120))+' '+JSON.stringify(errs));
await tap(w,msgNode(w,'a3').querySelector('[data-applyall]'));
ck('Apply all applies it', docText(w,'n.md')==='ALPHA beta gamma' && ts.includes('1 applied'), JSON.stringify([docText(w,'n.md'),ts,errs]));
await tap(w,msgNode(w,'a3').querySelector('[data-undobatch]'));
ck('Undo undoes it', docText(w,'n.md')==='alpha beta gamma' && /Re-apply/.test((cardsOf(w,'a3')[0]||{}).textContent), JSON.stringify([docText(w,'n.md'),ts.slice(-1),errs]));
await applyCard(w,'a3',0);
ck('and it applies again', docText(w,'n.md')==='ALPHA beta gamma', JSON.stringify([docText(w,'n.md'),errs]));
await say(w,'status?','ok');
ck('a later request counts the file\'s applied edits from the real list only', /already includes 1 edit you proposed/.test(sysOf(w)), (sysOf(w).match(/already includes[^\]]*/)||['none'])[0]);
ck('and tells the model of the cut-off block the user sees on the reply with no list', /\[partial edit block: the block was cut off\]/.test(String(wireOf(w)||'').replace(/\\"/g,'"')) && !!(msgNode(w,'a4')&&msgNode(w,'a4').querySelector('[data-reblock]')), JSON.stringify(errs));
const n=w.__reqs.length;
await tap(w,msgNode(w,'a4')&&msgNode(w,'a4').querySelector('[data-reblock]'));
await until(()=>w.__reqs.length>n&&settled(w));
const asked=w.__reqs.length>n?w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user').pop().content:'(nothing was sent)';
ck('"Ask for the rest" on a reply whose edits are not a list counts none arrived', /^Your edit block was incomplete — 0 edits arrived/.test(asked), JSON.stringify(asked.slice(0,80)));
ck('nothing failed along the way', !errs.length, JSON.stringify(errs));
process.off('unhandledRejection',onUR);
}

if(want(14)){
console.log('\n=== 14. DELETE TAKES THE FILE OUT BEFORE THE DELETE IS AWAITED ===');
// the storage refusals below are collected; anything else unhandled is a broken test, and stops the run
const errs=[];const onUR=e=>{const m=String((e&&e.message)||e);if(!/QuotaExceededError/.test(m)){console.log('  FAIL (test crashed)',(e&&e.stack)||m);process.exit(1);}errs.push(m);};
process.on('unhandledRejection',onUR);
const storedNames=async w=>(await w.eval('IDB.docAll()')).map(x=>x.name).sort();
async function setup(){
  const dom=await boot();const w=dom.window,d=w.document;const ts=watchToasts(w);
  await w.eval('(async()=>{const a=await newDoc("keep.md","K");const doc=await newDoc("n.md","alpha");newConvo();await attachDoc(doc.id);await attachDoc(a.id);})()');
  return {w,d,ts};
}
{
  // the store takes its time over the delete (a phone's server, a busy disk): what happens meanwhile
  const {w,d,ts}=await setup();
  // the record is gone at once, but the store's answer takes its time
  w.eval('window.__go=null;{const del=DB.docDel;DB.docDel=id=>del(id).then(()=>new Promise(r=>{window.__go=r;}));}');
  w.eval('openDocEditor(docs.find(x=>x.name==="n.md").id)'); d.querySelector('#docEditArea').value='typed, then Delete';
  d.querySelector('#docDelBtn').click(); await sleep(30);
  const during={listed:J(w,'docs.some(x=>x.name==="n.md")'),editor:d.querySelector('#docEditModal').classList.contains('show'),inChat:J(w,'allChatDocs(current).some(x=>x.name==="n.md")')};
  ck('the file leaves the list, the chat and the editor before the delete is awaited', !during.listed && !during.editor && !during.inChat, JSON.stringify(during));
  // the page goes to the background meanwhile - the editor used to keep its typing then, saving the file back
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});
  d.dispatchEvent(new w.Event('visibilitychange')); await sleep(30);
  if(w.__go) w.__go(); await sleep(150);
  ck('so nothing saves it back: it is gone from storage', JSON.stringify(await storedNames(w))==='["keep.md"]' && (ts[ts.length-1]||"")==='Deleted', JSON.stringify([await storedNames(w),ts.slice(-2)]));
  Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'visible'});
}
{
  const {w,d,ts}=await setup();
  w.eval('DB.docDel=()=>Promise.reject(new Error("QuotaExceededError: the quota has been exceeded"))');
  w.eval('openDocEditor(docs.find(x=>x.name==="n.md").id)');
  await tap(w,d.querySelector('#docDelBtn'));
  const kept=await storedNames(w);
  ck('a delete the storage refuses puts the file back - listed, in the chat, stored - and says so', J(w,'docs.some(x=>x.name==="n.md")') && J(w,'allChatDocs(current).some(x=>x.name==="n.md")') && JSON.stringify(kept)==='["keep.md","n.md"]' && /^Couldn't delete n\.md — QuotaExceededError/.test((ts[ts.length-1]||"")),
    JSON.stringify([J(w,'docs.map(x=>x.name)'),kept,ts.slice(-2)]));
}
{
  // a chat the storage refuses to save does not stop the delete half-way
  const {w,d,ts}=await setup();
  w.eval('DB.put=()=>Promise.reject(new Error("QuotaExceededError: the quota has been exceeded"))');
  w.eval('openDocEditor(docs.find(x=>x.name==="n.md").id)');
  await tap(w,d.querySelector('#docDelBtn'));
  ck('a chat that cannot be saved does not stop the delete half-way', JSON.stringify(await storedNames(w))==='["keep.md"]' && !d.querySelector('#docEditModal').classList.contains('show') && (ts[ts.length-1]||"")==='Deleted', JSON.stringify([await storedNames(w),ts.slice(-2)]));
}
ck('no delete failure went unhandled', !errs.length, JSON.stringify(errs));
process.off('unhandledRejection',onUR);
}

if(want(15)){
console.log('\n=== 15. UTF-16 AND WINDOWS-1252 TEXT FILES READ CORRECTLY; IMPORT CHECKS LIKE ATTACH ===');
const dom=await boot();const w=dom.window,d=w.document;const ts=watchToasts(w);
const TEXT='Kira — café, “quoted”';
const u16le=[0xFF,0xFE];for(const ch of TEXT){const c=ch.charCodeAt(0);u16le.push(c&255,c>>8);}
const u16be=[0xFE,0xFF];for(const ch of TEXT){const c=ch.charCodeAt(0);u16be.push(c>>8,c&255);}
const cp1252=[...'Kira — café, “quoted”'].map(ch=>({'—':0x97,'é':0xE9,'“':0x93,'”':0x94}[ch]||ch.charCodeAt(0)));
const file=(bytes,name)=>new w.File([new Uint8Array(bytes)],name,{type:'text/plain'});
w.eval('newConvo()');
await w.eval('addAttachments')([file(u16le,'notes-le.txt'),file(u16be,'notes-be.txt')]);
await say(w,'read these','ok');
const u=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user').pop().content;
ck('a UTF-16 file (Notepad\'s "Unicode", either byte order) is attached as its text', (u.split(TEXT).length-1)===2 && !ts.some(t=>/isn't a text file/.test(t)), JSON.stringify([u.slice(0,200),ts]));
// one stray bad byte in a UTF-8 file leaves it UTF-8: its other letters are not turned into "Ã«"
const utf8bad=[...new TextEncoder().encode('Zoë ☕ ')].concat([0xFF],[...new TextEncoder().encode(' end')]);
await w.eval('addAttachments')([file(cp1252,'old-editor.txt'),file(utf8bad,'mostly-utf8.txt')]);
await say(w,'and these','ok');
const u2=w.__reqs[w.__reqs.length-1].messages.filter(m=>m.role==='user').pop().content;
ck('a Windows-1252 file is attached as its text - and a UTF-8 file with one bad byte stays UTF-8', u2.includes(TEXT) && u2.includes('Zoë ☕ � end') && !u2.includes('Ã'), JSON.stringify(u2.slice(0,300)));
// Files -> Import from device
async function importFile(f){
  const pick=d.querySelector('#docPicker');
  Object.defineProperty(pick,'files',{configurable:true,get:()=>[f]});
  pick.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(150); w.eval('hideDocEdit()');
}
await importFile(file(u16le,'imported-le.txt'));
await importFile(file(cp1252,'imported-1252.txt'));
ck('Import reads UTF-16 and Windows-1252 files as their text', docText(w,'imported-le.txt')===TEXT && docText(w,'imported-1252.txt')===TEXT, JSON.stringify([docText(w,'imported-le.txt'),docText(w,'imported-1252.txt')]));
ts.length=0;
await importFile(file([0x25,0x50,0x44,0x46,0,1,2,0,3],'paper.pdf'));
ck('Import refuses a file that is not text, as attaching does', !J(w,'docs.some(x=>x.name==="paper.pdf")') && ts.some(t=>/paper\.pdf isn't a text file/.test(t)), JSON.stringify([J(w,'docs.map(x=>x.name)'),ts]));
ts.length=0;
await importFile(new w.File(['a'.repeat(6*1024*1024+1)],'huge.txt',{type:'text/plain'}));
ck('and one past the 6 MB limit', !J(w,'docs.some(x=>x.name==="huge.txt")') && ts.some(t=>/huge\.txt is too big \(6 MB limit\)/.test(t)), JSON.stringify([J(w,'docs.map(x=>x.name)'),ts]));
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
})();
