// NEGATIVE TEST — run with: node tests/searchnegtest.js
//
// A guard that has never failed is an unproven guard. This puts each v5.21.0
// bug back, one at a time, and requires tests/searchtest.js to catch it. A
// mutation that survives means the check for it is decorative.
//
// It edits index.html in place and restores it from memory afterwards, then
// verifies the file is byte-identical to what it started as. A control run on
// the unmutated file goes first: without it, a harness that is simply broken
// reports every mutation as caught while proving nothing.
//
// Not part of the plain gate loop — it runs the search gate a dozen times over
// and takes a couple of minutes. Run it after touching anything the search
// loop reads, in slices if a session cannot hold a long call:
//
//     node tests/searchnegtest.js        # all of them
//     node tests/searchnegtest.js 0 4    # a slice
const fs=require('fs');const cp=require('child_process');
const FILE=__dirname+'/../index.html';
const GATE=__dirname+'/searchtest.js';
const BAK=FILE+'.negbak';
/* A `finally` does not run when the process is killed, and a harness that is
   killed mid-mutation leaves the bug in the working tree looking like code
   somebody wrote. The backup is on disk before the first edit and is put back
   at startup, so an interrupted run costs nothing and cannot be mistaken for
   a change. */
if (fs.existsSync(BAK)){
  fs.writeFileSync(FILE,fs.readFileSync(BAK,'utf8'),'utf8');
  fs.unlinkSync(BAK);
  console.log('recovered index.html from an interrupted run');
}
const original=fs.readFileSync(FILE,'utf8');
const restore=()=>{ try{ fs.writeFileSync(FILE,original,'utf8'); if(fs.existsSync(BAK)) fs.unlinkSync(BAK); }catch(_){} };
for (const sig of ['SIGINT','SIGTERM','SIGHUP']) process.on(sig,()=>{ restore(); process.exit(130); });
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};

function gate(){
  const r=cp.spawnSync('node',[GATE],{encoding:'utf8',timeout:300000});
  const out=r.stdout||'';
  const line=out.split('\n').filter(l=>l.indexOf('RESULT:')===0).pop()||'(no result line)';
  const first=(out.split('\n').filter(l=>l.indexOf('  FAIL')===0)[0]||'').slice(6).trim();
  return {ok:r.status===0,line:line,first:first};
}

/* The round's exits and the clear that has to precede all of them are one
   block, and the bug is the clear moving to the far end of it. Deriving the
   pair from the file rather than transcribing it means this mutation cannot
   drift out of date without failing loudly as a missing anchor. */
const CLEAR='    raw = ""; asst.content = ""; asst.thinking = "";\n';
function movedClear(){
  const a=original.indexOf(CLEAR+'    showSearching(');
  if (a<0) return null;
  const b=original.indexOf('    searchNote = "";\n',a);
  if (b<0) return null;
  const block=original.slice(a,b+'    searchNote = "";\n'.length);
  return [block, block.slice(CLEAR.length)+CLEAR];
}

// Each mutation is the bug it reintroduces, described from the user's side.
const MUTATIONS=[
  ["Claude's own tool waits for the user to ask first",
   '    && (opts.search || S.search.model !== false) && !opts.probe;',
   '    && opts.search && !opts.probe;'],

  ['a reply is a lookup request however much else it says',
   '    if (rest.length > 240 || rest.indexOf("```") >= 0) return null;',
   '    if (false) return null;'],

  ['the lookup request is never cleared, so it rides into the answer',
   CLEAR+'    showSearching(asst.id, ask.queries);',
   '    showSearching(asst.id, ask.queries);'],

  ['the request is cleared only once the round has survived every exit',
   null, null],   // filled in from the file below

  ['a round that never ran reads as an empty reply',
   '    if (!asst.content && !asst.thinking) asst.content = searchNote || "_(empty reply)_";',
   '    if (!asst.content && !asst.thinking) asst.content = "_(empty reply)_";'],

  ['a request that outlived its rounds is shown to the user as the reply',
   '    if (autoSearchTextOn() && parseSearchCall({ text: asst.content, think: asst.thinking })){',
   '    if (false && autoSearchTextOn() && parseSearchCall({ text: asst.content, think: asst.thinking })){'],

  ['a lookup that failed is not recorded, so the model asks for it again',
   '    um.searchedFor = (um.searchedFor || []).concat([q]);\n    try {\n      const sr = await runSearch(q);',
   '    try {\n      const sr = await runSearch(q);\n      um.searchedFor = (um.searchedFor || []).concat([q]);'],

  ['a search that came back empty never reaches the wire',
   '      if (m.role === "user" && ((m.sources && m.sources.length) || (m.searchedFor && m.searchedFor.length))){',
   '      if (m.role === "user" && (m.sources && m.sources.length)){'],

  ['the rounds never run out',
   '    if (continuing || searchRound >= AUTO_SEARCH_ROUNDS || !autoSearchTextOn()) break;',
   '    if (continuing || !autoSearchTextOn()) break;'],

  ['the protocol never reaches the system prompt',
   '  if (autoSearchTextOn()) sysParts.push(searchProtocol());',
   '  if (false) sysParts.push(searchProtocol());'],

  ["the text protocol goes out beside Claude's own tool",
   '  return !!(S.search.on && S.search.model !== false\n    && S.search.provider !== "native" && S.search.key);',
   '  return !!(S.search.on && S.search.model !== false && S.search.key);'],
];
const mv=movedClear();
if (mv){ MUTATIONS[3][1]=mv[0]; MUTATIONS[3][2]=mv[1]; }

const args=process.argv.slice(2).map(Number).filter(n=>!isNaN(n));
const from=args.length?args[0]:0, to=args.length>1?args[1]:(args.length?args[0]:MUTATIONS.length-1);

console.log('=== CONTROL: the gate passes on the file as it stands ===');
const ctl=gate();
ck('unmutated, the search gate is green',ctl.ok,ctl.line);
if(!ctl.ok){ console.log('\nRESULT: the harness cannot prove anything against a red gate.'); process.exit(1); }

console.log('\n=== MUTATIONS: each bug must be caught ===');
fs.writeFileSync(BAK,original,'utf8');
for (let i=from;i<=to && i<MUTATIONS.length;i++){
  const [label,oldTxt,newTxt]=MUTATIONS[i];
  if (oldTxt==null){ ck('['+i+'] '+label,false,'anchor could not be derived from the file'); continue; }
  const n=original.split(oldTxt).length-1;
  if (n!==1){ ck('['+i+'] '+label,false,'anchor appears '+n+' times, expected 1'); continue; }
  fs.writeFileSync(FILE,original.replace(oldTxt,newTxt),'utf8');
  const r=gate();
  ck('['+i+'] '+label,!r.ok,r.ok?'SURVIVED — the check for it is decorative':r.first);
  fs.writeFileSync(FILE,original,'utf8');
}
restore();
ck('index.html is byte-identical to what it started as',
   fs.readFileSync(FILE,'utf8')===original);

console.log('\nRESULT:',fail?('FAILURES: '+fail):'ALL PASS','('+pass+' checks)');
process.exit(fail?1:0);
