// TEST FILE — run with: node tests/v513test.js
// Guards v5.13.0: the deterministic Check. Whitespace/JSON lints with
// undoable one-tap fixes; a Summaryception transplant lint that mirrors the
// real importer move-for-move (case-sensitive markers, opener-to-next-opener
// segments, first-closer-of-kind wins, payload strictness) and flags exactly
// what it silently drops; linear comment scan that cannot freeze the phone;
// worldbook to SillyTavern World Info export with the exact PEM mapping; and
// the two seeded briefs (Worldbook Maker, Summaryception Auditor) that seed
// once and stay deleted.
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

// helpers: run engine functions in the window with args passed as JSON —
// exactly one escaping layer, so a newline is a newline on both sides
const call=(w,expr)=>JSON.parse(w.eval('JSON.stringify(' + expr + ')'));
const lint=(w,text)=>call(w,'scTransplantLint(' + JSON.stringify(text) + ')');

const GOOD_TP = [
'<!-- SC-TRANSPLANT {"v":1} -->',
'<!-- SC-NOTEPAD -->','starting canon here','<!-- /SC-NOTEPAD -->',
'<!-- SC-LEDGER {"name":"Jovan"} -->','CORE: protagonist','STATE: alive','<!-- /SC-LEDGER -->',
'<!-- SC-SNIPPET {"turns":"1-5"} -->','they met at the gate','<!-- SC-DETAIL -->','long detail','<!-- /SC-SNIPPET -->',
'<!-- SC-PIN {"label":"vow"} -->','"I will return."','<!-- /SC-PIN -->'].join(NL);

(async()=>{
const dom=await boot(base()); const w=dom.window;

console.log('=== 1. MIRROR FIDELITY: A CLEAN TRANSPLANT IS CLEAN, INVENTORY EXACT ===');
{
  const o=lint(w,GOOD_TP);
  ck('zero issues on a clean export', o.issues.length===0, JSON.stringify(o.issues));
  ck('inventory: 1 snippet', o.counts.snippets===1);
  ck('inventory: 1 dossier', o.counts.ledger===1);
  ck('inventory: 1 pin, notepad yes', o.counts.pins===1&&o.counts.notepad===true);
}

console.log('=== 2. EVERY SILENT-LOSS CLASS THE IMPORTER HAS, FLAGGED WITH A LINE ===');
{
  const bad=[
'<!-- sc-ledger {"name":"Lower"} -->','CORE: x','<!-- /SC-LEDGER -->',
'<!-- SC-LEDGER {"name":"A"} broken -->',
'<!-- SC-LEDGER {"name":} -->','CORE: x','<!-- /SC-LEDGER -->',
'<!-- SC-LEDGER -->','CORE: x','<!-- /SC-LEDGER -->',
'<!-- SC-LEDGER {"name":"B"} -->','no field lines at all','<!-- /SC-LEDGER -->',
'<!-- SC-LEDGER {"name":"C"} -->','CORE: one','<!-- /SC-LEDGER -->',
'<!-- SC-LEDGER {"name":"C"} -->','CORE: two','<!-- /SC-LEDGER -->',
'<!-- SC-SNIPPET -->','<!-- SC-DETAIL -->','detail only','<!-- /SC-SNIPPET -->',
'<!-- SC-PIN -->','<!-- /SC-PIN -->',
'<!-- SC-SNIPPET -->','body that never closes',
'<!-- /SC-NOTEPAD -->'].join(NL);
  const o=lint(w,bad);
  const has=re=>o.issues.some(i=>re.test(i.msg));
  ck('wrong-case marker → ignored-text error', has(/IGNORE/));
  ck('payload not valid JSON', has(/payload is not valid JSON/));
  ck('nameless ledger → dossier dropped', has(/no name in its payload/));
  ck('fieldless ledger → dossier dropped', has(/no CORE\/STATE\/ARC\/THREADS/));
  ck('duplicate ledger name → overwrite warning', has(/duplicate SC-LEDGER "C"/));
  ck('empty snippet → dropped (detail dies with it)', has(/no summary text/));
  ck('empty pin → dropped', has(/SC-PIN is empty/));
  ck('unclosed block warned', has(/no closer before the next marker/));
  ck('stray closer warned', has(/stray \/SC-NOTEPAD/));
  ck('every issue carries a line number', o.issues.every(i=>i.line>=1));
  // mirror truth: the unclosed snippet ABSORBS the stray closer as body text,
  // so the importer keeps it — the lint must count what the importer counts
  ck('only what the importer keeps is counted', o.counts.ledger===1&&o.counts.snippets===1&&o.counts.pins===0, JSON.stringify(o.counts));
  const iso=lint(w,'before'+NL+'<!-- SC-DETAIL -->'+NL+'orphan');
  ck('orphan SC-DETAIL (isolated) warned', iso.issues.some(i=>/SC-DETAIL outside any SC-SNIPPET/.test(i.msg)));
}

console.log('=== 3. THE PLATFORM-FREEZE CLASS: LINEAR SCAN UNDER A VANDALIZED PASTE ===');
{
  const junk=('x <!-- sc- garbage without a closer follows sometimes <!-- more ').repeat(3000)+' end';
  const t0=Date.now();
  const o=lint(w,junk);
  const ms=Date.now()-t0;
  ck('180KB of stray sc- comments lints fast (linear walk)', ms<1000, ms+'ms');
  ck('and still reports the dead markers', o.issues.length>0);
}

console.log('=== 4. WHITESPACE + JSON LINTS, FIXES PRESERVE CONTENT ===');
{
  const messy='a  b'+NL+'c '+NL+'d'+String.fromCharCode(9)+'e'+NL+'  indented stays';
  const o=call(w,'lintDoc('+JSON.stringify('x.md')+','+JSON.stringify(messy)+')');
  const has=re=>o.issues.some(i=>re.test(i.msg));
  ck('double space found', has(/double space/));
  ck('trailing whitespace found', has(/trailing whitespace/));
  ck('tab found', has(/tab characters/));
  const fixedIn='a  b'+NL+'  indented  x';
  const fixed=call(w,'fixDoubles('+JSON.stringify(fixedIn)+')');
  ck('fixDoubles collapses inline, keeps indentation', fixed==='a b'+NL+'  indented x', JSON.stringify(fixed));
  ck('json validity: bad flagged', call(w,'lintDoc('+JSON.stringify('w.json')+','+JSON.stringify('{"a":1,}')+')').jsonBad===true);
  const brokenJson='{"a":"l1'+NL+'l2",}';
  const repaired=call(w,'JSON.parse(fixJsonText('+JSON.stringify(brokenJson)+')).a');
  ck('fixJsonText repairs trailing comma + raw newline, keeps content', repaired==='l1'+NL+'l2', JSON.stringify(repaired));
  const commaVal='{"a":"opts: [x, y, ]",}';
  ck('value with a comma inside brackets is NOT mutilated (string-aware repair)',
    call(w,'JSON.parse(fixJsonText('+JSON.stringify(commaVal)+')).a')==='opts: [x, y, ]');
  ck('unrepairable JSON returns null, never a wrong guess', call(w,'fixJsonText('+JSON.stringify('{"a": tru')+')')===null);
}

console.log('=== 5. WORLDBOOK TO ST WORLD INFO: THE EXACT PEM MAPPING ===');
{
  const wbdoc=JSON.stringify([
    {name:'King',strategy:'blue',keys:['king'],content:'the king',position:'before_char',order:900},
    {name:'General',strategy:'green',keys:['general','sword'],content:'a general',probability:80},
    {name:'Vibe',strategy:'chain',keys:[],content:'ambient mood',position:'at_depth',depth:2},
    {name:'Ghost',strategy:'green',keys:[],content:''}]);
  const st=call(w,'worldbookToST(parseWorldbook('+JSON.stringify(wbdoc)+').entries)');
  const e=st.entries;
  ck('blue → constant, not vectorized, keys stripped', e['0'].constant===true&&e['0'].vectorized===false&&e['0'].key.length===0);
  ck('blue before_char → position 0, order kept', e['0'].position===0&&e['0'].order===900);
  ck('green → selective + keys + vector-eligible', e['1'].selective===true&&e['1'].key.length===2&&e['1'].vectorized===true&&e['1'].constant===false);
  ck('probability 80 → useProbability true', e['1'].probability===80&&e['1'].useProbability===true);
  ck('chain → pure vectorized, at_depth with depth kept', e['2'].vectorized===true&&e['2'].selective===false&&e['2'].position===4&&e['2'].depth===2);
  const warns=call(w,'lintWorldbook(parseWorldbook('+JSON.stringify(wbdoc)+').entries)');
  ck('export warnings: keyless green + empty content', warns.some(x=>/no keys/.test(x))&&warns.some(x=>/empty content/.test(x)));
  const stShape=JSON.stringify({entries:{"0":{comment:'From ST',content:'c',constant:true,key:[]}}});
  const round=call(w,'parseWorldbook('+JSON.stringify(stShape)+')');
  ck('ST-format shape round-trips into the parser as blue', !round.error&&round.entries.length===1&&round.entries[0].strategy==='blue');
}

console.log('=== 6. THE SEEDED BRIEFS: PRESENT ONCE, EDITABLE, DELETION STICKS ===');
{
  ck('Worldbook Maker seeded', w.eval("S.presets.some(p=>p.id==='seed-wb'&&p.name==='Worldbook Maker'&&p.system.length>3000)"));
  ck('Summaryception Auditor seeded', w.eval("S.presets.some(p=>p.id==='seed-sc'&&p.system.length>10000)"));
  ck('auditor brief adapted to Cozy ([FILE], not [DOCUMENT])',
    w.eval("S.presets.find(p=>p.id==='seed-sc').system.includes('[FILE]') && !S.presets.find(p=>p.id==='seed-sc').system.includes('[DOCUMENT]')"));
  ck('auditor teaches the marker-safety rules', w.eval("/replace_all/.test(S.presets.find(p=>p.id==='seed-sc').system)"));
  const after=await w.eval("(()=>{ S.presets=S.presets.filter(p=>p.id!=='seed-sc'); saveSettings();"
    + " const raw=JSON.parse(localStorage.getItem('cozychat:settings'));"
    + " return raw.seeded513===true && !raw.presets.some(p=>p.id==='seed-sc'); })()");
  ck('deleting a seed sticks across the seeding logic (flag persisted)', after===true);
}
dom.window.close();

console.log(NL+'RESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
