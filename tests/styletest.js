// Guards the exact failure in the screenshot: a control with no rule falls back
// to the browser default, which on a dark theme is a glaring white box.
const fs=require('fs');const {JSDOM}=require('jsdom');require('fake-indexeddb/auto');
const html=fs.readFileSync('./out/index.html','utf8');
let pass=0,fail=0;
const ck=(n,ok,x)=>{console.log((ok?'  ok  ':'  FAIL'),n,x===undefined?'':'→ '+x);ok?pass++:fail++;};
const WHITEISH=['rgb(255, 255, 255)','white','rgba(0, 0, 0, 0)','transparent',''];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.com/',
  beforeParse(w){
    w.indexedDB=global.indexedDB;w.IDBKeyRange=global.IDBKeyRange;
    w.navigator.storage={estimate:async()=>({usage:0})};
    w.requestAnimationFrame=cb=>setTimeout(cb,0);
    w.confirm=()=>true;w.prompt=(q,d)=>d||'X';w.navigator.clipboard={writeText:async()=>{}};
    w.localStorage.setItem('cozychat:settings',JSON.stringify({
      providers:[{id:'p1',preset:'custom',kind:'openai',name:'T',url:'https://a/v1',apiKey:'k',model:'m',ctx:9000}],
      activeProvider:'p1',presets:[{id:'d',name:'D',system:'M',
        injections:[{id:'x',name:'x',text:'X',role:'system',pos:'relative',depth:0,enabled:true}],
        order:['__main__','x','__chat__']}],activePreset:'d',prompts:[],theme:'dark',
      search:{on:false,provider:'native',key:'',count:5,relay:'',always:false}}));
  }});
setTimeout(()=>{
  const w=dom.window,d=w.document,cs=el=>w.getComputedStyle(el);
  d.querySelector('#settingsBtn').dispatchEvent(new w.Event('click',{bubbles:true}));
  d.querySelectorAll('.tab')[2].dispatchEvent(new w.Event('click',{bubbles:true}));
  d.querySelector('[data-edit="x"]').dispatchEvent(new w.Event('click',{bubbles:true}));

  console.log('=== every control in the prompt editor is styled ===');
  // jsdom does not resolve var(), and drops shorthand declarations containing
  // it, so computed colours read as transparent even when the rule is fine.
  // Match rules against the element instead — that part jsdom does correctly.
  const sheets=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  const bare=sheets.replace(/\/\*[\s\S]*?\*\//g,'');
  const rules=[];
  {
    let depth=0,buf='';
    for (const part of bare.split('}')){
      // keep @media blocks out of the flat list; their inner rules still parse
      const chunk=(buf+part);
      if(!chunk.includes('{')){ buf=''; continue; }
      const br=chunk.indexOf('{');
      const sel=chunk.slice(0,br).trim(), body=chunk.slice(br+1);
      buf='';
      if(sel.startsWith('@')) continue;
      for(const one of sel.split(',')) if(one.trim()) rules.push({sel:one.trim(),body:body});
    }
  }
  const setsFor=(el,prop)=>rules.filter(r=>{
    let m=false; try{ m=el.matches(r.sel); }catch(_){}
    return m && new RegExp('(^|;|\\s)'+prop+'\\s*:').test(r.body);
  });
  const probe=(label,el,prop)=>{
    const hits=setsFor(el,prop);
    ck(label, hits.length>0, hits.length?('set by  '+hits[hits.length-1].sel):'NO RULE SETS IT');
  };

  const ta=d.querySelector('.ord-editor textarea');
  ck('editor is open', !!ta);
  probe('textarea gets a background (not the browser default)', ta, 'background');
  probe('textarea gets a text colour', ta, 'color');
  probe('textarea gets a border', ta, 'border');
  ck('textarea fills the row', cs(ta).width==='100%', cs(ta).width);
  // previews are a fixed height; real editing happens in the full-screen editor
  ck('preview has a usable fixed height', parseInt(cs(ta).height)>=90, cs(ta).height);
  ck('preview is read-only so it cannot become a nested scroller', ta.readOnly===true);
  ck('a full-screen editor exists to edit it in', !!d.querySelector('#bigArea'));
  // The real invariant: the block editor must be styled by the SAME rules as
  // the main system prompt, not by bespoke ones. Inventing separate rules is
  // what left it unstyled twice.
  const mainTa=d.querySelector('#sysPrompt');
  const rulesFor=el=>setsFor(el,'background').map(r=>r.sel).sort().join(' | ');
  ck('block textarea shares the main prompt\'s rules',
     rulesFor(ta)===rulesFor(mainTa), rulesFor(ta)+'   vs   '+rulesFor(mainTa));
  ck('and its size rules too',
     setsFor(ta,'min-height').map(r=>r.sel).join()===setsFor(mainTa,'min-height').map(r=>r.sel).join(),
     setsFor(ta,'min-height').map(r=>r.sel).join()||'none');
  ck('block textarea carries the standard class', ta.classList.contains('f'));
  ck('it sits in a standard field', !!ta.closest('.field'));

  const nm=d.querySelector('.ord-editor input[type=text]');
  probe('name field gets a background', nm, 'background');
  ck('name field fills the row', cs(nm).width==='100%', cs(nm).width);

  const sel0=d.querySelector('.ord-editor select');
  probe('select gets a background', sel0, 'background');
  ck('select fills its column', cs(sel0).width==='100%', cs(sel0).width);

  d.querySelector('[data-injpos="x"]').value='chat';
  d.querySelector('[data-injpos="x"]').dispatchEvent(new w.Event('change',{bubbles:true}));
  const num=d.querySelector('.ord-editor input[type=number]');
  ck('depth field appears', !!num);
  if (num){
    probe('depth field gets a background', num, 'background');
    ck('depth field fills the row', cs(num).width==='100%', cs(num).width);
  }
  // pin the harness limitation so this workaround cannot outlive its reason
  ck('harness note: jsdom still cannot resolve var() (see comment)',
     WHITEISH.includes(cs(ta).backgroundColor), cs(ta).backgroundColor);

  console.log('\n=== nothing was orphaned by the rename ===');
  // A class is dead if its name appears nowhere outside the stylesheets —
  // that covers names built by string concatenation in JS, which a
  // class="..." scan would miss.
  const nonCss=html.replace(/<style>[\s\S]*?<\/style>/g,'');
  const defined=new Set();
  for (const m of bare.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  const dead=[...defined].filter(c=>!new RegExp('(^|[^\\w-])'+c.replace(/[-]/g,'\\-')+'([^\\w-]|$)').test(nonCss));
  ck('no CSS rule left with nothing using it', dead.length===0, dead.join(', ')||'clean');

  // and the reverse: a class written into markup that no rule styles. That is
  // how the white textarea happened, and how .row-toggle nearly happened again.
  const used=new Set();
  for (const m of nonCss.matchAll(/class=\\?["']([^"'\\]+)/g))
    for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  // classes that only mark state or are targeted by [data-*] carry no styling
  const stateOnly=/^(hidden|show|on|off|active|open|done|pending|error|dragging|drop-target|armed|last_mes)$/;
  const unstyled=[...used].filter(c=>!defined.has(c) && !stateOnly.test(c));
  ck('no class in the markup is left unstyled', unstyled.length===0, unstyled.join(', ')||'clean');

  console.log('\n'+(fail?'FAILED '+fail:'ALL PASS')+'  ('+(pass+fail)+' checks)');
  process.exit(fail?1:0);
},900);
