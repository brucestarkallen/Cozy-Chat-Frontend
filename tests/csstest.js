// TEST FILE - not for pasting into SillyTavern. Run with: node tests/csstest.js
const fs=require('fs');const {JSDOM}=require('jsdom');
const css=fs.readFileSync(__dirname+'/../sillytavern-immersive.css','utf8');
const ST_BASE=`
.mes{display:flex;align-items:flex-start;padding:10px 10px 0 10px;margin-top:0;width:100%;position:relative}
.mes_block{padding-top:0;padding-left:10px;width:100%;overflow-x:hidden;overflow-y:clip}
.mes_text{padding-left:0;padding-top:5px;padding-bottom:5px;padding-right:5px}
.ch_name{font-weight:bolder}
.swipe_right,.swipe_left{width:25px;height:25px;opacity:.3}
.swipeRightBlock{position:absolute;right:0;bottom:0}
#chat{display:flex;flex-direction:column;overflow-x:hidden}
`;
const THEME=`
.mes{background-color:#171a24;border:1px solid #2a2f3d;border-radius:14px;padding:16px;margin:10px 0;backdrop-filter:blur(6px)}
.mes_block{background-color:#171a24;border-radius:12px}
.mes_text{text-align:justify;line-height:1.35}
.name_text{font-size:20px;font-weight:800;text-transform:none;letter-spacing:0}
`;
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const mes=(isUser,isSystem,last)=>`
<div class="mes${last?' last_mes':''}" mesid="1" ch_name="Bleach" is_user="${isUser}" is_system="${isSystem}">
  <div class="for_checkbox"></div><input type="checkbox" class="del_checkbox">
  <div class="mesAvatarWrapper"><div class="avatar"><img src=""></div>
    <div class="mesIDDisplay">#19</div><div class="mes_timer">3.4s</div>
    <div class="tokenCounterDisplay">812</div></div>
  <div class="swipe_left"></div>
  <div class="mes_block">
    <div class="ch_name flex-container justifySpaceBetween">
      <div class="flex-container flex1 alignitemscenter"><div class="flex-container alignItemsBaseline">
        <span class="name_text">Bleach</span><i class="mes_ghost"></i>
        <small class="timestamp">July 24, 2026 3:18 PM</small></div></div>
      <div class="mes_buttons"><div class="mes_button"></div></div>
    </div>
    <details class="mes_reasoning_details"><summary>Thought for 3 minutes</summary></details>
    <div class="mes_text">
      <div class="scene-card"><span class="left">pale light</span><span class="right">black kosode</span></div>
      <p>The world went white inside Zaraki's fists.</p><p>Jovan closed his hand.</p>
    </div>
    <div class="mes_bias"></div>
  </div>
  <div class="swipeRightBlock"><div class="swipe_right"></div><div class="swipes-counter">1/3</div></div>
</div>`;
const dom=new JSDOM(`<!DOCTYPE html><html><head><style>${ST_BASE}</style><style>${THEME}</style>
<style>.scene-card .right{text-align:right}</style><style>${css}</style></head>
<body><div id="chat">${mes('false','false',false)}${mes('true','false',false)}${mes('false','false',true)}${mes('false','true',false)}</div></body></html>`);
const d=dom.window.document,W=dom.window,cs=el=>W.getComputedStyle(el);
const all=d.querySelectorAll('#chat .mes');const ai=all[0],user=all[1],last=all[2],sys=all[3];

console.log('=== 1. CSS IS WELL FORMED ===');
{let dep=0,bad=false;for(const c of css){if(c==='{')dep++;if(c==='}'){dep--;if(dep<0)bad=true;}}
 ck('braces balanced',dep===0&&!bad,'depth '+dep);
 // Anything outside #chat could restyle unrelated parts of SillyTavern.
 // A :root block is allowed only if it declares nothing but our own variables.
 {
   const bare=css.replace(/\/\*[\s\S]*?\*\//g,'');
   const offenders=[];
   for(const chunk of bare.split('}')){
     if(!chunk.includes('{'))continue;
     const sel=chunk.split('{')[0].trim(), body=chunk.split('{').slice(1).join('{');
     if(sel.includes('#chat')||sel.includes('#top-settings-holder')||sel.startsWith('@media'))continue;
     if(sel===':root'){
       const decls=body.split(';').map(x=>x.trim()).filter(Boolean);
       if(decls.every(x=>x.startsWith('--immersive-')))continue;
       offenders.push(':root sets something other than our own variables');
       continue;
     }
     offenders.push(sel.slice(0,50));
   }
   ck('nothing styled outside #chat',offenders.length===0,offenders[0]||'clean');
 }
 // A comment containing */ closes itself early and everything after it leaks
 // out as broken CSS. The browser then discards the rest of the sheet silently.
 let probs=[],i=0;
 while(true){const a=css.indexOf('/*',i); if(a<0)break;
   const b=css.indexOf('*/',a+2); if(b<0){probs.push('unterminated');break;}
   if(css.slice(a+2,b).includes('/*'))probs.push(css.slice(a,b+2).replace(/\n/g,' ').slice(0,60));
   i=b+2;}
 ck('no comment closes itself early',probs.length===0,probs[0]||'clean');
 // and prove it: the browser must parse every rule we wrote
 const declared=css.replace(/\/\*[\s\S]*?\*\//g,'').split('{').length-1;
 const sheet=[...d.styleSheets].pop();
 let parsed=0;
 for(const r of sheet.cssRules){ parsed += r.cssRules ? r.cssRules.length+1 : 1; }
 ck('browser parsed every rule we wrote',parsed===declared,parsed+' parsed / '+declared+' written');}

console.log('\n=== 2. THE SCREENSHOT BUG: TEXT AND NAME HIT THE EDGE ===');
ck('message keeps a side gutter',cs(ai).paddingLeft==='16px'&&cs(ai).paddingRight==='16px',cs(ai).paddingLeft+' / '+cs(ai).paddingRight);
ck('name row not pushed outside',cs(ai.querySelector('.ch_name')).marginLeft==='0px',cs(ai.querySelector('.ch_name')).marginLeft);
ck('no max-width on the name row',['none',''].includes(cs(ai.querySelector('.ch_name')).maxWidth),cs(ai.querySelector('.ch_name')).maxWidth);
ck('measure on the message, centred',cs(ai).maxWidth==='46rem'&&cs(ai).marginLeft==='auto',cs(ai).maxWidth+' m:'+cs(ai).marginLeft);
ck('inner block no longer indents for a hidden avatar',cs(ai.querySelector('.mes_block')).paddingLeft==='0px',cs(ai.querySelector('.mes_block')).paddingLeft);

console.log('\n=== 3. THE THEME CARD IS GONE ===');
for(const [n,el] of [['on .mes',ai],['on .mes_block',ai.querySelector('.mes_block')],['on .mes_text',ai.querySelector('.mes_text')]]){
  const c=cs(el);
  ck('no background '+n,['rgba(0, 0, 0, 0)','transparent',''].includes(c.backgroundColor),c.backgroundColor);
  ck('no border '+n,c.borderTopWidth==='0px'||c.border==='0px',c.borderTopWidth||c.border);
  ck('no radius '+n,c.borderRadius==='0px',c.borderRadius);}
ck('theme blur removed',['none',''].includes(cs(ai).backdropFilter||''),cs(ai).backdropFilter||'none');

console.log('\n=== 4. JUSTIFIED TEXT, ALSO FROM THE THEME ===');
ck('body text left aligned',cs(ai.querySelector('.mes_text')).textAlign==='left',cs(ai.querySelector('.mes_text')).textAlign);
ck('paragraphs left aligned',cs(ai.querySelector('.mes_text > p')).textAlign==='left',cs(ai.querySelector('.mes_text > p')).textAlign);
ck('theme line-height overridden',cs(ai.querySelector('.mes_text')).lineHeight==='1.72',cs(ai.querySelector('.mes_text')).lineHeight);

console.log('\n=== 5. YOUR SCENE CARD SURVIVES ===');
ck('right-aligned element still right aligned',cs(ai.querySelector('.scene-card .right')).textAlign==='right',cs(ai.querySelector('.scene-card .right')).textAlign);
ck('scene card still present',!!ai.querySelector('.scene-card'));

console.log('\n=== 6. CHROME ===');
for(const [n,sel] of [['avatar column','.mesAvatarWrapper'],['id badge','.mesIDDisplay'],['timestamp','.timestamp'],
  ['timer','.mes_timer'],['token counter','.tokenCounterDisplay'],['ghost icon','.mes_ghost']])
  ck(n+' hidden',cs(ai.querySelector(sel)).display==='none');
{const n=cs(ai.querySelector('.name_text'));
 ck("name shrunk from the theme's 20px",n.fontSize==='10.5px',n.fontSize);
 ck('name uppercase',n.textTransform==='uppercase',n.textTransform);
 ck('name weight beaten down from 800',n.fontWeight==='600',n.fontWeight);
 ck('name dimmed',n.opacity==='0.45',n.opacity);}
ck('buttons start hidden',cs(ai.querySelector('.mes_buttons')).opacity==='0');
ck('newest message shows swipes more',cs(last.querySelector('.swipe_left')).opacity==='0.55',cs(last.querySelector('.swipe_left')).opacity);

console.log('\n=== 6b. THE PROSE HAS SOMETHING TO SIT ON ===');
{
  const c=cs(d.querySelector('#chat'));
  // jsdom doesn't resolve custom properties, so check the declaration itself
  ck('chat gets a solid reading surface',/#chat\s*\{[^}]*background-color:\s*var\(--immersive-page/.test(css));
  ck('surface has a fallback if the variable goes missing',
     /var\(--immersive-page,\s*#[0-9a-fA-F]{3,8}\s*\)/.test(css),
     (css.match(/var\(--immersive-page[^)]*\)/)||[''])[0]);
  ck('the variable is actually defined',/--immersive-page:\s*#[0-9a-fA-F]{3,8}/.test(css));
  ck('wallpaper blur removed',['none',''].includes(c.backdropFilter||''),c.backdropFilter||'none');
  ck('surface colour is tunable in one place',/--immersive-page:/.test(css));
  // a stray marker dropped into the name row by an extension must not show
  const row=ai.querySelector('.ch_name > div > div');
  const extra=d.createElement('span'); extra.className='someExtensionMarker'; extra.textContent='?';
  row.appendChild(extra);
  ck('unknown name-row marker hidden',cs(extra).display==='none',cs(extra).display);
  ck('the name itself still shows',cs(ai.querySelector('.name_text')).display!=='none');
  extra.remove();
}

console.log('\n=== 7. USER VS ASSISTANT ===');
ck('user turn has a left rule',cs(user.querySelector('.mes_text')).borderLeftWidth==='2px',cs(user.querySelector('.mes_text')).borderLeftWidth);
ck('user turn indented',cs(user.querySelector('.mes_text')).paddingLeft==='14px');
ck('assistant turn has no rule',cs(ai.querySelector('.mes_text')).borderLeftWidth==='0px',cs(ai.querySelector('.mes_text')).borderLeftWidth);
ck('system line italic',cs(sys.querySelector('.mes_text')).fontStyle==='italic');

console.log('\n=== 8. NOTHING ESSENTIAL LOST ===');
for(const [n,sel] of [['message text','.mes_text'],['name','.name_text'],['swipe arrow','.swipe_left'],
  ['swipe counter','.swipes-counter'],['buttons','.mes_buttons'],['reasoning','.mes_reasoning_details']])
  ck(n+' still rendered',cs(ai.querySelector(sel)).display!=='none',cs(ai.querySelector(sel)).display);

console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
process.exit(fail?1:0);
