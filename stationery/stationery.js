async function api(path,opts){
  return fetch("/api"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...opts});
}
async function promptForLogin(){
  while(true){
    const password=prompt("Editor password:");
    if(password===null)throw new Error("login cancelled");
    const res=await api("/login/editor",{method:"POST",body:JSON.stringify({password})});
    if(res.ok)return;
    alert("Wrong password — try again.");
  }
}
function esc(s){return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmtRev(rev){const d=new Date(rev||"");if(isNaN(d))return"";return d.toLocaleDateString(undefined,{day:"numeric",month:"short"})+", "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});}

// Fixed pipeline, in order — a piece moves left to right. Kept as a closed
// list rather than free text so the status pill can style "done" and the
// overdue rule can tell in-flight from finished without matching prose.
const STATUSES=["To do","Designing","Proofing","Ordered","Received","Sent"];
const DONE_STATUSES=new Set(["Received","Sent"]);

let data=null, revisionId=null, editing=false, session=null;

async function loadSession(){
  const res=await api("/whoami");
  const body=await res.json();
  session=body.session;
}

async function loadData(){
  let res=await api("/stationery");
  if(res.status===403){
    await promptForLogin();
    await loadSession();
    res=await api("/stationery");
  }
  if(!res.ok)throw new Error("failed to load stationery data");
  const body=await res.json();
  data=body.data;
  revisionId=body.revisionId;
  // Seven pieces, each a mockup and a brief — the whole page fits without
  // hunting, so rows open by default and collapse is for getting one out
  // of the way. The copy inside each stays collapsed; that's the long part.
  expanded=new Set((data.items||[]).map(i=>i.id));
}

function money(n){
  const v=Number(n);
  if(!v)return "";
  return v.toLocaleString(undefined,{maximumFractionDigits:2});
}
function fmtDue(s){
  if(!s)return "";
  const d=new Date(s+"T00:00:00");
  if(isNaN(d))return s;
  return d.toLocaleDateString(undefined,{day:"numeric",month:"short"});
}
// A due date only counts as late while the piece is still in flight —
// something already Received/Sent isn't overdue no matter what its date says.
function isLate(item){
  if(!item.dueDate||DONE_STATUSES.has(item.status))return false;
  const d=new Date(item.dueDate+"T00:00:00");
  return !isNaN(d)&&d<new Date(new Date().toDateString());
}
// "To do" renders no pill at all — a piece nobody has started is the
// default state, and badging every row with it says nothing.
function statusClass(s){
  return DONE_STATUSES.has(s)?"pill done":"pill active";
}

/* ---------- Wording ----------
   A piece's `wording` is the copy that actually gets printed on it. It's
   long-form free text, so it lives behind a click rather than in the row:
   the collapsed row stays a one-line inventory, expanding shows the full
   note and the wording. EXAMPLES are starting points, offered only when a
   piece has no wording yet and never applied automatically — a real wedding's
   copy is nothing a template should guess at, and silently filling the field
   would make an example indistinguishable from a decision. Keyed on the
   piece name lowercased, so a renamed piece just loses its example, not its
   wording. Downloading gives the printer a plain .txt of one piece. */
const EXAMPLES={
  "place cards":"One name per card, as it should be written.\n\nGuest name only — no table number (the seating display carries that).\nHousehold entries show the count: 陈林湖 (3) Chen Linhu",
  "table numbers":"Front: the table name exactly as the seating chart writes it.\n  Table 1 … Table 20\n\nBack (optional): the salon name.\n  Salon Victoria · Salon Victor Hugo · Salon Josephine · Salon Debussy",
  "menus":"Hanna & Martial\n\n— Entrée —\n\n— Plat —\n\n— Fromage —\n\n— Dessert —\n\nDietary needs are per person; see the seating chart's print for who needs what at each table.",
  "ceremony programs":"Hanna & Martial\n\nThe order of the day, per the Ceremony page.\n\nProcessional\n…\n\nRecessional",
  "table plan cards":"Hanna & Martial — please find your table\n\nOne card per table, names beneath the number.",
  // These two carry the copy already set in the designer's suite.
  "welcome panel":"WELCOME\nTO THE WEDDING\n\nof\n\nHANNA\nand\nMARTIAL\n\n17.10.2026\n\nwe're so glad you're here",
  "guest book poster":"GUEST BOOK\n\nH&M\n17.10.2026",
};
let expanded=new Set();

/* ---------- Derived copy ----------
   Three pieces don't have wording anyone writes — their content *is* the
   seating chart, so they render it live instead of prose describing where
   to find it. Typed copy would go stale the moment a guest moves tables.
   The rest (menus, programs) stay hand-written, since nothing in the data
   knows what's for dinner. `wording` still shows above a generated block
   when set, for the instructions that aren't derivable ("ivory card stock,
   3.5×2in") — the generated text is the copy, `wording` is the brief. */
const GENERATORS={
  "place cards":s=>{
    const out=[];
    for(const t of s.tables){
      for(const e of collapseHousehold(seatedNames(s,t)))
        out.push(entryText(e));
    }
    return out.join("\n");
  },
  "table numbers":s=>s.rooms.map(r=>{
    const tables=usedTables(s,r);
    if(!tables.length)return "";
    return r.name+"\n"+tables.map(t=>"  "+t.name).join("\n");
  }).filter(Boolean).join("\n\n"),
  "table plan cards":s=>s.rooms.map(r=>{
    const tables=usedTables(s,r);
    if(!tables.length)return "";
    return r.name+"\n\n"+tables.map(t=>{
      const e=collapseHousehold(seatedNames(s,t));
      return t.name+"\n"+e.map(x=>"  "+entryText(x)).join("\n");
    }).join("\n\n");
  }).filter(Boolean).join("\n\n"),
};
let seating=null;                                   // loaded on first expand of a generated piece

/* The chart stores a Chinese guest as "陈林湖 (Chen Linhu)" — the pinyin is a
   reading aid for whoever works the chart, not necessarily something you'd
   letterpress. Which form the calligrapher writes is a decision, so the
   place-cards row shows one real household both ways rather than picking
   for you. Sampled from a household with a count, so the number's placement
   is visible in both. */
function cjkSample(s){
  const found=[];
  for(const t of s.tables){
    for(const e of collapseHousehold(seatedNames(s,t))){
      if(!/[一-鿿]/.test(e.name))continue;
      const chinese=e.name.replace(/\s*\([^)]*\)\s*$/,"");
      if(chinese===e.name)continue;                 // no pinyin parenthetical to strip
      found.push({chinese,full:e.name,count:e.count});
    }
  }
  // A sample with no +N shows neither the count's placement nor its
  // interaction with the parenthetical, so a multi-member household wins.
  const pick=found.find(e=>e.count>1)||found[0];
  if(!pick)return null;
  const n=pick.count>1?` (${pick.count})`:"";
  const pinyin=(pick.full.match(/\(([^)]*)\)\s*$/)||[])[1]||"";
  return {chinese:pick.chinese+n, pinyin, full:withCount(pick.full,pick.count)};
}

/* ---------- Mockups ----------
   Rough shape-and-palette stand-ins for the designer's suite (Recreation),
   drawn in CSS from the real data — a sense of "the table number card says
   5 and Table cinq / five", not a rendering of the artwork. Deliberately
   not a design: no typefaces from the suite, no wax seals, no florals,
   no proportions anyone should measure. The point is to see your own names
   and numbers in roughly the right piece, so the copy can be checked before
   it reaches the designer. Fixed cream/burgundy regardless of OS theme,
   since these stand in for paper. */
const SUITE={date:"17.10.2026",couple:["HANNA","MARTIAL"]};
/* Each piece renders the variant that was actually chosen in the round of
   feedback to the designer, not the options that were on the table — the
   decision is made, and showing rejected variants alongside it would put
   them back up for discussion every time the row is opened. The choice is
   spelled out in each piece's own brief. */
function mockTableNumber(t){
  const num=(t.name.match(/\d+/)||["5"])[0];
  return `<div class="mocks">
    <div class="mk mk-paper mk-frame"><div class="mk-num">${esc(num)}</div><div class="mk-fine mk-it">Table ${esc(num)}</div></div>
  </div>`;
}
function mockPlanDeTable(s,t){
  const num=(t.name.match(/\d+/)||["5"])[0];
  const names=collapseHousehold(seatedNames(s,t)).map(e=>esc(entryText(e))).join("<br>");
  return `<div class="mocks">
    <div class="mk mk-paper mk-frame mk-tall"><div class="mk-seal"></div><div class="mk-num">${esc(num)}</div><div class="mk-names">${names}</div></div>
  </div>`;
}
/* Left to itself the card wraps wherever it runs out of width, which lands
   mid-name. The break is placed instead: characters and count on one line,
   romanisation on its own beneath — which is how the card would be set
   anyway. Neither line is allowed to wrap. */
function placeCard(name,caption,sub){
  return `<figure class="mkfig">
    <div class="mk mk-paper mk-place">
      <span class="mk-nm"><span>${esc(name)}</span>${sub?`<span class="mk-sub">${esc(sub)}</span>`:""}</span>
      <i class="mk-seal"></i>
    </div>
    ${caption?`<figcaption class="mk-cap">${esc(caption)}</figcaption>`:""}
  </figure>`;
}
/* The Chinese name appears twice, with and without the pinyin, because
   which one the calligrapher writes is still open — seeing both at card
   size is the way to settle it, and a plain text comparison doesn't show
   how long the pinyin line runs on a 4x8cm card. */
function mockPlaceCard(s,name){
  const v=cjkSample(s);
  return `<div class="mocks">
    ${placeCard(name)}
    ${v?placeCard(v.chinese,"Chinese only"):""}
    ${v?placeCard(v.chinese,"Chinese + pinyin",v.pinyin):""}
  </div>`;
}
// Two sides, per the feedback: English solid burgundy, French reversed.
function mockMenu(text){
  const lines=(text||"").split("\n").filter(l=>l.trim()).slice(0,7).map(esc).join("<br>");
  const body=lines||"— Entrée —<br>— Plat —<br>— Fromage —<br>— Dessert —";
  return `<div class="mocks">
    <div class="mk mk-ink mk-arch"><div class="mk-names">${body}</div><div class="mk-menu">MENU</div></div>
    <div class="mk mk-paper mk-arch"><div class="mk-names">${body}</div><div class="mk-menu">MENU</div></div>
  </div>`;
}
function mockPoster(title,sub){
  return `<div class="mocks">
    <div class="mk mk-paper mk-poster">
      <div class="mk-fine">${esc(title)}</div>
      <div class="mk-couple">${SUITE.couple[0]}<br><i>and</i><br>${SUITE.couple[1]}</div>
      <div class="mk-fine">${esc(sub||SUITE.date)}</div>
    </div>
  </div>`;
}
function mockFor(i,s){
  const key=(i.name||"").trim().toLowerCase();
  const t=s&&s.tables&&s.tables.find(t=>t.seats.some(Boolean));
  if(key==="table numbers"&&t)return mockTableNumber(t);
  if(key==="table plan cards"&&t)return mockPlanDeTable(s,t);
  if(key==="place cards"&&s){
    const first=collapseHousehold(seatedNames(s,t||s.tables[0]))[0];
    return mockPlaceCard(s,first?first.name:"First name");
  }
  if(key==="menus")return mockMenu(i.wording);
  if(key==="ceremony programs")return mockPoster("WELCOME · BIENVENUE");
  if(key==="welcome panel")return mockPoster("WELCOME TO THE WEDDING","17.10.2026 · we're so glad you're here");
  if(key==="guest book poster")return `<div class="mocks">
    <div class="mk mk-paper mk-poster"><div class="mk-couple">GUEST<br>BOOK</div>
      <div class="mk-fine">H&amp;M<br>${SUITE.date}</div></div>
  </div>`;
  return "";
}

function generatorFor(i){return GENERATORS[(i.name||"").trim().toLowerCase()];}
function derivedText(i){
  const gen=generatorFor(i);
  return gen&&seating?gen(seating):null;
}
function printedText(i){return derivedText(i)??(i.wording||"");}

function itemBody(i){
  const ex=EXAMPLES[(i.name||"").trim().toLowerCase()];
  const gen=generatorFor(i);
  const derived=derivedText(i);
  const wording=i.wording||"";
  // The copy is the longest thing in the row — 128 names for the place
  // cards — so it collapses too. Opening a piece shows the mockup and the
  // brief; the full text is one more click, and its own open/closed state
  // survives the row re-rendering.
  let main;
  if(gen&&!seating)main=`<p class="empty">Loading from the seating chart…</p>`;
  else if(derived!==null)main=copyBlock(i,
    `From the seating chart · ${countEntries(derived)} entries`,derived);
  else if(wording)main=copyBlock(i,`Wording · ${countEntries(wording)} lines`,wording);
  else main=`<p class="empty">No wording yet.${ex?" There's an example for this piece — Edit to use it.":""}</p>`;
  return `<div class="body">
    ${i.notes?`<div class="fullnote">${esc(i.notes)}</div>`:""}
    ${mockFor(i,seating)}
    ${derived!==null&&wording?`<pre class="wording brief">${esc(wording)}</pre>`:""}
    ${main}
    ${printedText(i)?`<div class="bodybar"><button class="secondary" data-action="download">Download .txt</button></div>`:""}
  </div>`;
}
let copyOpen=new Set();
function copyBlock(i,label,text){
  return `<details class="copy" data-id="${i.id}"${copyOpen.has(i.id)?" open":""}>`+
    `<summary>${esc(label)}</summary>`+
    `<pre class="wording">${esc(text)}</pre></details>`;
}
// Indented lines are the names/tables; unindented ones are room headings.
// A generator that indents nothing (place cards) counts every line.
function countEntries(text){
  const lines=text.split("\n").filter(l=>l.trim());
  const indented=lines.filter(l=>l.startsWith("  "));
  return indented.length||lines.length;
}
/* The count goes before the pinyin, not after the whole name: on a place
   card "任者友 (Ren Zheyou) (2)" wraps between the two parentheticals and
   strands the number on its own line. "任者友 (2) (Ren Zheyou)" keeps the
   number against the characters it belongs to, and any wrap falls in front
   of the romanisation instead. Names with no parenthetical just take the
   count at the end as before. */
function withCount(name,count){
  const m=name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const n=count>1?` (${count})`:"";
  // The brackets around the pinyin are the seating chart's own notation for
  // "this is a reading aid". On a printed card there's nothing to bracket
  // it off from, and they only add another wrap point in a line that
  // already breaks badly — so the romanisation prints plain.
  return m?`${m[1]}${n} ${m[2]}`:`${name}${n}`;
}
function entryText(e){return withCount(e.name,e.count);}

// An empty table gets no number card and no plan card — it exists on the
// chart as a placeholder, and printing for it would order stationery for a
// table nobody sits at. Table count on the piece follows from this, so a
// table emptied later drops out of the copy on the next open.
function usedTables(s,room){
  return s.tables.filter(t=>t.roomId===room.id&&(t.seats||[]).some(Boolean));
}
function seatedNames(s,t){
  return (t.seats||[]).map(id=>id?s.guests.find(g=>g.id===id):null).filter(Boolean).map(g=>g.name);
}

function renderView(){
  const box=document.getElementById("itemBox");
  const items=data.items||[];
  if(!items.length){box.innerHTML='<p class="empty">Nothing on the stationery list yet.</p>';}
  else{
    box.innerHTML=items.map(i=>{
      const meta=[];
      if(i.quantity)meta.push(`<span>×${esc(String(i.quantity))}</span>`);
      if(i.vendor)meta.push(`<span>${esc(i.vendor)}</span>`);
      if(i.dueDate)meta.push(`<span class="due${isLate(i)?" late":""}">due ${esc(fmtDue(i.dueDate))}</span>`);
      if(Number(i.cost))meta.push(`<span>${esc(money(i.cost))}</span>`);
      const open=expanded.has(i.id);
      return `
      <div class="item${open?" open":""}" data-id="${i.id}">
        <div class="head">
          <span class="caret">${open?"▾":"▸"}</span>
          <span class="name">${esc(i.name)}</span>
          ${!i.status||i.status==="To do"?"":`<span class="${statusClass(i.status)}">${esc(i.status)}</span>`}
        </div>
        ${meta.length?`<div class="meta">${meta.join("")}</div>`:""}
        ${open?itemBody(i):(i.notes?`<div class="notes">${esc(i.notes)}</div>`:"")}
      </div>`;
    }).join("");
    box.querySelectorAll(".item").forEach(el=>{
      const id=Number(el.dataset.id);
      // The whole row toggles, not just its title — but not when the click
      // was on a control, and not when it ended a text selection (dragging
      // to copy the wording would otherwise collapse it mid-drag).
      const det=el.querySelector("details.copy");
      if(det)det.addEventListener("toggle",()=>{
        if(det.open)copyOpen.add(id);else copyOpen.delete(id);
      });
      el.addEventListener("click",async e=>{
        if(e.target.closest("button,a,input,textarea,summary,details"))return;
        if(String(window.getSelection()))return;
        if(expanded.has(id))expanded.delete(id);else expanded.add(id);
        renderView();
        // Fetched once, on the first expand of a piece that needs it —
        // the seating chart is a second file and most sessions never open
        // one of these rows.
        if(expanded.has(id)&&generatorFor(items.find(i=>i.id===id))&&!seating){
          await loadSeating();
          renderView();
        }
      });
      const dl=el.querySelector('[data-action="download"]');
      if(dl)dl.addEventListener("click",()=>downloadWording(items.find(i=>i.id===id)));
    });
  }
  document.getElementById("addBar").style.display="none";
}

async function loadSeating(){
  const res=await api("/seating");
  if(res.ok)seating=(await res.json()).data;
}

function downloadWording(item){
  const blob=new Blob([printedText(item)],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=(item.name||"wording").replace(/[^\w一-鿿 -]+/g,"").trim().replace(/\s+/g,"-").toLowerCase()+".txt";
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
}

function renderEdit(){
  const box=document.getElementById("itemBox");
  box.innerHTML=(data.items||[]).map((i,idx)=>`
    <div class="editRow" data-i="${idx}">
      <input data-field="name" value="${esc(i.name)}" placeholder="Piece (e.g. Invitations)">
      <select data-field="status">${STATUSES.map(s=>`<option value="${esc(s)}"${(i.status||"To do")===s?" selected":""}>${esc(s)}</option>`).join("")}</select>
      <input class="time-input" data-field="quantity" type="number" min="0" value="${i.quantity??""}" placeholder="Qty">
      <input data-field="vendor" value="${esc(i.vendor||"")}" placeholder="Printer / vendor">
      <input class="time-input" data-field="dueDate" type="date" value="${esc(i.dueDate||"")}">
      <input class="time-input" data-field="cost" type="number" min="0" step="0.01" value="${i.cost??""}" placeholder="Cost">
      <input data-field="notes" value="${esc(i.notes||"")}" placeholder="Notes">
      <button class="danger" data-action="remove">×</button>
      <label class="dl-toggle"><input type="checkbox" data-field="noDownload"${i.noDownload?" checked":""}> leave out of Download all</label>
      <textarea class="wording-input" data-field="wording" placeholder="Wording — the copy printed on this piece">${esc(i.wording||"")}</textarea>
      ${EXAMPLES[(i.name||"").trim().toLowerCase()]&&!i.wording
        ?`<button class="secondary" data-action="example">Use example</button>`:""}
    </div>
  `).join("");
  box.querySelectorAll(".editRow").forEach(row=>{
    const idx=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      const numeric=inp.type==="number";
      const apply=()=>{
        data.items[idx][inp.dataset.field]=
          inp.type==="checkbox"?(inp.checked||undefined)
          :numeric?(inp.value===""?undefined:Number(inp.value))
          :inp.value;
      };
      // `input` covers typing; `change` covers the select and the native
      // date picker, which don't fire `input` in every browser.
      inp.addEventListener("input",apply);
      inp.addEventListener("change",apply);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click",()=>{
      data.items.splice(idx,1);renderEdit();
    });
    const exBtn=row.querySelector('[data-action="example"]');
    if(exBtn)exBtn.addEventListener("click",()=>{
      data.items[idx].wording=EXAMPLES[(data.items[idx].name||"").trim().toLowerCase()];
      renderEdit();
    });
  });
  document.getElementById("addBar").style.display="flex";
}

async function save(){
  const res=await api("/stationery",{method:"PUT",body:JSON.stringify({data,revisionId})});
  if(res.ok){
    const body=await res.json();
    revisionId=body.revisionId;
    editing=false;
    document.getElementById("editToggle").textContent="Edit";
    renderView();
    return;
  }
  if(res.status===409){
    alert("Someone else saved changes. Reloading the current version.");
    await loadData();
    editing=false;
    document.getElementById("editToggle").textContent="Edit";
    renderView();
    return;
  }
  alert("Save failed — check your connection and try again.");
}

async function openHistory(){
  const overlay=document.getElementById("history");
  overlay.hidden=false;
  const box=document.getElementById("historyList");
  box.innerHTML='<p class="empty">Loading…</p>';
  const res=await api("/stationery/revisions");
  if(!res.ok){box.innerHTML='<p class="empty">Couldn\'t load history — try again.</p>';return;}
  const {revisions}=await res.json();
  if(!revisions.length){box.innerHTML='<p class="empty">No past saves yet.</p>';return;}
  box.innerHTML="";
  for(const r of revisions){
    const row=document.createElement("div");row.className="hist-row";
    row.innerHTML=`<span class="hist-when">${r.keepForever?"📌 ":""}${esc(fmtRev(r.modifiedTime))}</span>`+
      `<button class="secondary" data-id="${esc(r.id)}">Compare with current</button>`;
    row.querySelector("button").addEventListener("click",()=>compareRevision(r.id));
    box.appendChild(row);
  }
}
async function compareRevision(id){
  const res=await api(`/stationery/revisions/${encodeURIComponent(id)}/diff`);
  if(!res.ok){
    const body=await res.json().catch(()=>null);
    alert(body&&body.error?body.error:"Couldn't load that comparison — try again.");
    return;
  }
  const {changes}=await res.json();
  alert(changes.length?"Changes since that save:\n\n"+changes.map(c=>"• "+c).join("\n"):"No changes since that save.");
}

function setupControls(){
  if(session && session.role==="editor"){
    document.getElementById("editControls").style.display="inline";
  }
  if(session){
    document.getElementById("historyBtn").style.display="inline";
  }
  document.getElementById("editToggle").addEventListener("click",async ()=>{
    if(!editing){
      editing=true;
      document.getElementById("editToggle").textContent="Save";
      renderEdit();
    }else{
      await save();
    }
  });
  document.getElementById("addItem").addEventListener("click",()=>{
    data.items.push({id:(data.nextId||1),name:"",status:"To do",vendor:"",dueDate:"",notes:""});
    data.nextId=(data.nextId||1)+1;
    renderEdit();
  });
  document.getElementById("namesBtn").addEventListener("click",downloadAll);
  document.getElementById("historyBtn").addEventListener("click",openHistory);
  const historyOverlay=document.getElementById("history");
  document.getElementById("historyClose").addEventListener("click",()=>{historyOverlay.hidden=true;});
  historyOverlay.addEventListener("click",e=>{if(e.target.id==="history")historyOverlay.hidden=true;});
  window.addEventListener("keydown",e=>{if(e.key==="Escape")historyOverlay.hidden=true;});
  const roleTag=document.getElementById("roleTag");
  if(session)roleTag.textContent=session.role;
}

/* ---------- Name list (for ordering place cards) ----------
   Reads the seating chart live and prints table-by-table name lists. This is
   what the calligrapher/printer works from, so it carries names and nothing
   else: no dietary markers, no pending-RSVP markers, no party colours, no
   seat numbering beyond position in the table. Those all belong on the
   seating chart's own print, which stays as it is.

   Chinese entries are one household per line. The chart stores extra party
   members as their own guest records suffixed `+1`, `+2` (`陈林湖 +1
   (Chen Linhu +1)`) because each occupies a real seat; on a name list those
   are one household, so they collapse to the base name with the household
   headcount in parentheses — `陈林湖 (Chen Linhu) (3)` for a base plus +1 and
   +2. The count is the total, not the number of extras. Collapsing keys on
   the base name, so members split across tables collapse per table, not into
   one line under whichever table came first. */
function baseName(name){
  // Strips a trailing " +N" from both the Chinese name and the pinyin
  // parenthetical: "陈林湖 +1 (Chen Linhu +1)" → "陈林湖 (Chen Linhu)".
  return name.replace(/\s*\+\d+\b/g, "").trim();
}
function collapseHousehold(names){
  const out=[], seen=new Map();
  for(const n of names){
    const key=baseName(n);
    if(seen.has(key)){out[seen.get(key)].count++;continue;}
    seen.set(key,out.length);
    out.push({name:key,count:1});
  }
  return out;
}
/* ---------- Download all ----------
   One plain-text file covering every piece: what it is, how many, who's
   printing it, the brief, then the copy. That is the whole handover to the
   stationer, so it replaces the old print-the-name-list button — the name
   list is in here as the place cards and the table plan cards, and a file
   can be sent, while a printout has to be carried. */
function allPiecesText(){
  const venue=document.getElementById("subTitle").textContent;
  const head=["Hanna & Martial — stationery",venue,new Date().toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"})]
    .filter(Boolean).join(" · ");
  // A piece can be left out of the handover without leaving the list —
  // something already settled with the designer still belongs on the page
  // (its quantity, its status, its brief) but adds nothing to the file
  // being sent. Opt-out, so a new piece is included by default.
  const blocks=(data.items||[]).filter(i=>!i.noDownload).map(i=>{
    const meta=[i.quantity?`×${i.quantity}`:"",i.vendor,i.dueDate?`due ${fmtDue(i.dueDate)}`:"",i.status].filter(Boolean).join(" · ");
    const derived=derivedText(i);
    const parts=[i.name.toUpperCase(),meta];
    if(i.notes)parts.push("",i.notes);
    // A generated piece keeps `wording` as the brief, so both are worth
    // carrying: the brief first, then the copy it describes.
    if(derived!==null&&i.wording)parts.push("",i.wording);
    const copy=printedText(i);
    if(copy)parts.push("",derived!==null?"COPY (from the seating chart):":"COPY:","",copy);
    return parts.join("\n");
  });
  return [head,"",...blocks.flatMap(b=>[b,"","—".repeat(40),""])].join("\n").trimEnd()+"\n";
}
async function downloadAll(){
  // The generated pieces need the chart; it's normally already loaded
  // because the rows open on load, but not if every piece is hand-written.
  if((data.items||[]).some(generatorFor)&&!seating)await loadSeating();
  const blob=new Blob([allPiecesText()],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="stationery.txt";
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
}

async function loadConfig(){
  const config=await (await fetch("/api/config")).json();
  document.title="Stationery"+(config.venueName?" · "+config.venueName:"");
  document.getElementById("subTitle").textContent=config.venueName||"";
}

async function init(){
  try{
    await loadConfig();
    await loadSession();
    await loadData();
    renderView();
    setupControls();
    // Rows are open from the start, so the pieces whose copy comes from the
    // seating chart need it now rather than on first expand.
    if((data.items||[]).some(generatorFor)){
      await loadSeating();
      renderView();
    }
  }catch(e){
    document.getElementById("err").textContent="Couldn't load: "+(e&&e.message||e);
  }
}
init();
