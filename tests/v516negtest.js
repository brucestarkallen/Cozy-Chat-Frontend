// NEGATIVE TEST — run with: node tests/v516negtest.js
//
// A guard that has never failed is an unproven guard. This puts each v5.16.0
// bug back, one at a time, and requires tests/v516test.js to catch it. A
// mutation that survives means the check for it is decorative.
//
// It edits index.html in place and restores it from memory afterwards, then
// verifies the file is byte-identical to what it started as. A control run on
// the unmutated file goes first: without it, a harness that is simply broken
// reports every mutation as caught while proving nothing.
const fs=require('fs');const cp=require('child_process');
const FILE=__dirname+'/../index.html';
const GATE=__dirname+'/v516test.js';
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
  const line=(r.stdout||'').split('\n').filter(l=>l.indexOf('RESULT:')===0).pop()||'(no result line)';
  return {ok:r.status===0,line:line};
}

// Each mutation is the bug it reintroduces, described from the user's side.
const MUTATIONS=[
  ['Claude is sent the flag and thinking fields it rejects',
   '  const flag = pfField(wire.fields ? cfg.flagField : "");\n  const seed = pfField(wire.fields ? cfg.reasoningField : "");',
   '  const flag = pfField(cfg.flagField);\n  const seed = pfField(cfg.reasoningField);'],

  ['a reply being continued has its opening moved into the thinking field',
   '  if (tail && tail.role === "assistant"){\n    if (!flag.name) return { applied:false, reason:PF_REASON.NOTHING_TO_DO, detail:detail };\n    tail[flag.name] = true;\n    detail.flagField = flag.name;\n    return { applied:true, reason:PF_REASON.APPLIED, detail:detail };\n  }',
   '  if (tail && tail.role === "assistant" && false){\n    return { applied:false, reason:PF_REASON.NOTHING_TO_DO, detail:detail };\n  }'],

  ['a trailing space survives into the turn Anthropic rejects it on',
   '  msg.content = msg.content.replace(/\\s+$/, "");\n  if (flag.name)',
   '  if (flag.name)'],

  ['the saved reply starts mid-sentence because the prefill is not echoed',
   '  if (cfg.echo && msg.content) detail.echo = msg.content;',
   '  if (false && cfg.echo && msg.content) detail.echo = msg.content;'],

  ['a connection that already refused a prefill is offered one again',
   '  if (wire.refused) return { applied:false, reason:PF_REASON.WIRE_REFUSED, detail:detail };',
   ''],

  ['Claude is sent a prefill while thinking is on, and 400s',
   '  if (wire.thinking) return { applied:false, reason:PF_REASON.THINKING_CONFLICT, detail:detail };',
   ''],

  ['the flag overwrites the thinking seed when both have the same name',
   '  if (flag.name && flag.name === seed.name)\n    return { applied:false, reason:PF_REASON.FIELD_COLLISION, detail:{ why:\'both are named "\' + flag.name + \'"\' } };',
   ''],

  ['a field name that is part of the message replaces part of the message',
   '  if (PF_RESERVED.indexOf(name) >= 0) return { name:name, ok:false, why:\'"\' + name + \'" is part of the message itself\' };',
   ''],

  ['a field name with spaces is sent as a key the service ignores',
   '  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { name:name, ok:false, why:\'"\' + name + \'" is not a usable field name\' };',
   ''],

  ['a tag with regex characters in it matches things it should not',
   'function pfEscape(v){ return String(v).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"); }',
   'function pfEscape(v){ return String(v); }'],

  ['a seeded thinking field is sent to a request that switched thinking off',
   '    body.thinking = { type: (eff === "off" && !forced) ? "disabled" : "enabled" };',
   '    body.thinking = { type: eff === "off" ? "disabled" : "enabled" };'],

  ['turning thinking on for a seed also invents an effort level',
   '  if (style === "zai"){\n    body.thinking = { type: (eff === "off" && !forced) ? "disabled" : "enabled" };\n    if (eff !== "off" && eff !== "low") body.reasoning_effort = eff;',
   '  if (style === "zai"){\n    body.thinking = { type: (eff === "off" && !forced) ? "disabled" : "enabled" };\n    if (forced || (eff !== "off" && eff !== "low")) body.reasoning_effort = eff || "medium";'],

  ['a refused prefill costs the message instead of being sent again without it',
   '      if (res.status === 400 && PF_REFUSAL.test(detail)){',
   '      if (false && res.status === 400 && PF_REFUSAL.test(detail)){'],

  ['the refusal is not remembered, so every message pays for it again',
   '        markPrefillDown(p);',
   '        '],

  ['a reason code reaches the user as jargon',
   '  "wire-refused": "Skipped: this connection refused a prefilled reply, so it isn\'t offered one.",',
   ''],

  ['More is prefilled by default, silently changing what the button does',
   '  if (mode === "continue" && !cfg.applyToContinue) return { applied:false, reason:PF_REASON.CONTINUE_EXCLUDED, detail:detail };',
   ''],

  ['a prefill that reduces to nothing is sent as an empty assistant turn',
   '  if (!msg.content && !detail.reasoningField && !detail.flagField)\n    return { applied:false, reason:PF_REASON.NOTHING_TO_DO, detail:detail };',
   ''],

  ['web search sends tools and a half-written reply together',
   '  if (cfg.skipOnTools && wire.tools) return { applied:false, reason:PF_REASON.TOOLS_PRESENT, detail:detail };',
   ''],

  ['the field-name shortcut keeps claiming credit for a name typed by hand',
   'on("#pfFlag",  "change", function(e){ pfSet({ flagField:e.target.value.trim(), profile:"" }); renderPrefill(); });',
   'on("#pfFlag",  "change", function(e){ pfSet({ flagField:e.target.value.trim() }); renderPrefill(); });'],

  ['a chat cannot hold its own prefill because only the global is read',
   'function pfCfg(c){\n  return Object.assign({}, PF_DEFAULT, S.prefill || {}, (chatCfg(c) || {}).prefill || {});\n}',
   'function pfCfg(c){\n  return Object.assign({}, PF_DEFAULT, S.prefill || {});\n}'],

  ['a setting ships with nothing explaining what it does',
   '            <div class="hint">Where the seeded reasoning is sent. Blank means the prefill stays entirely in the reply text.</div>\n',
   ''],

  ['the prefill moves into assembleMessages, so a Hermes run sends an empty input',
   '  return { messages: merged, system: system };\n}',
   '  applyPrefill(merged, pfCfg(c), Object.assign(pfWire(activeProv(c), c), { tools:false }), null);\n  return { messages: merged, system: system };\n}'],

  ['the panel stops reporting what happened to the last message',
   '  lastPrefill = pf;',
   '  '],
];

(function main(){
  try {
    console.log('=== CONTROL: the gate passes on an unmutated file ===');
    const c=gate();
    ck('control run is green',c.ok,c.line);
    if(!c.ok){
      console.log('\nCONTROL FAILED — every mutation below would read as caught while proving nothing.');
      process.exitCode=1;
      return;
    }

    /* Slicing exists so a long run can be done in pieces without a piece
       being cut off half way. `node tests/v516negtest.js 0 8` runs the first
       eight. With no arguments it runs the lot. */
    const from=Number(process.argv[2]||0), to=Number(process.argv[3]||MUTATIONS.length);
    console.log('\n=== MUTATIONS '+from+'..'+Math.min(to,MUTATIONS.length)+' of '+MUTATIONS.length+': each bug must be caught ===');
    fs.writeFileSync(BAK,original,'utf8');
    for (const [label,find,replace] of MUTATIONS.slice(from,to)){
      const n=original.split(find).length-1;
      if(n!==1){ ck('MUTATION TARGET "'+label+'" appears exactly once',false,n+' occurrences'); continue; }
      fs.writeFileSync(FILE,original.replace(find,replace),'utf8');
      const r=gate();
      ck(label,!r.ok,r.ok?'SURVIVED — '+r.line:r.line.replace('RESULT: ',''));
      fs.writeFileSync(FILE,original,'utf8');
    }
  } finally {
    restore();
  }
  const restored=fs.readFileSync(FILE,'utf8')===original;
  ck('index.html is byte-identical to where it started',restored);
  console.log('\nRESULT: '+(fail?('FAILURES: '+fail+' of '+(pass+fail)):('ALL PASS ('+pass+' checks)')));
  process.exit(fail?1:0);
})();
