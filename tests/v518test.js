// TEST FILE — run with: node tests/v518test.js
// Guards v5.18.0: the file a model reads is the file that exists.
//
// The failure this exists to prevent. A file is mutable state; a conversation
// is an append-only log. Storing a file's contents inside a turn wrote a value
// that would change into a place that never does — so every past value kept
// riding on every later request. Attaching a file on four turns put five
// copies on the wire: four dead snapshots and the live one, all under the same
// name, none marked as historical. From the model's side that is one file with
// five contradictory bodies. It quotes a dead copy, the quote does not exist in
// the real file, the edit fails or lands nowhere — and because the dead copy
// still shows the pre-edit text, work the user already applied looks undone and
// gets proposed again. Every symptom reported (wrong text located, fixes
// circling, turns indistinguishable, no idea which message was newest) comes
// out of that one defect.
//
// Same class, second instance: an excerpted file. authorshipLine() tells the
// model its applied edits are present in the text above; retrieval scored the
// chunks against the newest message only, so the chunk an applied edit landed
// in could be dropped — and the instructions then contradicted themselves.
//
// Third: on Anthropic a system block travels as a user turn, and consecutive
// user turns merge. Unlabelled, the instruction set's standing blocks read as
// the newest thing the user said.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const st=k=>({
  providers:[{id:'p1',preset:k==='anthropic'?'anthropic':'custom',kind:k,name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:100000}],
  activeProvider:'p1',
  presets:[{id:'d',name:'D',system:'be helpful',injections:[
    {id:'i1',name:'r',role:'system',pos:'chat',depth:0,enabled:true,text:'REMINDER: stay in character.'}],
    order:['__main__','__chat__']}],
  activePreset:'d',prompts:[],temperature:1,maxTokens:4096,effort:'off',squashSystem:true,
  showThinking:true,catchThinkTags:true,thinkTags:'think',enterSends:false,autoTitle:false,theme:'dark',
  search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}});
function boot(s){return new Promise(res=>{
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
    beforeParse(w){
      w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
      w.navigator.storage={estimate:async()=>({usage:0})};
      w.requestAnimationFrame=cb=>setTimeout(cb,0);
      w.confirm=()=>true;w.navigator.vibrate=()=>true;
      w.localStorage.setItem('cozychat:settings',JSON.stringify(s));
    }});
  setTimeout(async()=>{try{await dom.window.eval('Promise.all([DB.clear(),DB.docClear()])');}catch(_){}res(dom);},800);});}
const txt=m=>typeof m.content==='string'?m.content:JSON.stringify(m.content);
const all=r=>r.messages.map(txt).join('\n\u0000\n');

// four turns each carrying a snapshot of the same file, plus the live copy
const SEED=`
convos=[];
docs=[{id:'d1',name:'story.md',text:'V4 LIVE BODY',updatedAt:1,undo:[]}];
current={id:'c1',title:'t',messages:[],docIds:['d1'],filesOn:true};convos=[current];
for(let k=1;k<=3;k++){
  current.messages.push({id:'u'+k,role:'user',content:'turn '+k,ts:k,
    attachments:[{kind:'text',name:'story.md',text:'V'+k+' DEAD BODY'}]});
  current.messages.push({id:'a'+k,role:'assistant',content:'ok',ts:k});
}
current.messages.push({id:'u4',role:'user',content:'MY NEWEST MESSAGE',ts:9,
  attachments:[{kind:'text',name:'story.md',text:'V4 LIVE BODY'}]});
`;

(async()=>{
const dom=await boot(st('openai'));const w=dom.window;

/* ---- 1. an editable file of that name is the only truth for that name ---- */
w.eval(SEED);
let r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
let A=all(r);
ck('no dead snapshot body reaches the wire', !/DEAD BODY/.test(A));
ck('not even the newest snapshot, when the file is editable', !/V4 LIVE BODY/.test(A));
ck('no fenced file dump survives in the conversation', !/```story\.md/.test(A));
ck('the live file is still sent, once, in the instructions', /\[FILE: story\.md\]\nV4 LIVE BODY/.test(r.system));
ck('exactly one [FILE: story.md] heading', (r.system.match(/\[FILE: story\.md\]/g)||[]).length===1,
  (r.system.match(/\[FILE: story\.md\]/g)||[]).length);
ck('every suppressed copy says where the real text is',
  (A.match(/Its current contents are in your instructions/g)||[]).length===4,
  (A.match(/Its current contents are in your instructions/g)||[]).length);
ck('the newest turn still ends with what the user typed',
  /MY NEWEST MESSAGE$/.test(txt(r.messages.filter(m=>m.role==='user').pop())));

/* ---- 2. with no editable file, the newest snapshot is the one sent ------- */
w.eval('docs=[];current.docIds=[];current.filesOn=false;');
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));A=all(r);
ck('older snapshots still suppressed with no editable file', !/DEAD BODY/.test(A));
ck('the newest snapshot keeps its body', /```story\.md\nV4 LIVE BODY\n```/.test(A));
ck('older copies point forward, not at the instructions',
  (A.match(/an older copy of "story\.md"/g)||[]).length===3,
  (A.match(/an older copy of "story\.md"/g)||[]).length);
ck('no [FILE:] heading when nothing is editable', !/\[FILE: story\.md\]/.test(r.system));

/* ---- 3. two different files both survive; one name is not the other ----- */
w.eval(`current.messages=[{id:'x1',role:'user',content:'q',ts:1,attachments:[
  {kind:'text',name:'a.md',text:'ALPHA BODY'},{kind:'text',name:'b.md',text:'BETA BODY'}]}];`);
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));A=all(r);
ck('unrelated files are not collapsed into each other', /ALPHA BODY/.test(A)&&/BETA BODY/.test(A));

/* ---- 4. a repeated name inside one message is sent once ----------------- */
w.eval(`current.messages=[{id:'x1',role:'user',content:'q',ts:1,attachments:[
  {kind:'text',name:'a.md',text:'FIRST'},{kind:'text',name:'a.md',text:'SECOND'}]}];`);
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));A=all(r);
ck('a name repeated within one message yields one body',
  (A.match(/```a\.md/g)||[]).length===1,(A.match(/```a\.md/g)||[]).length);

/* ---- 5. images are untouched by any of this ----------------------------- */
w.eval(`current.messages=[{id:'x1',role:'user',content:'q',ts:1,attachments:[
  {kind:'image',name:'p.png',mime:'image/png',data:'AAAA'}]}];`);
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
ck('an image attachment still goes out as a content block',
  Array.isArray(r.messages[0].content)&&r.messages[0].content.some(b=>b.type==='image_url'));

/* ---- 6. pure function, no conversation needed --------------------------- */
ck('attachmentBody: editable file wins',
  /instructions under \[FILE: z\.md\]/.test(w.eval(
    'attachmentBody({kind:"text",name:"z.md",text:"T"},0,{live:{"z.md":1},newest:{"z.md":0}})')));
ck('attachmentBody: superseded snapshot points forward',
  /an older copy/.test(w.eval(
    'attachmentBody({kind:"text",name:"z.md",text:"T"},0,{live:{},newest:{"z.md":3}})')));
ck('attachmentBody: the only copy keeps its body',
  w.eval('attachmentBody({kind:"text",name:"z.md",text:"T"},3,{live:{},newest:{"z.md":3}})')==='```z.md\nT\n```');
ck('attachmentBody: a nameless attachment is keyed as "file"',
  w.eval('attachmentBody({kind:"text",text:"T"},0,{live:{},newest:{"file":0}})')==='```file\nT\n```');

/* ---- 7. retrieval keeps what the authorship note claims is present ------ */
// the budget is 7000 chars — the file has to exceed it or retrieval never runs
const filler='FILLER PARAGRAPH about swords and combat. '.repeat(160);
const doc=filler+'\n\nZANGETSU UNSHEATHED HERE.\n\n'+filler;
w.eval(`docs=[{id:'d1',name:'big.md',mode:'smart',text:${JSON.stringify(doc)},updatedAt:1,undo:[]}];
current={id:'c2',title:'t',docIds:['d1'],filesOn:true,messages:[
 {id:'u1',role:'user',content:'fix it',ts:1},
 {id:'a1',role:'assistant',content:'done',ts:2,edits:[{id:'e1',type:'find',file:'big.md',
   find:'old',replace:'ZANGETSU UNSHEATHED HERE.',status:'applied'}]},
 {id:'u2',role:'user',content:'now say more about filler paragraph combat',ts:3}]};convos=[current];`);
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
ck('the file is excerpted at all (guard is meaningful)', /relevant excerpts/.test(r.system));
ck('the excerpt is genuinely shorter than the file', r.system.length < doc.length, r.system.length+' vs '+doc.length);
ck('a smart file that fits whole is not labelled an excerpt', (()=>{
  /* docSmart() needs more than 2000 characters, relevantChunks() returns the
     text whole under 7000 — the heading defect only lives in that window. */
  const short='a paragraph that is well inside the retrieval budget.\n\n'.repeat(55);
  w.eval(`docs[0].text=${JSON.stringify(short)}`);
  const rr=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
  w.eval(`docs[0].text=${JSON.stringify(doc)}`);
  return !/relevant excerpts/.test(rr.system) && rr.system.indexOf(short)>=0;})());
ck('an applied edit survives retrieval', r.system.indexOf('ZANGETSU UNSHEATHED HERE.')>=0);
ck('the authorship note is still there to be true about', /already includes 1 edit/.test(r.system));

/* an undone edit is NOT in the file, so it must not be force-kept */
w.eval(`current.messages[1].edits[0].undone=true;current.messages[1].edits[0].status='applied';`);
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
ck('an undone edit is not forced into the excerpt', r.system.indexOf('ZANGETSU UNSHEATHED HERE.')<0);
w.eval(`delete current.messages[1].edits[0].undone;`);

/* a full rewrite is the whole file — forcing it would be the whole budget */
w.eval(`current.messages[1].edits[0].type='replace_all';`);
r=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
ck('a replace_all is never used as a must-keep span', r.system.indexOf('ZANGETSU UNSHEATHED HERE.')<0);
w.eval(`current.messages[1].edits[0].type='find';`);

/* relevantChunks stays pure and backward compatible */
ck('relevantChunks with no must-list is unchanged',
  w.eval(`relevantChunks(${JSON.stringify(doc)},"swords",900)===relevantChunks(${JSON.stringify(doc)},"swords",900,[])`));
ck('relevantChunks returns short text whole', w.eval('relevantChunks("tiny","q",7000)')==='tiny');
/* The cap only bites on a span that is oversized AND actually in the text — a
   needle matching nothing is skipped whether or not the cap exists, so testing
   with one proves nothing. It also has to sit inside a single chunk, and
   chunks only grow past 1200 characters when a paragraph does, so the fixture
   is built from long paragraphs on purpose. */
const paraA='SWORDS combat blades steel. '.repeat(55);
const paraB='cooking rice simmering broth. '.repeat(52);
const twoZone=[paraA,paraA,paraA,paraA,paraB,paraB,paraB,paraB].join('\n\n');
const okNeedle=paraB.slice(100,300), bigNeedle=paraB.slice(100,1400);
ck('the fixture can hold an oversized span in one chunk (cap is reachable)',
  bigNeedle.length>1200 && paraB.length>bigNeedle.length, bigNeedle.length+'/'+paraB.length);
ck('a must-span under the cap is honoured',
  w.eval(`relevantChunks(${JSON.stringify(twoZone)},"swords",3000,[${JSON.stringify(okNeedle)}])`)
    .indexOf('cooking rice')>=0);
ck('a must-span longer than 1200 chars is ignored, not budget-eating',
  w.eval(`relevantChunks(${JSON.stringify(twoZone)},"swords",3000,[${JSON.stringify(bigNeedle)}])`)
    === w.eval(`relevantChunks(${JSON.stringify(twoZone)},"swords",3000)`));
/* One span, two homes: the first chunk holding it is too large to afford, the
   second is not. Abandoning the scan at the first would lose the span. */
const huge='NEEDLEMARK padding text that goes on. '.repeat(70);
const tail='NEEDLEMARK TAILMARK short paragraph.';
const twoHomes=[huge,paraA,paraA,tail].join('\n\n');
ck('an unaffordable first occurrence does not abandon the span',
  w.eval(`relevantChunks(${JSON.stringify(twoHomes)},"swords",3000,["NEEDLEMARK"])`)
    .indexOf('TAILMARK')>=0);
ck('a must-list alone still produces an excerpt when nothing scores',
  w.eval(`relevantChunks(${JSON.stringify(doc)},"",900,["ZANGETSU UNSHEATHED HERE."])`).indexOf('ZANGETSU UNSHEATHED HERE.')>=0);

/* ---- 8. the seam between the user's voice and the instruction set ------- */
const dom2=await boot(st('anthropic'));const w2=dom2.window;
w2.eval(`docs=[];current={id:'c1',title:'t',docIds:[],filesOn:false,messages:[
 {id:'u1',role:'user',content:'hello',ts:1},{id:'a1',role:'assistant',content:'hi',ts:2},
 {id:'u2',role:'user',content:'MY NEWEST MESSAGE',ts:3}]};convos=[current];`);
let r2=JSON.parse(w2.eval('JSON.stringify(assembleMessages("anthropic",current))'));
const last=txt(r2.messages[r2.messages.length-1]);
ck('the standing block is named where it merges into a user turn',
  /\[instruction-set block/.test(last)&&/\[\/instruction-set block\]/.test(last));
ck('the user\'s own words are outside that label',
  last.indexOf('MY NEWEST MESSAGE') < last.indexOf('[instruction-set block'));
ck('the merge still happens — no consecutive user turns on the wire',
  !r2.messages.some((m,i)=>i&&m.role==='user'&&r2.messages[i-1].role==='user'));
ck('the conversation still alternates', (()=>{
  for(let i=1;i<r2.messages.length;i++) if(r2.messages[i].role===r2.messages[i-1].role) return false;
  return true;})());
/* ---- 9. an image turn is still a turn, and must fold like one ----------- */
w2.eval(`current={id:'c3',title:'t',docIds:[],filesOn:false,messages:[
 {id:'u1',role:'user',content:'look at this',ts:1,attachments:[
   {kind:'image',name:'p.png',mime:'image/png',data:'AAAA'}]}]};convos=[current];`);
const r4=JSON.parse(w2.eval('JSON.stringify(assembleMessages("anthropic",current))'));
ck('an image turn does not leave two user turns in a row on the Anthropic wire',
  !r4.messages.some((m,i)=>i&&m.role==='user'&&r4.messages[i-1].role==='user'),
  r4.messages.map(m=>m.role).join('>'));
ck('the folded image turn keeps both the block and the image',
  Array.isArray(r4.messages[0].content)
  && r4.messages[0].content.some(b=>b.type==='image')
  && r4.messages[0].content.some(b=>b.type==='text'&&/instruction-set block/.test(b.text)),
  JSON.stringify(r4.messages[0].content.map(b=>b.type)));
/* Deleting a reply leaves two user turns adjacent, and a turn can be empty.
   Folding an empty string in as a block is a 400 from Anthropic, so the empty
   case has to be reachable here or the guard is unproven. */
w2.eval(`current={id:'c4',title:'t',docIds:[],filesOn:false,messages:[
 {id:'u1',role:'user',content:'look',ts:1,attachments:[
   {kind:'image',name:'p.png',mime:'image/png',data:'AAAA'}]},
 {id:'u2',role:'user',content:'',ts:2}]};convos=[current];`);
const r5=JSON.parse(w2.eval('JSON.stringify(assembleMessages("anthropic",current))'));
ck('an empty adjacent turn still folds to one turn',
  !r5.messages.some((m,i)=>i&&m.role==='user'&&r5.messages[i-1].role==='user'),
  r5.messages.map(m=>m.role).join('>'));
ck('no empty text block is produced by the fold',
  !r5.messages.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='text'&&!b.text))
  && !r4.messages.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='text'&&!b.text)));
ck('openai keeps a real system role and needs no label', (()=>{
  const ro=JSON.parse(w.eval('JSON.stringify(assembleMessages("openai",current))'));
  return !ro.messages.some(m=>/instruction-set block/.test(txt(m)));})());

/* ---- 10. assembly reads the chat, it never rewrites it ----------------- */
w2.eval(`current={id:'c5',title:'t',docIds:[],filesOn:false,messages:[
 {id:'u1',role:'user',content:'look',ts:1,attachments:[
   {kind:'image',name:'p.png',mime:'image/png',data:'AAAA'},
   {kind:'text',name:'n.md',text:'BODY'}]},
 {id:'a1',role:'assistant',content:'ok',ts:2},
 {id:'u2',role:'user',content:'again',ts:3}]};convos=[current];`);
const before=w2.eval('JSON.stringify(current.messages)');
const once=w2.eval('JSON.stringify(assembleMessages("anthropic",current))');
const twice=w2.eval('JSON.stringify(assembleMessages("anthropic",current))');
ck('assembling twice gives the same wire', once===twice);
ck('assembling does not rewrite the stored conversation',
  before===w2.eval('JSON.stringify(current.messages)'));

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
