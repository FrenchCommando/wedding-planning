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
// list rather than free text so the summary can count what's still open and
// the status pill can style "done" without string-matching prose.
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
function statusClass(s){
  if(DONE_STATUSES.has(s))return "pill done";
  return s&&s!=="To do"?"pill active":"pill";
}

function renderSummary(){
  const items=data.items||[];
  const done=items.filter(i=>DONE_STATUSES.has(i.status)).length;
  const total=items.reduce((s,i)=>s+(Number(i.cost)||0),0);
  const parts=[`${items.length} piece${items.length===1?"":"s"}`,`${done} done`];
  if(total)parts.push(`${money(total)} total`);
  document.getElementById("summary").textContent=parts.join(" · ");
}

function renderView(){
  renderSummary();
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
      return `
      <div class="item">
        <div class="head">
          <span class="name">${esc(i.name)}</span>
          <span class="${statusClass(i.status)}">${esc(i.status||"To do")}</span>
        </div>
        ${meta.length?`<div class="meta">${meta.join("")}</div>`:""}
        ${i.notes?`<div class="notes">${esc(i.notes)}</div>`:""}
      </div>`;
    }).join("");
  }
  document.getElementById("addBar").style.display="none";
}

function renderEdit(){
  renderSummary();
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
    </div>
  `).join("");
  box.querySelectorAll(".editRow").forEach(row=>{
    const idx=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      const numeric=inp.type==="number";
      const apply=()=>{
        data.items[idx][inp.dataset.field]=numeric?(inp.value===""?undefined:Number(inp.value)):inp.value;
        if(numeric)renderSummary();
      };
      // `input` covers typing; `change` covers the select and the native
      // date picker, which don't fire `input` in every browser.
      inp.addEventListener("input",apply);
      inp.addEventListener("change",apply);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click",()=>{
      data.items.splice(idx,1);renderEdit();
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
  document.getElementById("namesBtn").addEventListener("click",printNameList);
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
function nameListHtml(seating){
  const guestById=id=>seating.guests.find(g=>g.id===id);
  let html="";
  for(const room of seating.rooms){
    const tables=seating.tables.filter(t=>t.roomId===room.id);
    if(!tables.length)continue;
    html+=`<div class="pr-h">${esc(room.name)}</div><div class="pr-tables">`;
    for(const t of tables){
      const names=t.seats.map(id=>id?guestById(id):null).filter(Boolean).map(g=>g.name);
      const entries=collapseHousehold(names);
      const total=entries.reduce((s,e)=>s+e.count,0);
      html+=`<div class="pr-card"><h4>${esc(t.name)}<span class="c">${total}</span></h4><ul>`+
        entries.map(e=>`<li>${esc(e.name)}${e.count>1?` (${e.count})`:""}</li>`).join("")+
        `</ul></div>`;
    }
    html+=`</div>`;
  }
  return html;
}
async function printNameList(){
  const res=await api("/seating");
  if(!res.ok){alert("Couldn't load the seating chart to build the name list.");return;}
  const {data:seating}=await res.json();
  const root=document.getElementById("printRoot");
  const venue=document.getElementById("subTitle").textContent;
  const total=seating.guests.length;
  root.innerHTML=`<div class="pr-page">
      <h1 class="pr-title">Name list</h1>
      <div class="pr-sub">${esc(venue)} · ${total} guests · for place cards</div>
      ${nameListHtml(seating)}
    </div>`;
  document.body.classList.add("printing");
  const done=()=>{document.body.classList.remove("printing");root.innerHTML="";window.removeEventListener("afterprint",done);};
  window.addEventListener("afterprint",done);
  setTimeout(()=>{window.print();},60);
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
  }catch(e){
    document.getElementById("err").textContent="Couldn't load: "+(e&&e.message||e);
  }
}
init();
