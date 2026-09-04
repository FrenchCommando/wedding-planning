"use strict";
const PALETTE=["#3b6fd4","#d1483c","#2ea36a","#c9971f","#8b5cd6","#d857a8","#0e9aa8","#e07a34","#5a6b7b","#7a9b2e"];
const REN="Ren Fam from China/France";
const CAP=10;
const PLAN_W=1620, PLAN_H=1802;
// Room floor-plan outlines: rooms with x1/y1/x2/y2 (fractional plan coords)
// draw an outline; rooms without them just don't render one. This is venue
// layout data, so it lives on each room object from Drive, not hardcoded here.
function roomOutlines(rooms){return rooms.filter(r=>r.x1!==undefined);}

// State lives on the server (Drive-backed). `baseData`/`baseRevisionId` are
// the snapshot last loaded from/saved to the server — used both for the
// "discard changes" action and to detect conflicts on save. Populated by
// loadFromServer() before the app renders. Unsaved edits live in memory only
// — closing the tab before Save loses them, same as any normal web app.
let state={rooms:[],tables:[],guests:[],partyColors:{},nextId:1};
let venueName="";
let baseData=null, baseRevisionId=null;
let dirty=false;
let selected=null, highlight=null, view="table", swapFrom=null;

function deepCopy(obj){return JSON.parse(JSON.stringify(obj));}
function migrate(s){if(!s)return null;s.partyColors=s.partyColors||{};s.nextId=s.nextId||1;for(const t of s.tables){if(t.onPlan===undefined)t.onPlan=true;if(t.fx===undefined)t.fx=0.5;if(t.fy===undefined)t.fy=0.5;}return s;}
function save(){dirty=true;updateSaveUI();}
function fmtRev(rev){const d=new Date(rev||"");if(isNaN(d))return"";return d.toLocaleDateString(undefined,{day:"numeric",month:"short"})+", "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});}
function updateSaveUI(){
  const btn=document.getElementById("saveHtmlBtn");
  if(dirty){btn.classList.add("primary");btn.textContent="Save — unsaved changes";}
  else{btn.classList.remove("primary");btn.textContent="Saved ✓";}
  document.getElementById("discardBtn").hidden=!dirty;
  const when=fmtRev(state.rev);
  document.getElementById("subTitle").textContent=venueName+(when?" · version "+when:"");
}
function uid(){return state.nextId++;}
function guestById(id){return state.guests.find(g=>g.id===id);}
function tableById(id){return state.tables.find(t=>t.id===id);}
function roomById(id){return state.rooms.find(r=>r.id===id);}
function seatOf(id){for(const t of state.tables){const i=t.seats.indexOf(id);if(i>=0)return{table:t,index:i};}return null;}
function isPlaceholder(g){return g&&(g.name===REN||/plus\s*1|groomsman|bridesmaid|^guest\b/i.test(g.name));}
function partyColor(p){if(!p)return"#9aa3ad";if(!state.partyColors[p]){const u=Object.keys(state.partyColors).length;state.partyColors[p]=PALETTE[u%PALETTE.length];}return state.partyColors[p];}

/* ---------- Guests sidebar ---------- */
function addGuest(name,party){name=name.trim();party=(party||"").trim();if(!name)return;state.guests.push({id:uid(),name,party});if(party)partyColor(party);save();renderGuests();renderStats();refreshParties();}
function toggleConfirmed(id){
  const g=state.guests.find(x=>x.id===id);if(!g)return;
  if(g.unconfirmed)delete g.unconfirmed;else g.unconfirmed=true;
  save();renderAll();
}
function removeGuest(id){const s=seatOf(id);if(s)s.table.seats[s.index]=null;state.guests=state.guests.filter(g=>g.id!==id);save();renderAll();}

function renderGuests(){
  const box=document.getElementById("guestList");
  const q=document.getElementById("search").value.trim().toLowerCase();
  const unseatedOnly=document.getElementById("unseatedOnly").checked;
  box.innerHTML="";
  let list=state.guests.slice();
  if(q)list=list.filter(g=>g.name.toLowerCase().includes(q)||(g.party||"").toLowerCase().includes(q));
  const groups={};
  for(const g of list){const seated=!!seatOf(g.id);if(unseatedOnly&&seated&&!q)continue;(groups[g.party||"—"]??=[]).push(g);}
  const keys=Object.keys(groups).sort((a,b)=>a==="—"?1:b==="—"?-1:a.localeCompare(b));
  if(!keys.length){box.innerHTML='<div style="color:var(--muted);padding:20px;font-size:13px">Nobody here.</div>';return;}
  for(const key of keys){
    const col=key==="—"?"#9aa3ad":partyColor(key);
    const wrap=document.createElement("div");wrap.className="party";
    const head=document.createElement("div");head.className="party-head";
    head.innerHTML=`<span class="dot" style="background:${col}"></span>${key==="—"?"No party":esc(key)}<span class="ct">${groups[key].length}</span>`;
    wrap.appendChild(head);
    groups[key].sort((a,b)=>a.name.localeCompare(b.name));
    for(const g of groups[key]){
      const s=seatOf(g.id);
      const el=document.createElement("div");
      el.className="guest"+(s?" seated":"")+(highlight===g.id?" hl":"");
      el.draggable=true;el.dataset.id=g.id;
      // The dot doubles as the RSVP toggle — hollow means awaiting, filled
      // means confirmed. Only place in the UI that sets `unconfirmed`.
      const dotHtml=g.unconfirmed
        ?`<span class="g-dot dot-unc" style="border-color:${col}" title="awaiting RSVP — click to mark confirmed"></span>`
        :`<span class="g-dot" style="background:${col}" title="confirmed — click to mark awaiting RSVP"></span>`;
      el.innerHTML=dotHtml+`<span class="g-name">${esc(g.name)}</span>${s?`<span class="g-where">${esc(s.table.name)}</span>`:""}<span class="g-x" title="Remove">×</span>`;
      el.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain","guest:"+g.id);e.dataTransfer.effectAllowed="move";el.classList.add("dragging");});
      el.addEventListener("dragend",()=>el.classList.remove("dragging"));
      el.addEventListener("click",e=>{if(e.target.classList.contains("g-x"))return;focusGuest(g.id);});
      el.querySelector(".g-dot").addEventListener("click",ev=>{ev.stopPropagation();toggleConfirmed(g.id);});
      el.querySelector(".g-x").addEventListener("click",ev=>{ev.stopPropagation();removeGuest(g.id);});
      wrap.appendChild(el);
    }
    box.appendChild(wrap);
  }
}
function refreshParties(){document.getElementById("parties").innerHTML=[...new Set(state.guests.map(g=>g.party).filter(Boolean))].map(p=>`<option value="${esc(p)}">`).join("");}
function focusGuest(id){
  const s=seatOf(id);highlight=id;renderAll();
  if(s){
    if(zoom<0.55){zoom=0.8;applyTransform();}
    const el=document.querySelector(`.seat[data-t="${s.table.id}"][data-i="${s.index}"]`);
    if(el)centerOnEl(el);
  }
  setTimeout(()=>{highlight=null;renderAll();},2400);
}

/* ---------- Geometry ---------- */
function seatPositions(t){const n=t.seats.length,pts=[],rx=t.oval?104:82,ry=t.oval?64:82;for(let i=0;i<n;i++){const a=-Math.PI/2+i*2*Math.PI/n;pts.push({x:Math.cos(a)*rx,y:Math.sin(a)*ry});}return pts;}

/* ---------- Tables ---------- */
function addTable(){const rid=state.rooms[0]?.id;const t={id:uid(),roomId:rid,name:"New table",seats:Array(CAP).fill(null),onPlan:true,fx:0.5,fy:0.5,oval:false};state.tables.push(t);save();selected=t.id;renderAll();}
function removeTable(id){state.tables=state.tables.filter(t=>t.id!==id);if(selected===id)selected=null;save();renderAll();}
function swapTables(a,b){
  if(!a||!b||a===b)return;
  const tmp=a.seats;a.seats=b.seats;b.seats=tmp;
  save();renderAll();
  toast("Swapped "+a.name+" ↔ "+b.name);
}
function setSeatCount(t,n){n=Math.max(1,Math.min(16,n|0));const next=Array(n).fill(null);for(let i=0;i<Math.min(n,t.seats.length);i++)next[i]=t.seats[i];t.seats=next;save();renderAll();}

function buildTable(t,off){
  const el=document.createElement("div");
  el.className="table"+(t.oval?" oval":"")+(off?" off":"")+(selected===t.id?" sel":"")+(swapFrom===t.id?" swapping":"");
  el.dataset.id=t.id;
  if(!off){el.style.left=(t.fx*100)+"%";el.style.top=(t.fy*100)+"%";}
  const filled=t.seats.filter(Boolean).length,cap=t.seats.length;
  const surf=document.createElement("div");surf.className="surface";
  surf.innerHTML=`<div><div class="t-label">${esc(t.name)}</div><div class="t-count${filled>=cap?" full":""}">${filled}/${cap}</div></div>`;
  if(!off)surf.addEventListener("mousedown",e=>startTableDrag(e,t,el));
  surf.addEventListener("click",e=>{e.stopPropagation();if(el._moved){el._moved=false;return;}
    if(swapFrom&&swapFrom!==t.id){const from=tableById(swapFrom);swapFrom=null;swapTables(from,t);return;}
    if(swapFrom===t.id){swapFrom=null;renderAll();toast("Swap cancelled");return;}
    selected=selected===t.id?null:t.id;renderAll();});
  el.appendChild(surf);

  seatPositions(t).forEach((p,i)=>{
    const gid=t.seats[i],g=gid?guestById(gid):null;
    const seat=document.createElement("div");
    seat.className="seat"+(g?" occupied":"")+(g&&g.unconfirmed?" unconfirmed":"")+(g&&isPlaceholder(g)?" placeholder":"")+(g&&g.dietary?" diet":"")+(highlight&&highlight===gid?" hl":"");
    seat.dataset.t=t.id;seat.dataset.i=i;
    seat.style.left=`calc(50% + ${p.x}px)`;seat.style.top=`calc(50% + ${p.y}px)`;
    if(g){
      const c=partyColor(g.party);seat.style.setProperty("--sc",c);if(g.party)seat.dataset.color="1";
      seat.innerHTML=`<span class="s-name">${esc(shortName(g.name))}</span>`;
      seat.title=g.name+(g.party?` · ${g.party}`:"")+(g.unconfirmed?" · awaiting RSVP":"")+(g.dietary?` · ${g.dietary}`:"")+" — click to unseat";
      seat.draggable=true;
      seat.addEventListener("dragstart",e=>{e.stopPropagation();e.dataTransfer.setData("text/plain","seat:"+t.id+":"+i);e.dataTransfer.effectAllowed="move";});
    }else{seat.innerHTML=`<span class="s-num">${i+1}</span>`;seat.title="Empty seat";}
    seat.addEventListener("dragover",e=>{e.preventDefault();seat.classList.add("drop");});
    seat.addEventListener("dragleave",()=>seat.classList.remove("drop"));
    seat.addEventListener("drop",e=>{e.preventDefault();seat.classList.remove("drop");handleDrop(e,t,i);});
    seat.addEventListener("click",()=>{if(g){t.seats[i]=null;save();renderAll();}});
    el.appendChild(seat);
  });

  if(selected===t.id){
    const tools=document.createElement("div");tools.className="cell-tools";
    tools.innerHTML=`<span class="lbl">seats <input class="cnt" type="number" min="1" max="16" value="${cap}"></span>
      <button class="btn" data-act="ren">Rename</button>
      <button class="btn" data-act="oval">${t.oval?"● Round":"⬭ Oval"}</button>
      <button class="btn" data-act="swap" title="Trade all guests with another table">⇄ Swap</button>
      <button class="btn ghost" data-act="del" title="Delete">🗑</button>`;
    tools.addEventListener("mousedown",e=>e.stopPropagation());
    tools.querySelector(".cnt").addEventListener("change",e=>setSeatCount(t,parseInt(e.target.value)||1));
    tools.querySelector('[data-act="ren"]').addEventListener("click",()=>{const nm=prompt("Table name:",t.name);if(nm){t.name=nm;save();renderAll();}});
    tools.querySelector('[data-act="oval"]').addEventListener("click",()=>{t.oval=!t.oval;save();renderAll();});
    tools.querySelector('[data-act="swap"]').addEventListener("click",()=>{swapFrom=t.id;selected=null;renderAll();toast("Now click the table to swap guests with "+t.name+" (Esc cancels)");});
    tools.querySelector('[data-act="del"]').addEventListener("click",()=>{if(confirm("Delete "+t.name+"?"))removeTable(t.id);});
    el.appendChild(tools);
  }
  return el;
}

/* ---------- Drag table across plan ---------- */
let tdrag=null;
function startTableDrag(e,t,el){
  if(e.button!==0)return;
  const plan=document.getElementById("plan");const rect=plan.getBoundingClientRect();
  tdrag={t,el,rect};el._moved=false;el.classList.add("dragging-t");
  e.preventDefault();
}
window.addEventListener("mousemove",e=>{
  if(!tdrag)return;
  const{t,el,rect}=tdrag;
  const fx=Math.min(1.6,Math.max(-.6,(e.clientX-rect.left)/rect.width));   // allow tables outside the image
  const fy=Math.min(1.6,Math.max(-.6,(e.clientY-rect.top)/rect.height));
  if(Math.abs(fx-t.fx)+Math.abs(fy-t.fy)>.003)el._moved=true;
  t.fx=fx;t.fy=fy;el.style.left=(fx*100)+"%";el.style.top=(fy*100)+"%";
});
window.addEventListener("mouseup",()=>{if(tdrag){tdrag.el.classList.remove("dragging-t");if(tdrag.el._moved)save();tdrag=null;}});

/* ---------- Drop / assignment ---------- */
function handleDrop(e,table,index){
  const d=e.dataTransfer.getData("text/plain");
  if(d.startsWith("guest:")){assignSeat(table,index,+d.slice(6));}
  else if(d.startsWith("seat:")){const[,tid,idx]=d.split(":");const from=tableById(+tid);if(!from)return;const g=from.seats[+idx],disp=table.seats[index];from.seats[+idx]=disp;table.seats[index]=g;save();renderAll();}
}
function assignSeat(table,index,gid){const prev=seatOf(gid),disp=table.seats[index];if(prev)prev.table.seats[prev.index]=null;table.seats[index]=gid;if(disp&&prev)prev.table.seats[prev.index]=disp;save();renderAll();}

/* ---------- Auto-seat / clear ---------- */
function autoSeat(){
  const unseated=state.guests.filter(g=>!seatOf(g.id));
  if(!unseated.length){toast("Everyone's seated");return;}
  unseated.sort((a,b)=>(a.party||"~").localeCompare(b.party||"~")||a.name.localeCompare(b.name));
  const open=[];for(const t of state.tables)t.seats.forEach((s,i)=>{if(!s)open.push({t,i});});
  const n=Math.min(unseated.length,open.length);
  for(let k=0;k<n;k++)open[k].t.seats[open[k].i]=unseated[k].id;
  save();renderAll();toast(n+" seated"+(unseated.length>n?`, ${unseated.length-n} left over`:""));
}
function clearSeats(){if(!confirm("Clear ALL seat assignments? Guests stay in the list."))return;state.tables.forEach(t=>t.seats=t.seats.map(()=>null));save();renderAll();}

/* ---------- Render canvas ---------- */
function renderCanvas(){
  const plan=document.getElementById("plan");
  plan.style.width=PLAN_W+"px";plan.style.height=PLAN_H+"px";
  plan.className="plan";
  plan.innerHTML="";
  for(const r of roomOutlines(state.rooms)){
    const o=document.createElement("div");o.className="room-outline";
    o.style.left=(r.x1*100)+"%";o.style.top=(r.y1*100)+"%";
    o.style.width=((r.x2-r.x1)*100)+"%";o.style.height=((r.y2-r.y1)*100)+"%";
    o.innerHTML=`<span class="ro-label">${esc(r.name)}</span>`;
    plan.appendChild(o);
  }
  for(const t of state.tables.filter(t=>t.onPlan))plan.appendChild(buildTable(t,false));

  const off=document.getElementById("offplan");
  off.innerHTML="";
  const offTables=state.tables.filter(t=>!t.onPlan);
  if(offTables.length){
    const byRoom={};
    for(const t of offTables)(byRoom[t.roomId]??=[]).push(t);
    for(const rid in byRoom){
      const r=roomById(+rid);
      const h=document.createElement("h3");h.textContent=(r?r.name:"Off plan")+(r&&r.note?" · "+r.note:"");
      off.appendChild(h);
      const row=document.createElement("div");row.className="row-tables";
      for(const t of byRoom[rid])row.appendChild(buildTable(t,true));
      off.appendChild(row);
    }
  }
}
function renderStats(){const seated=state.guests.filter(g=>seatOf(g.id)).length;document.getElementById("stSeated").textContent=seated;document.getElementById("stUnseated").textContent=state.guests.length-seated;document.getElementById("stSeats").textContent=state.tables.reduce((s,t)=>s+t.seats.length,0);}
function renderAll(){renderGuests();renderCanvas();if(view==="table")renderTableView();if(view==="parties")renderPartiesView();renderStats();refreshParties();}

/* ---- Saving. In Chrome/Edge the File System Access API lets us write straight
   into the file the user picks (one picker on first save; the handle is kept in
   IndexedDB, so later saves are one click plus at most one "Allow" per session).
   Anywhere the API is missing or fails, we fall back to downloading a dated copy. */
let fileHandle=null;
function buildStandaloneHTML(){           // bake current plan into a standalone, shareable HTML string
  const root=document.documentElement.cloneNode(true);
  root.querySelectorAll("#__embed__").forEach(n=>n.remove());
  const q=s=>root.querySelector(s);
  if(q("#plan"))q("#plan").innerHTML="";
  if(q("#offplan"))q("#offplan").innerHTML="";
  if(q("#guestList"))q("#guestList").innerHTML="";
  if(q("#tableview"))q("#tableview").innerHTML="";
  if(q("#partiesview"))q("#partiesview").innerHTML="";
  if(q("#parties"))q("#parties").innerHTML="";
  if(q("#viewport"))q("#viewport").removeAttribute("style");
  if(q("#syncBanner"))q("#syncBanner").hidden=true;
  if(q("#saveHtmlBtn")){q("#saveHtmlBtn").className="btn small";q("#saveHtmlBtn").textContent="Saved ✓";}
  const emb=document.createElement("script");emb.id="__embed__";
  emb.textContent="window.__EMBEDDED_STATE__="+embedJSON(state)+";";
  q("head").appendChild(emb);
  return "<!doctype html>\n"+root.outerHTML;
}
function markSaved(){dirty=false;updateSaveUI();}
function embedJSON(st){                   // one room/table/guest per line: readable and diff-friendly
  const parts=Object.entries(st).map(([key,val])=>{
    const head=JSON.stringify(key)+": ";
    if(Array.isArray(val)&&val.length&&typeof val[0]==="object")
      return head+"[\n    "+val.map(x=>JSON.stringify(x)).join(",\n    ")+"\n  ]";
    return head+JSON.stringify(val);
  });
  // "<" is JSON-escaped so a stray "<" in a guest name can't close the script tag early
  return ("{\n  "+parts.join(",\n  ")+"\n}").replace(/</g,"\\u003c");
}
function downloadCopy(html){
  const now=new Date(),pad=n=>String(n).padStart(2,"0");
  const stamp=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
  const blob=new Blob([html],{type:"text/html"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`seating-plan ${stamp}.html`;a.click();URL.revokeObjectURL(a.href);
  toast("Saved! The file that just downloaded is the newest version — keep or send that one.");
}
/* ---------- Server sync (Drive-backed, replaces File System Access save) ---------- */
async function api(path,opts){
  const res=await fetch("/api"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...opts});
  return res;
}
async function promptForLogin(){
  // Retries on wrong password instead of giving up after one try — a typo
  // shouldn't fall through to rendering the app with no data.
  while(true){
    const password=prompt("Editor password:");
    if(password===null)throw new Error("login cancelled");
    const res=await api("/login/editor",{method:"POST",body:JSON.stringify({password})});
    if(res.ok)return;
    alert("Wrong password — try again.");
  }
}
async function loadFromServer(){
  let res=await api("/seating");
  if(res.status===403){
    await promptForLogin();
    res=await api("/seating");
  }
  if(!res.ok)throw new Error("failed to load seating data from server");
  const body=await res.json();
  baseData=deepCopy(body.data);
  baseRevisionId=body.revisionId;
  state=migrate(deepCopy(baseData));
}
function describeConflict(changes){
  if(!changes.length)return"Someone else saved changes while you were editing.";
  return"Someone else saved changes while you were editing:\n\n"+changes.map(c=>"• "+c).join("\n");
}
async function saveToServer(keepForever){
  const res=await api("/seating",{method:"PUT",body:JSON.stringify({data:state,baseData,baseRevisionId,keepForever})});
  if(res.ok){
    const body=await res.json();
    baseData=deepCopy(state);
    baseRevisionId=body.revisionId;
    markSaved();toast(keepForever?"Saved as milestone — this version stays in Drive's history":"Saved");
    return;
  }
  if(res.status===409){
    const body=await res.json();
    const msg=describeConflict(body.changes)+
      "\n\nOK = reload their version (you lose your local edits)\nCancel = keep editing (nothing saved yet)";
    if(confirm(msg)){
      baseData=null;baseRevisionId=null;
      await loadFromServer();
      selected=null;dirty=false;renderAll();updateSaveUI();
      toast("Reloaded the current version");
      return;
    }
    if(confirm("Save your version anyway? This overwrites what they just saved.")){
      const force=await api("/seating",{method:"PUT",body:JSON.stringify({data:state,force:true})});
      if(force.ok){
        const body2=await force.json();
        baseData=deepCopy(state);baseRevisionId=body2.revisionId;
        markSaved();toast("Saved (overwrote remote changes)");
      }else{
        alert("Force-save failed — try again.");
      }
    }
    return;
  }
  alert("Save failed — check your connection and try again.");
}
async function saveAsHTML(clickEvent){
  try{await saveToServer(!!(clickEvent&&clickEvent.shiftKey));}catch(e){alert("Save failed: "+(e&&e.message||e));}
}

/* ---------- Helpers ---------- */
function esc(s){return(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function shortName(n){
  if(n===REN)return"Ren fam";
  // members of a "+N" household all show the base name and the household's total headcount
  const base=n.trim().replace(/\s*\(.*?\)\s*$/,"").replace(/\s*\+\d+$/,"").trim();
  const esc=base.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const memberRe=new RegExp("^"+esc+"(\\s*\\+\\d+)?(\\s*\\(.*\\))?$");
  const household=state.guests.filter(g=>memberRe.test(g.name.trim())).length;
  if(household>1)return base+" ×"+household;
  const words=n.trim().replace(/[()]/g,"").split(/\s+/).filter(w=>!/^\+\d+$/.test(w));
  return words.length>1?words[0]+" "+words[words.length-1][0]+".":(words[0]||n);
}
let toastT;function toast(m){const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),1900);}

/* ---------- Zoom & pan (transform-based, free in both axes) ---------- */
let zoom=1, panX=0, panY=0;
// Keeps at least a slice of the plan on-screen at all times — without this,
// a drag or scroll-pan can push the whole plan off the canvas with nothing
// visible to grab to bring it back. Centralized here (every pan/zoom path
// already funnels through applyTransform) rather than clamped separately
// in each handler.
function clampPan(px,py,z){
  const wrap=document.getElementById("canvasWrap");
  const vp=document.getElementById("viewport");
  const ww=wrap.clientWidth, wh=wrap.clientHeight;
  const cw=vp.scrollWidth*z, ch=vp.scrollHeight*z;
  const mx=Math.min(160,cw*.3), my=Math.min(160,ch*.3);
  return{
    x: cw>0 ? Math.min(ww-mx,Math.max(mx-cw,px)) : px,
    y: ch>0 ? Math.min(wh-my,Math.max(my-ch,py)) : py,
  };
}
function applyTransform(){
  const c=clampPan(panX,panY,zoom);panX=c.x;panY=c.y;
  document.getElementById("viewport").style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
  document.getElementById("zoomLabel").textContent=Math.round(zoom*100)+"%";
}
function clampZoom(z){return Math.min(2,Math.max(.15,z));}
function zoomAround(f,cx,cy){            // cx,cy = focal point in canvas-wrap coords
  const nz=clampZoom(zoom*f);
  panX=cx-(cx-panX)*(nz/zoom);
  panY=cy-(cy-panY)*(nz/zoom);
  zoom=nz;applyTransform();
}
function zoomBy(f){const w=document.getElementById("canvasWrap");zoomAround(f,w.clientWidth/2,w.clientHeight/2);}
function centerOnEl(el){                 // pan so el is centered in the viewport (works at any zoom)
  const vp=document.getElementById("viewport"),wrap=document.getElementById("canvasWrap");
  vp.style.transition="transform .3s ease";
  const wr=wrap.getBoundingClientRect(),r=el.getBoundingClientRect();
  panX+=(wr.left+wrap.clientWidth/2)-(r.left+r.width/2);
  panY+=(wr.top+wrap.clientHeight/2)-(r.top+r.height/2);
  applyTransform();
  setTimeout(()=>{vp.style.transition="";},340);
}
function fitToScreen(){
  const w=document.getElementById("canvasWrap");
  const effW=PLAN_W*1.18;                 // include the Debussy tables sitting off the right edge
  zoom=clampZoom(Math.min((w.clientWidth-48)/effW,(w.clientHeight-48)/PLAN_H));
  panX=24;panY=24;applyTransform();
}
// pan by dragging empty background
let pan=null;
document.getElementById("canvasWrap").addEventListener("mousedown",e=>{
  if(e.target.closest(".table")||e.target.closest(".offplan h3"))return;   // don't hijack table/seat drags
  pan={x:e.clientX,y:e.clientY,px:panX,py:panY,moved:false};
  document.getElementById("canvasWrap").classList.add("panning");e.preventDefault();
});
window.addEventListener("mousemove",e=>{
  if(!pan)return;
  const dx=e.clientX-pan.x,dy=e.clientY-pan.y;
  if(Math.abs(dx)+Math.abs(dy)>3)pan.moved=true;
  panX=pan.px+dx;panY=pan.py+dy;applyTransform();
});
window.addEventListener("mouseup",()=>{if(pan){document.getElementById("canvasWrap").classList.remove("panning");if(!pan.moved&&selected){selected=null;renderCanvas();}pan=null;}});
// wheel: plain = pan, ctrl/⌘ = zoom at cursor
document.getElementById("canvasWrap").addEventListener("wheel",e=>{
  e.preventDefault();
  const r=e.currentTarget.getBoundingClientRect();
  if(e.ctrlKey||e.metaKey){zoomAround(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top);}
  else{panX-=e.deltaX;panY-=e.deltaY;applyTransform();}
},{passive:false});
document.getElementById("zoomIn").addEventListener("click",()=>zoomBy(1.15));
document.getElementById("zoomOut").addEventListener("click",()=>zoomBy(1/1.15));
document.getElementById("zoomLabel").addEventListener("click",fitToScreen);

/* ---------- Table view ---------- */
function setView(v){
  view=v;
  const show=(id,on)=>document.getElementById(id).style.display=on?"":"none";
  show("canvasWrap",v==="plan");show("tableview",v==="table");show("partiesview",v==="parties");
  document.getElementById("viewPlan").classList.toggle("active",v==="plan");
  document.getElementById("viewTable").classList.toggle("active",v==="table");
  document.getElementById("viewParties").classList.toggle("active",v==="parties");
  if(v==="table")renderTableView();
  if(v==="parties")renderPartiesView();
}
function toHex(c){return /^#[0-9a-fA-F]{6}$/.test(c||"")?c:"#888888";}
function partyList(){const s=new Set(Object.keys(state.partyColors));for(const g of state.guests)if(g.party)s.add(g.party);return [...s].sort((a,b)=>a.localeCompare(b));}
function renameParty(oldName,val){
  const newName=(val||"").trim();
  if(!newName||newName===oldName){renderPartiesView();return;}
  const color=state.partyColors[oldName];delete state.partyColors[oldName];
  if(!state.partyColors[newName])state.partyColors[newName]=color||partyColor(newName);
  for(const g of state.guests)if(g.party===oldName)g.party=newName;
  save();renderAll();
}
function deleteParty(name){for(const g of state.guests)if(g.party===name)g.party="";delete state.partyColors[name];save();renderAll();}
function renderPartiesView(){
  const box=document.getElementById("partiesview");
  const wasSearch=document.activeElement&&document.activeElement.id==="pSearch";
  const q=(document.getElementById("pSearch")?document.getElementById("pSearch").value:"").trim().toLowerCase();
  box.innerHTML="";
  const h1=document.createElement("h3");h1.className="pv-h";h1.textContent="Parties / groups";box.appendChild(h1);
  const cards=document.createElement("div");cards.className="pcards";
  const CAP=30;
  for(const name of partyList()){
    const members=state.guests.filter(g=>g.party===name).sort((a,b)=>a.name.localeCompare(b.name));
    const card=document.createElement("div");card.className="pcard";
    const top=document.createElement("div");top.className="top";
    const col=document.createElement("input");col.type="color";col.value=toHex(partyColor(name));
    col.addEventListener("input",e=>{state.partyColors[name]=e.target.value;save();renderGuests();renderCanvas();});
    const nm=document.createElement("input");nm.className="pname";nm.value=name;
    nm.addEventListener("change",()=>renameParty(name,nm.value));
    const cnt=document.createElement("span");cnt.className="pcount";cnt.textContent=members.length;
    const del=document.createElement("button");del.className="pdel";del.title="Delete party";del.textContent="\uD83D\uDDD1";
    del.addEventListener("click",()=>{if(confirm("Delete party \""+name+"\"? Its "+members.length+" guest(s) become unassigned."))deleteParty(name);});
    top.append(col,nm,cnt,del);card.appendChild(top);
    const chips=document.createElement("div");chips.className="pchips";
    if(!members.length){const e=document.createElement("span");e.className="pchip empty";e.textContent="no members";chips.appendChild(e);}
    members.slice(0,CAP).forEach(g=>{
      const chip=document.createElement("span");chip.className="pchip";
      chip.innerHTML=esc(g.name)+' <span class="x" title="Remove from party">\u00D7</span>';
      if(g.unconfirmed){chip.classList.add("unc");chip.title="awaiting RSVP";}
      chip.querySelector(".x").addEventListener("click",()=>{g.party="";save();renderAll();});
      chips.appendChild(chip);
    });
    if(members.length>CAP){const m=document.createElement("span");m.className="pchip more";m.textContent="+"+(members.length-CAP)+" more";chips.appendChild(m);}
    card.appendChild(chips);cards.appendChild(card);
  }
  box.appendChild(cards);
  const pnew=document.createElement("div");pnew.className="pnew";
  pnew.innerHTML='<input id="pNewName" placeholder="New party name" autocomplete="off"/><button class="btn small" id="pNewBtn">+ Create party</button>';
  box.appendChild(pnew);
  const h2=document.createElement("h3");h2.className="pv-h";h2.textContent="Assign guests to a party";box.appendChild(h2);
  const asg=document.createElement("div");asg.className="assign";
  const ahead=document.createElement("div");ahead.className="ahead";
  ahead.innerHTML='<input id="pSearch" class="in" placeholder="Search guests\u2026" style="max-width:260px" value="'+esc(q)+'"/><span class="pcount" id="pAsgCount"></span>';
  asg.appendChild(ahead);
  const opts=partyList();
  let guests=state.guests.slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(q)guests=guests.filter(g=>g.name.toLowerCase().includes(q)||(g.party||"").toLowerCase().includes(q));
  for(const g of guests){
    const row=document.createElement("div");row.className="arow";
    const dot=document.createElement("span");dot.className="adot";
    const dcol=g.party?partyColor(g.party):"#cfcabd";
    if(g.unconfirmed){dot.classList.add("dot-unc");dot.style.borderColor=dcol;dot.title="awaiting RSVP";}
    else dot.style.background=dcol;
    const nmS=document.createElement("span");nmS.className="aname";nmS.textContent=g.name;
    const sel=document.createElement("select");
    sel.innerHTML='<option value="__none__">\u2014 none \u2014</option>'+opts.map(p=>'<option value="'+esc(p)+'"'+(p===g.party?" selected":"")+'>'+esc(p)+'</option>').join("")+'<option value="__new__">\uFF0B New party\u2026</option>';
    if(!g.party)sel.value="__none__";
    sel.addEventListener("change",e=>{
      let v=e.target.value;
      if(v==="__new__"){const nn=prompt("New party name:");if(!nn||!nn.trim()){renderPartiesView();return;}v=nn.trim();partyColor(v);}
      g.party=v==="__none__"?"":v;save();renderAll();
    });
    row.append(dot,nmS,sel);asg.appendChild(row);
  }
  box.appendChild(asg);
  document.getElementById("pAsgCount").textContent=guests.length+" shown";
  document.getElementById("pSearch").addEventListener("input",renderPartiesView);
  document.getElementById("pNewBtn").addEventListener("click",()=>{const el=document.getElementById("pNewName");const v=el.value.trim();if(v){partyColor(v);save();renderAll();}});
  document.getElementById("pNewName").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("pNewBtn").click();});
  if(wasSearch){const s=document.getElementById("pSearch");s.focus();s.setSelectionRange(s.value.length,s.value.length);}
}
function renderTableView(){
  const box=document.getElementById("tableview");
  box.innerHTML="";
  for(const room of state.rooms){
    const tables=state.tables.filter(t=>t.roomId===room.id);
    if(!tables.length)continue;
    const h3=document.createElement("h3");
    h3.innerHTML=esc(room.name)+(room.note?` <span class="note">${esc(room.note)}</span>`:"");
    box.appendChild(h3);
    const cards=document.createElement("div");cards.className="tv-cards";
    for(const t of tables){
      const tbl=document.createElement("table");tbl.className="stable tv-card";
      const nameTh=document.createElement("th");nameTh.className="tname";nameTh.colSpan=2;nameTh.textContent=t.name;
      nameTh.draggable=true;nameTh.title="Drag onto another table's name to trade all guests";
      nameTh.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain","table:"+t.id);e.dataTransfer.effectAllowed="move";});
      nameTh.addEventListener("dragover",e=>{e.preventDefault();nameTh.classList.add("dropcell");});
      nameTh.addEventListener("dragleave",()=>nameTh.classList.remove("dropcell"));
      nameTh.addEventListener("drop",e=>{e.preventDefault();nameTh.classList.remove("dropcell");
        const d=e.dataTransfer.getData("text/plain");
        if(d.startsWith("table:"))swapTables(tableById(+d.slice(6)),t);});
      const cnt=document.createElement("span");cnt.className="cnt";
      cnt.textContent=t.seats.filter(Boolean).length+"/"+t.seats.length;
      nameTh.appendChild(cnt);
      const htr=document.createElement("tr");htr.appendChild(nameTh);
      const head=document.createElement("thead");head.appendChild(htr);tbl.appendChild(head);
      const tb=document.createElement("tbody");
      t.seats.forEach((gid,i)=>{
        const tr=document.createElement("tr");
        const num=document.createElement("td");num.className="snum";num.textContent=i+1;tr.appendChild(num);
        const td=document.createElement("td");
        td.className="seatcell";td.dataset.t=t.id;td.dataset.i=i;
        const g=gid?guestById(gid):null;
        if(g){
          const c=partyColor(g.party);
          if(isPlaceholder(g))td.className+=" ph";
          td.innerHTML=(g.unconfirmed
            ?`<span class="pill-dot dot-unc" style="border-color:${c}"></span>`
            :`<span class="pill-dot" style="background:${c}"></span>`)+esc(g.name)
            +(g.dietary?` <span class="diet" title="${esc(g.dietary)}"></span>`:"");
          td.title=(g.unconfirmed?"awaiting RSVP · ":"")+(g.party?g.party+" · ":"")+(g.dietary?g.dietary+" · ":"")+"click to unseat";
          td.draggable=true;
          td.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain","seat:"+t.id+":"+i);e.dataTransfer.effectAllowed="move";});
          td.addEventListener("click",()=>{t.seats[i]=null;save();renderAll();});
        }else{td.className+=" empty";}
        td.addEventListener("dragover",e=>{e.preventDefault();td.classList.add("dropcell");});
        td.addEventListener("dragleave",()=>td.classList.remove("dropcell"));
        td.addEventListener("drop",e=>{e.preventDefault();td.classList.remove("dropcell");handleDrop(e,t,i);});
        tr.appendChild(td);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      // Dietary needs are free text and too long for a cell, so the cell only
      // carries a small dot marker and the full wording lands in a footnote under the
      // table — the form the caterer actually works from.
      const diets=t.seats.map(gid=>gid?guestById(gid):null).filter(g=>g&&g.dietary);
      if(diets.length){
        const tf=document.createElement("tfoot");
        tf.innerHTML=`<tr><td class="dietfoot" colspan="2">`+
          diets.map(g=>`<div><b>${esc(g.name)}</b> — ${esc(g.dietary)}</div>`).join("")+
          `</td></tr>`;
        tbl.appendChild(tf);
      }
      cards.appendChild(tbl);
    }
    box.appendChild(cards);
  }
}

/* ---------- PDF (print layout) ----------
   Builds a clean, paginated document into #printRoot and opens the print dialog.
   Page 1 is the floor plan (scaled to fit a page); the rest are per-table guest
   lists grouped by room. Choosing "Save as PDF" in the dialog yields the file. */
/* Draw the floor plan as a standalone SVG straight from state — same coordinate
   system as the live plan (PLAN_W/PLAN_H, fx/fy, seatPositions), so table spacing
   matches exactly, but with print-legible sizing and no DOM cloning. Seats are
   party-colored dots; the map shows table names + counts. Names live in the lists. */
function planHull(){                                  // tight bounds of everything drawn, in plan px
  let x0=0,y0=0,x1=PLAN_W,y1=PLAN_H;
  for(const r of roomOutlines(state.rooms)){x0=Math.min(x0,r.x1*PLAN_W);y0=Math.min(y0,r.y1*PLAN_H);x1=Math.max(x1,r.x2*PLAN_W);y1=Math.max(y1,r.y2*PLAN_H);}
  for(const t of state.tables.filter(t=>t.onPlan!==false)){
    const cx=t.fx*PLAN_W,cy=t.fy*PLAN_H,reach=(t.oval?104:82)+30;
    x0=Math.min(x0,cx-reach);y0=Math.min(y0,cy-reach);x1=Math.max(x1,cx+reach);y1=Math.max(y1,cy+reach);
  }
  const m=24;return{x:x0-m,y:y0-m,w:(x1-x0)+2*m,h:(y1-y0)+2*m};
}
function planSVG(){
  const h=planHull();
  const A=`http://www.w3.org/2000/svg`;
  let s=`<svg viewBox="${h.x} ${h.y} ${h.w} ${h.h}" xmlns="${A}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">`;
  for(const r of roomOutlines(state.rooms)){
    const x=r.x1*PLAN_W,y=r.y1*PLAN_H,w=(r.x2-r.x1)*PLAN_W,hh=(r.y2-r.y1)*PLAN_H;
    s+=`<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="20" fill="#ffffff" stroke="#b8ad93" stroke-width="2.5"/>`;
    s+=`<text x="${x+16}" y="${y+34}" font-size="27" font-weight="600" letter-spacing="2" fill="#8f836a">${esc(r.name.toUpperCase())}</text>`;
  }
  for(const t of state.tables.filter(t=>t.onPlan!==false)){
    const cx=t.fx*PLAN_W,cy=t.fy*PLAN_H;
    seatPositions(t).forEach((p,i)=>{
      const gid=t.seats[i],g=gid?guestById(gid):null,sx=cx+p.x,sy=cy+p.y;
      if(g){const c=partyColor(g.party);
        s+=`<circle cx="${sx}" cy="${sy}" r="20" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="${g.unconfirmed?2.5:2}"${g.unconfirmed?' stroke-dasharray="4 3"':""}/>`;
        if(g.dietary)s+=`<circle cx="${sx+14}" cy="${sy-14}" r="4.5" fill="#b23a2e"/>`;
      }else{
        s+=`<circle cx="${sx}" cy="${sy}" r="20" fill="#f4f1ea" stroke="#c8c0b0" stroke-width="1.5"/>`;
        s+=`<text x="${sx}" y="${sy+5}" font-size="15" text-anchor="middle" fill="#b3ada0">${i+1}</text>`;
      }
    });
    if(t.oval)s+=`<ellipse cx="${cx}" cy="${cy}" rx="75" ry="37" fill="#ffffff" stroke="#c8c0b0" stroke-width="2"/>`;
    else s+=`<circle cx="${cx}" cy="${cy}" r="41" fill="#ffffff" stroke="#c8c0b0" stroke-width="2"/>`;
    const filled=t.seats.filter(Boolean).length,cap=t.seats.length;
    s+=`<text x="${cx}" y="${cy-1}" font-size="19" font-weight="700" text-anchor="middle" fill="#1e2430">${esc(t.name)}</text>`;
    s+=`<text x="${cx}" y="${cy+18}" font-size="16" text-anchor="middle" fill="${filled>=cap?"#2ea36a":"#6b7280"}">${filled}/${cap}</text>`;
  }
  return s+`</svg>`;
}
function buildPrintRoot(){
  const root=document.getElementById("printRoot");
  root.innerHTML="";
  const when=fmtRev(state.rev);
  const seated=state.guests.filter(g=>seatOf(g.id)).length;
  const subline=`${venueName}${when?" · version "+esc(when):""}`;

  // Page 1 — floor plan (self-drawn SVG)
  const p1=document.createElement("div");p1.className="pr-page";
  p1.innerHTML=`<h1 class="pr-title">Seating Plan</h1>`+
    `<div class="pr-sub">${subline} · ${seated} guests seated across ${state.tables.length} tables</div>`;
  const legend=document.createElement("div");legend.className="pr-legend";
  legend.innerHTML=partyList().map(p=>`<span><i style="background:${partyColor(p)}"></i>${esc(p)}</span>`).join("")
    +(state.guests.some(g=>g.dietary)?`<span><i style="background:#b23a2e"></i>dietary need (see table lists)</span>`:"");
  p1.appendChild(legend);
  const box=document.createElement("div");box.className="pr-planbox";box.innerHTML=planSVG();
  p1.appendChild(box);
  root.appendChild(p1);

  // Page 2+ — guest lists by table
  const p2=document.createElement("div");p2.className="pr-page";
  p2.innerHTML=`<h1 class="pr-title">Guest lists by table</h1><div class="pr-sub">${subline}</div>`;
  for(const room of state.rooms){
    const tables=state.tables.filter(t=>t.roomId===room.id);
    if(!tables.length)continue;
    const h=document.createElement("div");h.className="pr-h";
    h.innerHTML=esc(room.name)+(room.note?` <span class="note">${esc(room.note)}</span>`:"");
    p2.appendChild(h);
    const grid=document.createElement("div");grid.className="pr-tables";
    for(const t of tables){
      const filled=t.seats.filter(Boolean).length;
      const card=document.createElement("div");card.className="pr-card";
      let li="";
      t.seats.forEach(gid=>{
        const g=gid?guestById(gid):null;
        if(g)li+=`<li><span class="dot" style="background:${partyColor(g.party)}"></span>${esc(g.name)}${g.dietary?' <span class="diet"></span>':""}${g.unconfirmed?' <span class="unc">(pending)</span>':""}</li>`;
        else li+=`<li class="empty">empty</li>`;
      });
      const diets=t.seats.map(gid=>gid?guestById(gid):null).filter(g=>g&&g.dietary);
      const foot=diets.length
        ?`<div class="pr-diet">`+diets.map(g=>`<div><b>${esc(g.name)}</b> — ${esc(g.dietary)}</div>`).join("")+`</div>`
        :"";
      card.innerHTML=`<h4>${esc(t.name)}<span class="c">${filled}/${t.seats.length}</span></h4><ol>${li}</ol>${foot}`;
      grid.appendChild(card);
    }
    p2.appendChild(grid);
  }
  root.appendChild(p2);
}
function openPDF(){
  buildPrintRoot();
  document.body.classList.add("printing");
  const done=()=>{document.body.classList.remove("printing");document.getElementById("printRoot").innerHTML="";window.removeEventListener("afterprint",done);};
  window.addEventListener("afterprint",done);
  setTimeout(()=>{window.print();},60);
}

/* ---------- Read-only copy ----------
   A lightweight, self-contained viewer: the plan and table lists, zoom/pan and
   guest search — but none of the editing, drag-drop, or file-saving machinery.
   readonlyViewer (below) is the one function that runs inside it, serialized
   via toString() into the exported file. Its markup and CSS live in their own
   readonly.html / readonly.css (fetched at export time, see buildReadOnlyHTML)
   rather than duplicated here as JS strings — the downloaded file still ends
   up fully self-contained since the fetched text gets inlined into it. */
function readonlyViewer(){
  "use strict";
  const S=window.__EMBEDDED_STATE__;
  const PLAN_W=1620,PLAN_H=1802,REN="Ren Fam from China/France";
  const PALETTE=["#3b6fd4","#d1483c","#2ea36a","#c9971f","#8b5cd6","#d857a8","#0e9aa8","#e07a34","#5a6b7b","#7a9b2e"];
  function roomOutlines(rooms){return rooms.filter(r=>r.x1!==undefined);}
  const pc=Object.assign({},S.partyColors||{});
  let view="plan",hl=new Set();
  const $=id=>document.getElementById(id);
  function esc(s){return(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function guestById(id){return S.guests.find(g=>g.id===id);}
  function roomById(id){return S.rooms.find(r=>r.id===id);}
  function seatOf(id){for(const t of S.tables){const i=t.seats.indexOf(id);if(i>=0)return{table:t,index:i};}return null;}
  function isPlaceholder(g){return g&&(g.name===REN||/plus\s*1|groomsman|bridesmaid|^guest\b/i.test(g.name));}
  function partyColor(p){if(!p)return"#9aa3ad";if(!pc[p]){pc[p]=PALETTE[Object.keys(pc).length%PALETTE.length];}return pc[p];}
  function seatPositions(t){const n=t.seats.length,pts=[],rx=t.oval?104:82,ry=t.oval?64:82;for(let i=0;i<n;i++){const a=-Math.PI/2+i*2*Math.PI/n;pts.push({x:Math.cos(a)*rx,y:Math.sin(a)*ry});}return pts;}
  function shortName(n){
    if(n===REN)return"Ren fam";
    const base=n.trim().replace(/\s*\(.*?\)\s*$/,"").replace(/\s*\+\d+$/,"").trim();
    const e=base.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const re=new RegExp("^"+e+"(\\s*\\+\\d+)?(\\s*\\(.*\\))?$");
    const hh=S.guests.filter(g=>re.test(g.name.trim())).length;
    if(hh>1)return base+" ×"+hh;
    const w=n.trim().replace(/[()]/g,"").split(/\s+/).filter(x=>!/^\+\d+$/.test(x));
    return w.length>1?w[0]+" "+w[w.length-1][0]+".":(w[0]||n);
  }
  function buildTable(t,off){
    const el=document.createElement("div");
    el.className="table"+(t.oval?" oval":"")+(off?" off":"");
    if(!off){el.style.left=(t.fx*100)+"%";el.style.top=(t.fy*100)+"%";}
    const filled=t.seats.filter(Boolean).length,cap=t.seats.length;
    const surf=document.createElement("div");surf.className="surface";
    surf.innerHTML=`<div><div class="t-label">${esc(t.name)}</div><div class="t-count${filled>=cap?" full":""}">${filled}/${cap}</div></div>`;
    el.appendChild(surf);
    seatPositions(t).forEach((p,i)=>{
      const gid=t.seats[i],g=gid?guestById(gid):null;
      const seat=document.createElement("div");
      seat.className="seat"+(g?" occupied":"")+(g&&g.unconfirmed?" unconfirmed":"")+(g&&isPlaceholder(g)?" placeholder":"")+(g&&g.dietary?" diet":"")+(gid&&hl.has(gid)?" hl":"");
      seat.dataset.t=t.id;seat.dataset.i=i;
      seat.style.left=`calc(50% + ${p.x}px)`;seat.style.top=`calc(50% + ${p.y}px)`;
      if(g){const c=partyColor(g.party);seat.style.setProperty("--sc",c);if(g.party)seat.dataset.color="1";
        seat.innerHTML=`<span class="s-name">${esc(shortName(g.name))}</span>`;
        seat.title=g.name+(g.party?` · ${g.party}`:"")+(g.unconfirmed?" · awaiting RSVP":"")+(g.dietary?` · ${g.dietary}`:"");
      }else{seat.innerHTML=`<span class="s-num">${i+1}</span>`;}
      el.appendChild(seat);
    });
    return el;
  }
  function renderCanvas(){
    const plan=$("plan");plan.style.width=PLAN_W+"px";plan.style.height=PLAN_H+"px";plan.innerHTML="";
    for(const r of roomOutlines(S.rooms)){const o=document.createElement("div");o.className="room-outline";
      o.style.left=(r.x1*100)+"%";o.style.top=(r.y1*100)+"%";o.style.width=((r.x2-r.x1)*100)+"%";o.style.height=((r.y2-r.y1)*100)+"%";
      o.innerHTML=`<span class="ro-label">${esc(r.name)}</span>`;plan.appendChild(o);}
    for(const t of S.tables.filter(t=>t.onPlan!==false))plan.appendChild(buildTable(t,false));
    const off=$("offplan");off.innerHTML="";
    const offTables=S.tables.filter(t=>t.onPlan===false);
    if(offTables.length){const byRoom={};for(const t of offTables)(byRoom[t.roomId]=byRoom[t.roomId]||[]).push(t);
      for(const rid in byRoom){const r=roomById(+rid);const h=document.createElement("h3");h.textContent=(r?r.name:"Off plan")+(r&&r.note?" · "+r.note:"");off.appendChild(h);
        const row=document.createElement("div");row.className="row-tables";for(const t of byRoom[rid])row.appendChild(buildTable(t,true));off.appendChild(row);}}
  }
  function renderTableView(){
    const box=$("tableview");box.innerHTML="";
    for(const room of S.rooms){
      const tables=S.tables.filter(t=>t.roomId===room.id);if(!tables.length)continue;
      const h3=document.createElement("h3");h3.innerHTML=esc(room.name)+(room.note?` <span class="note">${esc(room.note)}</span>`:"");box.appendChild(h3);
      const maxCap=Math.max.apply(null,tables.map(t=>t.seats.length));
      const tbl=document.createElement("table");tbl.className="stable";
      let head="<tr><th>Table</th>";for(let i=0;i<maxCap;i++)head+=`<th>${i+1}</th>`;head+="<th>Seated</th></tr>";
      tbl.innerHTML="<thead>"+head+"</thead>";const tb=document.createElement("tbody");
      for(const t of tables){
        const tr=document.createElement("tr");
        const nameTd=document.createElement("td");nameTd.className="tname";nameTd.textContent=t.name;tr.appendChild(nameTd);
        for(let i=0;i<maxCap;i++){
          const td=document.createElement("td");
          if(i<t.seats.length){
            const gid=t.seats[i],g=gid?guestById(gid):null;
            if(g){const c=partyColor(g.party);if(isPlaceholder(g))td.className="ph";
              td.innerHTML=(g.unconfirmed?`<span class="pill-dot dot-unc" style="border-color:${c}"></span>`:`<span class="pill-dot" style="background:${c}"></span>`)+esc(g.name);
              td.title=(g.unconfirmed?"awaiting RSVP · ":"")+(g.party||"");
              if(gid&&hl.has(gid))td.className+=" hl";
            }else{td.className="empty";}
          }else{td.className="nocell";}
          tr.appendChild(td);
        }
        const cnt=document.createElement("td");cnt.className="cnt";cnt.textContent=t.seats.filter(Boolean).length+"/"+t.seats.length;tr.appendChild(cnt);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);box.appendChild(tbl);
    }
  }
  /* zoom & pan */
  let zoom=1,panX=0,panY=0;
  function clampAxis(pan,viewport,content,m){
    if(content<=viewport)return Math.max(0,Math.min(pan,viewport-content));   // fits: keep fully inside
    return Math.max(viewport-content-m,Math.min(pan,m));                       // bigger: at most m px past each edge
  }
  function clampPan(){
    const w=$("canvasWrap"),m=60;
    panX=clampAxis(panX,w.clientWidth,PLAN_W*1.15*zoom,m);                     // 1.15·W covers the off-edge Debussy tables
    panY=clampAxis(panY,w.clientHeight,PLAN_H*zoom,m);
  }
  function applyTransform(){clampPan();$("viewport").style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;$("zFit").textContent=Math.round(zoom*100)+"%";}
  function clampZoom(z){return Math.min(2,Math.max(.15,z));}
  function zoomAround(f,cx,cy){const nz=clampZoom(zoom*f);panX=cx-(cx-panX)*(nz/zoom);panY=cy-(cy-panY)*(nz/zoom);zoom=nz;applyTransform();}
  function zoomBy(f){const w=$("canvasWrap");zoomAround(f,w.clientWidth/2,w.clientHeight/2);}
  function fitToScreen(){const w=$("canvasWrap");const effW=PLAN_W*1.18;zoom=clampZoom(Math.min((w.clientWidth-48)/effW,(w.clientHeight-48)/PLAN_H));panX=24;panY=24;applyTransform();}
  function centerOnEl(el){const vp=$("viewport"),wrap=$("canvasWrap");vp.style.transition="transform .3s ease";
    const wr=wrap.getBoundingClientRect(),r=el.getBoundingClientRect();
    panX+=(wr.left+wrap.clientWidth/2)-(r.left+r.width/2);panY+=(wr.top+wrap.clientHeight/2)-(r.top+r.height/2);
    applyTransform();setTimeout(()=>{vp.style.transition="";},340);}
  let pan=null;
  $("canvasWrap").addEventListener("mousedown",e=>{if(e.target.closest(".table"))return;pan={x:e.clientX,y:e.clientY,px:panX,py:panY};$("canvasWrap").classList.add("panning");e.preventDefault();});
  window.addEventListener("mousemove",e=>{if(!pan)return;panX=pan.px+(e.clientX-pan.x);panY=pan.py+(e.clientY-pan.y);applyTransform();});
  window.addEventListener("mouseup",()=>{if(pan){$("canvasWrap").classList.remove("panning");pan=null;}});
  $("canvasWrap").addEventListener("wheel",e=>{e.preventDefault();const r=e.currentTarget.getBoundingClientRect();
    if(e.ctrlKey||e.metaKey){zoomAround(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top);}else{panX-=e.deltaX;panY-=e.deltaY;applyTransform();}},{passive:false});
  /* search */
  function doSearch(){
    const q=$("search").value.trim().toLowerCase();hl=new Set();
    if(q)for(const g of S.guests)if(g.name.toLowerCase().includes(q)||(g.party||"").toLowerCase().includes(q))hl.add(g.id);
    renderCanvas();if(view==="table")renderTableView();
    if(q&&hl.size){const first=[...hl].map(seatOf).find(Boolean);
      if(first&&view==="plan"){if(zoom<0.55){zoom=0.8;applyTransform();}
        const el=document.querySelector(`.seat[data-t="${first.table.id}"][data-i="${first.index}"]`);if(el)centerOnEl(el);}}
  }
  function setView(v){view=v;$("canvasWrap").style.display=v==="plan"?"":"none";$("tableview").style.display=v==="table"?"":"none";
    $("vPlan").classList.toggle("active",v==="plan");$("vTable").classList.toggle("active",v==="table");if(v==="table")renderTableView();}
  /* init */
  const seated=S.guests.filter(g=>seatOf(g.id)).length;
  $("stS").textContent=seated;$("stT").textContent=S.tables.length;
  renderCanvas();fitToScreen();
  $("vPlan").addEventListener("click",()=>setView("plan"));
  $("vTable").addEventListener("click",()=>setView("table"));
  $("zIn").addEventListener("click",()=>zoomBy(1.15));$("zOut").addEventListener("click",()=>zoomBy(1/1.15));
  $("zFit").addEventListener("click",fitToScreen);
  $("search").addEventListener("input",doSearch);
}
// Both the CSS and the HTML shell live in their own files (readonly.css,
// readonly.html) rather than duplicated here as JS strings — fetched at
// export time and stitched together with simple {{TOKEN}} substitution
// (split/join, not .replace(), so "$"-sequences in the CSS/state/viewer
// source can't be misread as replacement patterns). The result still ends
// up as one self-contained downloaded file; only the source is split up.
async function buildReadOnlyHTML(){
  const [css,tpl]=await Promise.all([
    fetch("readonly.css").then(r=>r.text()),
    fetch("readonly.html").then(r=>r.text()),
  ]);
  const when=fmtRev(state.rev);
  const subtitle=esc(venueName)+" · view only"+(when?" · "+esc(when):"");
  return tpl
    .split("{{CSS}}").join(css)
    .split("{{SUBTITLE}}").join(subtitle)
    .split("{{STATE_JSON}}").join(embedJSON(state))
    .split("{{VIEWER_FN}}").join(readonlyViewer.toString());
}
async function downloadReadOnly(){
  const html=await buildReadOnlyHTML();
  const now=new Date(),pad=n=>String(n).padStart(2,"0");
  const stamp=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const blob=new Blob([html],{type:"text/html"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`seating-plan (view only) ${stamp}.html`;a.click();URL.revokeObjectURL(a.href);
  toast("Read-only copy downloaded — share that file; it can't be edited.");
}

/* ---------- Wire ---------- */
document.getElementById("addGuest").addEventListener("click",()=>{const n=document.getElementById("guestName"),p=document.getElementById("partyName");addGuest(n.value,p.value);n.value="";n.focus();});
document.getElementById("guestName").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("addGuest").click();});
document.getElementById("partyName").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("addGuest").click();});
document.getElementById("search").addEventListener("input",renderGuests);
document.getElementById("unseatedOnly").addEventListener("change",renderGuests);
document.getElementById("autoSeat").addEventListener("click",autoSeat);
document.getElementById("clearSeats").addEventListener("click",clearSeats);
document.getElementById("saveHtmlBtn").addEventListener("click",saveAsHTML);
document.getElementById("pdfBtn").addEventListener("click",openPDF);
document.getElementById("readonlyBtn").addEventListener("click",downloadReadOnly);
const help=document.getElementById("help");
document.getElementById("helpBtn").addEventListener("click",()=>{help.hidden=false;});
const historyPanel=document.getElementById("history");
async function openHistory(){
  historyPanel.hidden=false;
  const box=document.getElementById("historyList");
  box.innerHTML='<p class="hist-empty">Loading…</p>';
  const res=await api("/seating/revisions");
  if(!res.ok){box.innerHTML='<p class="hist-empty">Couldn\'t load history — try again.</p>';return;}
  const {revisions}=await res.json();
  if(!revisions.length){box.innerHTML='<p class="hist-empty">No past saves yet.</p>';return;}
  box.innerHTML="";
  for(const r of revisions){
    const row=document.createElement("div");row.className="hist-row";
    row.innerHTML=`<span class="hist-when">${r.keepForever?'<span class="pin">📌</span> ':""}${esc(fmtRev(r.modifiedTime))}</span>`+
      `<button class="btn small" data-id="${esc(r.id)}">Compare with current</button>`;
    row.querySelector("button").addEventListener("click",()=>compareRevision(r.id));
    box.appendChild(row);
  }
}
async function compareRevision(id){
  const res=await api(`/seating/revisions/${encodeURIComponent(id)}/diff`);
  if(!res.ok){
    const body=await res.json().catch(()=>null);
    alert(body&&body.error?body.error:"Couldn't load that comparison — try again.");
    return;
  }
  const {changes}=await res.json();
  alert(changes.length?"Changes since that save:\n\n"+changes.map(c=>"• "+c).join("\n"):"No changes since that save.");
}
document.getElementById("historyBtn").addEventListener("click",openHistory);
document.getElementById("historyClose").addEventListener("click",()=>{historyPanel.hidden=true;});
historyPanel.addEventListener("click",e=>{if(e.target.id==="history")historyPanel.hidden=true;});
const appEl=document.getElementById("app");
document.getElementById("sideToggle").addEventListener("click",()=>appEl.classList.toggle("side-open"));
document.getElementById("sideBackdrop").addEventListener("click",()=>appEl.classList.remove("side-open"));
document.getElementById("helpClose").addEventListener("click",()=>{help.hidden=true;});
help.addEventListener("click",e=>{if(e.target.id==="help")help.hidden=true;});
window.addEventListener("keydown",e=>{if(e.key==="Escape"){help.hidden=true;historyPanel.hidden=true;appEl.classList.remove("side-open");if(swapFrom){swapFrom=null;renderAll();toast("Swap cancelled");}}});
document.getElementById("viewPlan").addEventListener("click",()=>setView("plan"));
document.getElementById("viewTable").addEventListener("click",()=>setView("table"));
document.getElementById("viewParties").addEventListener("click",()=>setView("parties"));
document.getElementById("discardBtn").addEventListener("click",()=>{
  if(!dirty||!baseData)return;
  if(!confirm("Throw away your unsaved changes and go back to the last saved version?"))return;
  state=deepCopy(baseData);selected=null;
  dirty=false;renderAll();updateSaveUI();
  toast("Back to the last saved version");
});
document.getElementById("plan").addEventListener("click",e=>{if(e.target.id==="plan"){selected=null;renderCanvas();}});

async function init(){
  try{
    const config=await (await fetch("/api/config")).json();
    venueName=config.venueName||"";
    await loadFromServer();
  }catch(e){
    document.body.innerHTML='<div style="padding:40px;font:16px sans-serif;color:#900">Couldn\'t load seating data: '+esc(e&&e.message||String(e))+'<br><br><button onclick="location.reload()">Retry</button></div>';
    return;
  }
  renderAll();
  fitToScreen();
  setView("table");
  updateSaveUI();
}
init();
window.addEventListener("beforeunload",e=>{if(dirty){e.preventDefault();e.returnValue="";}});
if(!localStorage.getItem("seating-help-seen")){document.getElementById("help").hidden=false;localStorage.setItem("seating-help-seen","1");}
