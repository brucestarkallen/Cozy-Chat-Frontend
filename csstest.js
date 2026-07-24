const fs=require('fs');const {JSDOM}=require('jsdom');
const css=fs.readFileSync('./out/sillytavern-immersive.css','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};

console.log('=== 1. CSS IS WELL FORMED ===');
{
  let d=0,bad=false;
  for(const c of css){ if(c==='{')d++; if(c==='}'){d--; if(d<0)bad=true;} }
  ck('braces balanced', d===0&&!bad, 'depth '+d);
  // strip comments, then every rule must have a selector and a body
  const stripped=css.replace(/\/\*[\s\S]*?\*\//g,'');
  const rules=stripped.split('}').filter(r=>r.trim());
  let malformed=rules.filter(r=>r.includes('{')&&!r.split('{')[0].trim());
  ck('no rule with an empty selector', malformed.length===0, malformed[0]||'');
  ck('no smart quotes or stray unicode that would break parsing',
     !/[\u2018\u2019\u201C\u201D]/.test(stripped));
  const props=[...stripped.matchAll(/([a-z-]+)\s*:/g)].map(m=>m[1]);
  ck('uses only real property names', props.every(p=>/^[a-z][a-z0-9-]*$/.test(p)));
}

// ST's real message markup, copied from public/index.html#message_template
const mes=(isUser,isSystem,last)=>`
<div class="mes${last?' last_mes':''}" mesid="1" ch_name="Bleach" is_user="${isUser}" is_system="${isSystem}">
  <div class="for_checkbox"></div><input type="checkbox" class="del_checkbox">
  <div class="mesAvatarWrapper">
    <div class="avatar"><img src=""></div>
    <div class="mesIDDisplay">#19</div>
    <div class="mes_timer">3.4s</div>
    <div class="tokenCounterDisplay">812</div>
  </div>
  <div class="swipe_left fa-solid fa-chevron-left"></div>
  <div class="mes_block">
    <div class="ch_name flex-container justifySpaceBetween">
      <div class="flex-container flex1 alignitemscenter">
        <div class="flex-container alignItemsBaseline">
          <span class="name_text">Bleach</span>
          <small class="timestamp">July 24, 2026 3:18 PM</small>
        </div>
      </div>
      <div class="mes_buttons"><div class="mes_button"></div></div>
    </div>
    <details class="mes_reasoning_details"><summary>Thought for 3 minutes</summary><div class="mes_reasoning">r</div></details>
    <div class="mes_text"><p>The world went white inside Zaraki's fists.</p></div>
    <div class="mes_bias"></div>
  </div>
  <div class="flex-container swipeRightBlock flexFlowColumn flexNoGap">
    <div class="swipe_right fa-solid fa-chevron-right"></div>
    <div class="swipes-counter">1/3</div>
  </div>
</div>`;

const dom=new JSDOM(`<!DOCTYPE html><html><head><style>
/* a stand-in for ST's own theme, so we are overriding something real */
.mes{background:#1c1c2e;border:1px solid #333;border-radius:10px;padding:14px;margin:10px 0}
.mes_block{margin-left:10px}
.name_text{font-size:18px;font-weight:700;text-transform:none}
.mes_text{line-height:1.4}
</style><style>${css}</style></head>
<body><div id="chat">${mes('false','false',false)}${mes('true','false',false)}${mes('false','false',true)}${mes('false','true',false)}</div></body></html>`);
const d=dom.window.document, W=dom.window;
const cs=el=>W.getComputedStyle(el);
const all=d.querySelectorAll('#chat .mes');
const ai=all[0], user=all[1], last=all[2], sys=all[3];

console.log('\n=== 2. THE LEFT GAP IS GONE ===');
ck('avatar column hidden', cs(ai.querySelector('.mesAvatarWrapper')).display==='none',
   cs(ai.querySelector('.mesAvatarWrapper')).display);
ck('selection checkbox hidden', cs(ai.querySelector('.del_checkbox')).display==='none');
ck('message block has no left margin', cs(ai.querySelector('.mes_block')).marginLeft==='0px',
   cs(ai.querySelector('.mes_block')).marginLeft);

console.log('\n=== 3. THE BUBBLE IS GONE ===');
ck('no background colour', ['rgba(0, 0, 0, 0)','transparent',''].includes(cs(ai).backgroundColor),
   cs(ai).backgroundColor);
ck('no border', cs(ai).border==='0px'||cs(ai).borderWidth==='0px'||cs(ai).border==='0', cs(ai).border);
ck('no rounded corners', cs(ai).borderRadius==='0px', cs(ai).borderRadius);
ck('no box padding', cs(ai).paddingTop==='0px'&&cs(ai).paddingLeft==='0px',
   cs(ai).padding);
ck('spacing kept below instead', cs(ai).paddingBottom==='1.6em'||parseFloat(cs(ai).paddingBottom)>0,
   cs(ai).paddingBottom);

console.log('\n=== 4. METADATA HIDDEN ===');
for (const [n,sel] of [['timestamp','.timestamp'],['id badge','.mesIDDisplay'],
                        ['generation timer','.mes_timer'],['token counter','.tokenCounterDisplay']]){
  ck(n+' hidden', cs(ai.querySelector(sel)).display==='none');
}

console.log('\n=== 5. NAME IS A QUIET LABEL ===');
{
  const n=cs(ai.querySelector('.name_text'));
  ck('small', n.fontSize==='10.5px', n.fontSize);
  ck('uppercase', n.textTransform==='uppercase', n.textTransform);
  ck('letterspaced', n.letterSpacing==='0.09em', n.letterSpacing);
  ck('dimmed', n.opacity==='0.5', n.opacity);
  ck('overrode the theme font-size (18px → 10.5px)', n.fontSize!=='18px');
}

console.log('\n=== 6. READING MEASURE ===');
{
  const t=cs(ai.querySelector('.mes_text'));
  ck('line height opened up', t.lineHeight==='1.72', t.lineHeight);
  ck('measure capped', t.maxWidth==='46em', t.maxWidth);
  ck('centred', t.marginLeft==='auto'&&t.marginRight==='auto', t.marginLeft+' / '+t.marginRight);
  ck('left aligned, not justified', t.textAlign==='left', t.textAlign);
  ck('name row shares the same measure', cs(ai.querySelector('.ch_name')).maxWidth==='46em');
}

console.log('\n=== 7. USER TURNS READ DIFFERENTLY ===');
{
  const u=cs(user.querySelector('.mes_text'));
  ck('user has a left rule', u.borderLeftWidth==='2px', u.borderLeftWidth);
  ck('user is indented from it', u.paddingLeft==='14px', u.paddingLeft);
  ck('user text sits back', u.opacity==='0.82', u.opacity);
  ck('assistant text has no rule', cs(ai.querySelector('.mes_text')).borderLeftWidth!=='2px',
     cs(ai.querySelector('.mes_text')).borderLeftWidth||'none');
}

console.log('\n=== 8. CHROME STAYS OUT OF THE WAY ===');
ck('buttons start invisible', cs(ai.querySelector('.mes_buttons')).opacity==='0',
   cs(ai.querySelector('.mes_buttons')).opacity);
ck('swipe arrows dimmed but present', cs(ai.querySelector('.swipe_left')).opacity==='0.25',
   cs(ai.querySelector('.swipe_left')).opacity);
ck('newest message brings swipes forward', cs(last.querySelector('.swipe_left')).opacity==='0.6',
   cs(last.querySelector('.swipe_left')).opacity);
ck('reasoning block dimmed, not hidden',
   cs(ai.querySelector('.mes_reasoning_details')).opacity==='0.6' &&
   cs(ai.querySelector('.mes_reasoning_details')).display!=='none');
ck('system lines italic and faded',
   cs(sys.querySelector('.mes_text')).fontStyle==='italic', cs(sys.querySelector('.mes_text')).fontStyle);

console.log('\n=== 9. NOTHING ESSENTIAL WAS HIDDEN ===');
for (const [n,sel] of [['message text','.mes_text'],['name','.name_text'],
                        ['swipe left','.swipe_left'],['swipe counter','.swipes-counter'],
                        ['message buttons','.mes_buttons'],['reasoning','.mes_reasoning_details']]){
  ck(n+' still rendered', cs(ai.querySelector(sel)).display!=='none', cs(ai.querySelector(sel)).display);
}

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
