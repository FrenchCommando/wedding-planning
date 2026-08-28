"use strict";
/* ------------------------------------------------------------------ *
 * Music plan — segments of the day, each with a bed of tracks and
 * pinned cues, synced to Spotify playlists.
 *
 * Ported from the standalone playlists/music-plan.html: same UI and
 * Spotify logic, but persistence is now the backend (GET/PUT + Drive
 * optimistic lock), not "state baked into this HTML file + a
 * localStorage stash". Spotify auth stays entirely client-side (PKCE,
 * no client secret, tokens in localStorage, per-browser) — moving the
 * plan's own data to the backend doesn't change that part at all,
 * except that the redirect URI is now this page's new served path and
 * has to be re-registered in the Spotify dashboard by hand.
 * ------------------------------------------------------------------ */
const AUTH_KEY="music-plan-spotify-auth";
const CID_KEY="music-plan-spotify-client-id";
const SCOPES="playlist-read-private playlist-modify-private playlist-modify-public";

let state=null, revisionId=null, session=null, canEdit=false;
let selId=null;
let view="seg", dirty=false;
let auth=loadAuth(), me=null;

/* ---------- backend ---------- */
function api(path,opts){
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
async function loadSession(){
  const res=await api("/whoami");
  const body=await res.json();
  session=body.session;
}
async function loadData(){
  let res=await api("/playlist");
  if(res.status===403){
    await promptForLogin();
    await loadSession();
    res=await api("/playlist");
  }
  if(!res.ok)throw new Error("failed to load playlist data");
  const body=await res.json();
  state=body.data;
  revisionId=body.revisionId;
  state.nextId=state.nextId||1;
  state.segments=state.segments||[];
  for(const g of state.segments){
    g.items=g.items||[];
    if(g.playlistId===undefined)g.playlistId=null;
    if(g.id>=state.nextId)state.nextId=g.id+1;
    for(const it of g.items){if(it.id>=state.nextId)state.nextId=it.id+1;}
  }
}
async function saveToServer(){
  const res=await api("/playlist",{method:"PUT",body:JSON.stringify({data:state,revisionId})});
  if(res.ok){
    const body=await res.json();
    revisionId=body.revisionId;
    dirty=false;updateSaveUI();
    toast("Saved");
    return;
  }
  if(res.status===409){
    if(confirm("Someone else saved changes since you loaded this page. Reload their version? Your unsaved edits here will be lost. (Cancel keeps editing, but you can't save until you reload.)")){
      await loadData();selId=state.segments[0]?state.segments[0].id:null;dirty=false;renderAll();
    }
    return;
  }
  toast("Save failed — check your connection and try again.");
}
async function openHistory(){
  openModal(`<button class="x" data-close>✕</button><h2>History</h2><p class="lead">Loading…</p>`);
  const res=await api("/playlist/revisions");
  if(!res.ok){document.getElementById("modalBody").querySelector(".lead").textContent="Couldn't load history — try again.";return;}
  const {revisions}=await res.json();
  if(!revisions.length){
    openModal(`<button class="x" data-close>✕</button><h2>History</h2><p class="lead">No past saves yet.</p>`);
    return;
  }
  const rows=revisions.map(r=>`<div class="mrow"><span style="flex:1">${r.keepForever?"📌 ":""}${esc(fmtRev(r.modifiedTime))}</span><button class="btn small" data-id="${esc(r.id)}">Compare with current</button></div>`).join("");
  openModal(`<button class="x" data-close>✕</button><h2>History</h2><p class="lead">Past saves of this plan.</p>${rows}`);
  document.querySelectorAll("#modalBody [data-id]").forEach(b=>b.onclick=()=>compareRevision(b.dataset.id));
}
async function compareRevision(id){
  const res=await api(`/playlist/revisions/${encodeURIComponent(id)}/diff`);
  if(!res.ok){
    const body=await res.json().catch(()=>null);
    alert(body&&body.error?body.error:"Couldn't load that comparison — try again.");
    return;
  }
  const {changes}=await res.json();
  alert(changes.length?"Changes since that save:\n\n"+changes.map(c=>"• "+c).join("\n"):"No changes since that save.");
}
function fmtRev(rev){const d=new Date(rev||"");if(isNaN(d))return"";return d.toLocaleDateString(undefined,{day:"numeric",month:"short"})+", "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});}

function uid(){return state.nextId++;}
function markDirty(){dirty=true;updateSaveUI();}
function updateSaveUI(){
  const b=document.getElementById("saveBtn");
  if(!canEdit){b.style.display="none";return;}
  if(dirty){b.classList.add("primary");b.textContent="Save — unsaved";}
  else{b.classList.remove("primary");b.textContent="Saved ✓";}
}

/* ---------- time helpers ---------- */
// Clock times wrap past midnight: any end before its start is the next day.
function toMin(hhmm){const m=/^(\d{1,2}):(\d{2})$/.exec((hhmm||"").trim());return m?(+m[1])*60+(+m[2]):null;}
function fromMin(n){n=((n%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
function spanMin(seg){const a=toMin(seg.start),b=toMin(seg.end);if(a==null||b==null)return null;return b>=a?b-a:b+1440-a;}
function fmtDur(ms){if(!ms)return"—";const t=Math.round(ms/1000);const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;
  return h?h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"):m+":"+String(s).padStart(2,"0");}
function fmtMins(m){const a=Math.abs(Math.round(m));return (a>=60?Math.floor(a/60)+"h"+(a%60?String(a%60).padStart(2,"0"):""):a+" min");}
function segById(id){return state.segments.find(s=>s.id===id);}
function selSeg(){return segById(selId)||state.segments[0]||null;}
function tracksOf(seg){return seg.items.filter(i=>i.kind!=="cue");}
function runtimeMs(seg){return seg.items.reduce((n,i)=>n+(i.durationMs||0),0);}

/* ---------- render ---------- */
function renderAll(){renderSegs();renderPane();renderTotals();updateSpotUI();updateSaveUI();}

function renderSegs(){
  const box=document.getElementById("segList");box.innerHTML="";
  state.segments.forEach((seg,idx)=>{
    const span=spanMin(seg), run=runtimeMs(seg)/60000;
    const el=document.createElement("div");
    el.className="seg"+(seg.id===selId?" sel":"");
    el.draggable=canEdit;el.dataset.id=seg.id;
    const pct=span?Math.min(100,run/span*100):0;
    const delta=span?run-span:null;
    const cls=delta==null?"":(delta>2?"over":(delta<-5?"short":"good"));
    el.innerHTML=`<span class="bar"></span>
      <div class="s-top"><span class="s-name"></span><span class="s-time">${esc(seg.start)}–${esc(seg.end)}</span></div>
      <div class="s-meta">
        <span>${tracksOf(seg).length} tr</span>
        <span class="fill"><i class="${cls==="over"?"over":cls==="good"?"good":""}" style="width:${pct}%"></i></span>
        <span class="delta ${cls==="over"?"":cls}">${span==null?"—":(delta>0?"+":"")+fmtMins(delta)}</span>
      </div>`;
    el.querySelector(".s-name").textContent=seg.name;
    el.onclick=()=>{selId=seg.id;view="seg";renderAll();};
    if(canEdit)wireSegDrag(el,idx);
    box.appendChild(el);
    // gap/overlap between this segment and the next
    const nxt=state.segments[idx+1];
    if(nxt){
      const g=gapBetween(seg,nxt);
      if(g!==null&&g!==0){
        const d=document.createElement("div");
        d.className="gap"+(g<0?" bad":"");
        d.textContent=g<0?fmtMins(g)+" overlap":fmtMins(g)+" gap";
        box.appendChild(d);
      }
    }
  });
}
function gapBetween(a,b){const e=toMin(a.end),s=toMin(b.start);if(e==null||s==null)return null;let g=s-e;if(g<-720)g+=1440;return g;}

function renderTotals(){
  document.getElementById("tSegs").textContent=state.segments.length;
  document.getElementById("tTracks").textContent=state.segments.reduce((n,s)=>n+tracksOf(s).length,0);
  const ms=state.segments.reduce((n,s)=>n+runtimeMs(s),0);
  document.getElementById("tRun").textContent=ms?fmtDur(ms):"0:00";
  document.getElementById("viewSeg").classList.toggle("active",view==="seg");
  document.getElementById("viewTl").classList.toggle("active",view==="tl");
}

function renderPane(){
  const pane=document.getElementById("pane");
  pane.innerHTML="";
  if(view==="tl")return renderTimeline(pane);
  const seg=selSeg();
  if(!seg){pane.innerHTML=`<div class="card"><div class="empty">No segments yet${canEdit?" — add one on the left.":"."}</div></div>`;return;}

  const card=document.createElement("div");card.className="card";
  const span=spanMin(seg), run=runtimeMs(seg)/60000, delta=span?run-span:null;
  const pct=span?Math.min(100,run/span*100):0;
  const cls=delta==null?"":(delta>2?"over":(delta<-5?"":"good"));
  const untimed=tracksOf(seg).filter(t=>!t.durationMs).length;

  card.innerHTML=`
    <div class="card-h">
      <input class="nm" id="segName" value="${esc(seg.name)}" ${canEdit?"":"readonly"}>
      <input class="tm" id="segStart" value="${esc(seg.start)}" placeholder="HH:MM" ${canEdit?"":"readonly"}>
      <span class="sep">→</span>
      <input class="tm" id="segEnd" value="${esc(seg.end)}" placeholder="HH:MM" ${canEdit?"":"readonly"}>
      ${canEdit?`<button class="btn small" id="playlistBtn">${seg.playlistId?"Playlist ✓":"No playlist"}</button>`:(seg.playlistId?`<span class="btn small" style="cursor:default">Playlist ✓</span>`:"")}
      ${canEdit?'<button class="btn small ghost" id="delSegBtn" title="Delete segment">✕</button>':""}
    </div>
    <div class="runline">
      <span>Slot <b>${span==null?"—":fmtMins(span)}</b></span>
      <span>Music <b>${run?fmtMins(run):"0 min"}</b></span>
      <span class="fill"><i class="${cls}" style="width:${pct}%"></i></span>
      <span>${delta==null?"":(delta>2?`<b style="color:var(--danger)">${fmtMins(delta)} over</b>`:delta<-5?`<b style="color:var(--danger)">${fmtMins(delta)} short</b>`:`<b style="color:var(--ok)">fits</b>`)}</span>
      ${untimed?`<span style="color:var(--cue)">${untimed} untimed</span>`:""}
    </div>
    <div class="items" id="items"></div>
    ${canEdit?`
    <div class="add">
      <input class="in" id="addBox" placeholder="Artist – Title   (or paste a Spotify track link)">
      <button class="btn primary" id="addTrackBtn">Add track</button>
      <button class="btn" id="addCueBtn">Add cue</button>
    </div>
    <div class="hint">Paste several lines at once to add them all. Drag rows to reorder. A cue is a moment pinned to a clock time — everything else fills the space around it.</div>`:""}`;
  pane.appendChild(card);
  renderItems(seg);

  if(!canEdit)return;
  const nm=card.querySelector("#segName");
  nm.onchange=()=>{seg.name=nm.value.trim()||"Untitled";markDirty();renderSegs();};
  const st=card.querySelector("#segStart"), en=card.querySelector("#segEnd");
  st.onchange=()=>{if(toMin(st.value)==null){st.value=seg.start;return toast("Use HH:MM");}seg.start=st.value.trim();markDirty();renderAll();};
  en.onchange=()=>{if(toMin(en.value)==null){en.value=seg.end;return toast("Use HH:MM");}seg.end=en.value.trim();markDirty();renderAll();};
  card.querySelector("#delSegBtn").onclick=()=>{
    if(!confirm(`Delete “${seg.name}” and its ${seg.items.length} entries?`))return;
    state.segments=state.segments.filter(s=>s.id!==seg.id);
    selId=state.segments[0]?state.segments[0].id:null;markDirty();renderAll();
  };
  card.querySelector("#playlistBtn").onclick=()=>linkPlaylistDialog(seg);
  card.querySelector("#addTrackBtn").onclick=()=>addFromBox(seg,"track");
  card.querySelector("#addCueBtn").onclick=()=>addFromBox(seg,"cue");
  const box=card.querySelector("#addBox");
  box.onkeydown=e=>{if(e.key==="Enter")addFromBox(seg,e.shiftKey?"cue":"track");};
  box.focus();
}

function renderItems(seg){
  const box=document.getElementById("items");box.innerHTML="";
  if(!seg.items.length){box.innerHTML=`<div class="empty">Nothing here yet.${canEdit?" Add tracks below, or import an existing Spotify playlist.":""}</div>`;return;}
  // running clock: a cue with a time resets it, otherwise tracks accumulate
  let clock=toMin(seg.start);
  seg.items.forEach((it,idx)=>{
    if(it.kind==="cue"&&toMin(it.at)!=null)clock=toMin(it.at);
    const el=document.createElement("div");
    el.className="it"+(it.kind==="cue"?" cue":"");
    el.draggable=canEdit;el.dataset.idx=idx;
    const mark=it.uri?"linked":(it.matchTried?"unlinked":"guess");
    const glyph=it.uri?"●":(it.matchTried?"✕":"○");
    el.innerHTML=`
      <span class="h">⠿</span>
      <span class="at">${clock==null?"":fromMin(clock)}</span>
      <span class="star">${it.kind==="cue"?"★":""}</span>
      <span class="body">
        <span class="ti"></span>
        <span class="ar"></span>
      </span>
      <span class="dur">${it.durationMs?fmtDur(it.durationMs):""}</span>
      <span class="mark ${mark}" title="${it.uri?"matched on Spotify":it.matchTried?"no Spotify match":"not matched yet"}">${glyph}</span>
      ${canEdit?`<span class="tools">
        <button class="btn small" data-a="edit">Edit</button>
        <button class="btn small" data-a="del">✕</button>
      </span>`:""}`;
    const ti=el.querySelector(".ti");
    if(it.kind==="cue"&&it.cue){const s=document.createElement("span");s.className="cuename";s.textContent=it.cue;ti.appendChild(s);}
    ti.appendChild(document.createTextNode(it.title||"(untitled)"));
    el.querySelector(".ar").textContent=it.artist||"";
    if(canEdit){
      el.querySelector('[data-a="del"]').onclick=e=>{e.stopPropagation();seg.items.splice(idx,1);markDirty();renderAll();};
      el.querySelector('[data-a="edit"]').onclick=e=>{e.stopPropagation();editItem(seg,idx);};
      wireItemDrag(el,seg,idx);
    }
    box.appendChild(el);
    if(clock!=null&&it.durationMs)clock+=it.durationMs/60000;
  });
}

function renderTimeline(pane){
  const wrap=document.createElement("div");wrap.className="tl";
  if(!state.segments.length){wrap.innerHTML='<div class="card"><div class="empty">No segments yet.</div></div>';pane.appendChild(wrap);return;}
  for(const seg of state.segments){
    const cues=seg.items.filter(i=>i.kind==="cue");
    const bed=tracksOf(seg);
    const span=spanMin(seg), run=runtimeMs(seg)/60000, delta=span?run-span:null;
    const row=document.createElement("div");row.className="tl-seg";
    row.innerHTML=`
      <div class="tl-time">${esc(seg.start)} – ${esc(seg.end)}</div>
      <div class="tl-rail"><i></i></div>
      <div class="tl-body"><div class="tl-card">
        <h3><span class="nm"></span><span class="n">${bed.length} tracks · ${run?fmtMins(run):"0 min"}${delta!=null&&delta<-5?` · <span style="color:var(--danger)">${fmtMins(delta)} short</span>`:delta!=null&&delta>2?` · <span style="color:var(--danger)">${fmtMins(delta)} over</span>`:""}</span></h3>
        <div class="tl-cues"></div>
        <div class="tl-bed"></div>
      </div></div>`;
    row.querySelector(".nm").textContent=seg.name;
    const cbox=row.querySelector(".tl-cues");
    for(const c of cues){
      const d=document.createElement("div");d.className="tl-cue";
      d.innerHTML=`<span class="t">${esc(c.at||"")}</span><span class="l">${esc(c.cue||"cue")}</span><span class="s"></span>`;
      d.querySelector(".s").textContent=[c.title,c.artist].filter(Boolean).join(" · ");
      cbox.appendChild(d);
    }
    if(!cues.length)cbox.remove();
    const b=row.querySelector(".tl-bed");
    b.textContent=bed.length?"bed: "+bed.slice(0,3).map(t=>t.title).join(" · ")+(bed.length>3?" …":""):"no tracks yet";
    row.querySelector(".tl-card").onclick=()=>{selId=seg.id;view="seg";renderAll();};
    wrap.appendChild(row);
  }
  pane.appendChild(wrap);
}

/* ---------- adding & editing ---------- */
function parseLine(line){
  line=line.trim().replace(/^\d+[.)]\s*/,"");           // strip "1. " numbering
  const m=/spotify[:\/]+track[:\/]([A-Za-z0-9]+)/.exec(line);
  if(m)return {uri:"spotify:track:"+m[1],title:"(link)",artist:""};
  const parts=line.split(/\s+[–—-]\s+/);                 // en/em dash or hyphen with spaces
  if(parts.length>=2)return {artist:parts[0].trim(),title:parts.slice(1).join(" - ").trim()};
  return {title:line,artist:""};
}
function addFromBox(seg,kind){
  const box=document.getElementById("addBox");
  const lines=box.value.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length)return;
  for(const line of lines){
    const p=parseLine(line);
    seg.items.push({id:uid(),kind,title:p.title,artist:p.artist,uri:p.uri||null,durationMs:null,
      at:kind==="cue"?seg.start:null,cue:kind==="cue"?"cue":null,matchTried:false});
  }
  box.value="";markDirty();renderAll();
  if(lines.some(l=>!/spotify/.test(l)))document.getElementById("addBox").focus();
}
function editItem(seg,idx){
  const it=seg.items[idx];
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>Edit entry</h2>
    <p class="lead">${it.kind==="cue"?"A cue is pinned to a clock time.":"Part of the bed — plays in order."}</p>
    <div class="mrow"><label style="width:70px;color:var(--muted)">Artist</label><input class="in" id="eA" value="${esc(it.artist||"")}"></div>
    <div class="mrow"><label style="width:70px;color:var(--muted)">Title</label><input class="in" id="eT" value="${esc(it.title||"")}"></div>
    <div class="mrow"><label style="width:70px;color:var(--muted)">Type</label>
      <select class="in" id="eK"><option value="track"${it.kind!=="cue"?" selected":""}>Bed track</option><option value="cue"${it.kind==="cue"?" selected":""}>Cue</option></select></div>
    <div class="mrow" id="cueRow"><label style="width:70px;color:var(--muted)">Cue</label>
      <input class="in" id="eC" placeholder="Processional" value="${esc(it.cue||"")}" style="flex:2">
      <input class="tm" id="eAt" placeholder="HH:MM" value="${esc(it.at||"")}"></div>
    <div class="mrow"><label style="width:70px;color:var(--muted)">Spotify</label>
      <input class="in" id="eU" placeholder="not matched" value="${esc(it.uri||"")}"></div>
    <div class="mrow" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="eSave">Save</button></div>`);
  const kSel=document.getElementById("eK"), cueRow=document.getElementById("cueRow");
  const syncRow=()=>cueRow.style.display=kSel.value==="cue"?"":"none";
  kSel.onchange=syncRow;syncRow();
  document.getElementById("eSave").onclick=()=>{
    it.artist=document.getElementById("eA").value.trim();
    it.title=document.getElementById("eT").value.trim();
    it.kind=kSel.value;
    if(it.kind==="cue"){it.cue=document.getElementById("eC").value.trim()||"cue";
      const at=document.getElementById("eAt").value.trim();it.at=toMin(at)!=null?at:seg.start;}
    else{it.cue=null;it.at=null;}
    const u=document.getElementById("eU").value.trim();
    const m=/spotify[:\/]+track[:\/]([A-Za-z0-9]+)/.exec(u);
    it.uri=m?"spotify:track:"+m[1]:(u||null);
    closeModal();markDirty();renderAll();
  };
}

/* ---------- drag reorder ---------- */
let dragKind=null, dragFrom=null;
function wireSegDrag(el,idx){
  el.ondragstart=e=>{dragKind="seg";dragFrom=idx;el.classList.add("dragging");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain","");};
  el.ondragend=()=>{el.classList.remove("dragging");clearDropMarks();dragKind=null;};
  el.ondragover=e=>{if(dragKind!=="seg")return;e.preventDefault();clearDropMarks();el.classList.add("dropbefore");};
  el.ondrop=e=>{if(dragKind!=="seg")return;e.preventDefault();clearDropMarks();
    if(dragFrom===idx)return;
    const [m]=state.segments.splice(dragFrom,1);
    state.segments.splice(dragFrom<idx?idx-1:idx,0,m);
    markDirty();renderAll();};
}
function wireItemDrag(el,seg,idx){
  el.ondragstart=e=>{dragKind="item";dragFrom=idx;el.classList.add("dragging");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain","");};
  el.ondragend=()=>{el.classList.remove("dragging");clearDropMarks();dragKind=null;};
  el.ondragover=e=>{if(dragKind!=="item")return;e.preventDefault();clearDropMarks();el.classList.add("dropbefore");};
  el.ondrop=e=>{if(dragKind!=="item")return;e.preventDefault();clearDropMarks();
    if(dragFrom===idx)return;
    const [m]=seg.items.splice(dragFrom,1);
    seg.items.splice(dragFrom<idx?idx-1:idx,0,m);
    markDirty();renderAll();};
}
function clearDropMarks(){document.querySelectorAll(".dropbefore").forEach(e=>e.classList.remove("dropbefore"));}

/* ================================================================== *
 * Spotify — PKCE, no client secret, no backend. Unaffected by the
 * plan's own data moving to the backend: tokens and client ID stay in
 * this browser's localStorage, same as the standalone file.
 * ================================================================== */
function loadAuth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY));}catch(e){return null;}}
function saveAuth(a){auth=a;try{localStorage.setItem(AUTH_KEY,JSON.stringify(a));}catch(e){}}
function clientId(){return localStorage.getItem(CID_KEY)||"";}
function redirectUri(){return location.origin+location.pathname;}
function connected(){return !!(auth&&auth.refresh_token);}

function updateSpotUI(){
  const on=connected();
  document.getElementById("spotDot").classList.toggle("on",on);
  document.getElementById("spotWho").textContent=on?(me?me.display_name||me.id:"Connected"):"Not connected";
  document.getElementById("connectBtn").textContent=on?"Disconnect":"Connect Spotify";
  for(const id of ["importBtn","matchBtn","syncBtn"]){
    const el=document.getElementById(id);
    el.disabled=!on||!canEdit;
    el.style.display=canEdit?"":"none";
  }
  document.getElementById("connectBtn").style.display=canEdit?"":"none";
}

function b64url(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function sha256(s){return crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));}
function randStr(n){const a=new Uint8Array(n);crypto.getRandomValues(a);return b64url(a).slice(0,n);}

async function beginAuth(){
  const cid=clientId();
  if(!cid)return setupDialog();
  if(location.protocol==="file:")return setupDialog("Spotify won't redirect back to a <code>file://</code> page — serve this folder over <code>http://127.0.0.1</code> first (see below).");
  const verifier=randStr(96);
  sessionStorage.setItem("pkce_verifier",verifier);
  const challenge=b64url(await sha256(verifier));
  const u=new URL("https://accounts.spotify.com/authorize");
  u.search=new URLSearchParams({client_id:cid,response_type:"code",redirect_uri:redirectUri(),
    scope:SCOPES,code_challenge_method:"S256",code_challenge:challenge}).toString();
  location.href=u.toString();
}
async function completeAuth(){
  const p=new URLSearchParams(location.search);
  const code=p.get("code");
  if(p.get("error")){history.replaceState({},"",redirectUri());toast("Spotify auth cancelled");return;}
  if(!code)return;
  const verifier=sessionStorage.getItem("pkce_verifier");
  history.replaceState({},"",redirectUri());
  if(!verifier)return;
  try{
    const tok=await tokenReq({grant_type:"authorization_code",code,redirect_uri:redirectUri(),code_verifier:verifier});
    saveAuth({...tok,expires_at:Date.now()+tok.expires_in*1000});
    me=await spotifyApi("/me");
    toast("Connected as "+(me.display_name||me.id));
  }catch(e){toast("Auth failed: "+e.message);}
  updateSpotUI();
}
async function tokenReq(body){
  const r=await fetch("https://accounts.spotify.com/api/token",{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:clientId(),...body})});
  const j=await r.json();
  if(!r.ok)throw new Error(j.error_description||j.error||"token error");
  return j;
}
async function spotifyToken(){
  if(!auth)throw new Error("not connected");
  if(Date.now()<auth.expires_at-30000)return auth.access_token;
  const tok=await tokenReq({grant_type:"refresh_token",refresh_token:auth.refresh_token});
  saveAuth({...auth,...tok,expires_at:Date.now()+tok.expires_in*1000});
  return auth.access_token;
}
async function spotifyApi(path,opts){
  const t=await spotifyToken();
  const r=await fetch(path.startsWith("http")?path:"https://api.spotify.com/v1"+path,
    {...opts,headers:{Authorization:"Bearer "+t,"Content-Type":"application/json",...(opts&&opts.headers)}});
  if(r.status===429){                       // Spotify rate limit — wait it out once
    await new Promise(res=>setTimeout(res,(+r.headers.get("Retry-After")||2)*1000));
    return spotifyApi(path,opts);
  }
  if(r.status===204)return null;
  const j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error((j&&j.error&&j.error.message)||("HTTP "+r.status));
  return j;
}
function disconnect(){localStorage.removeItem(AUTH_KEY);auth=null;me=null;updateSpotUI();toast("Disconnected");}

/* ---------- import an existing playlist into a segment ---------- */
function playlistIdOf(s){const m=/playlist[:\/]([A-Za-z0-9]+)/.exec(s||"");return m?m[1]:((s||"").trim()||null);}
async function linkPlaylistDialog(seg){
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>Spotify playlist</h2>
    <p class="lead">Which playlist does “${esc(seg.name)}” sync to?</p>
    ${seg.playlistId?`<div class="warn">Linked to <b>${esc(seg.playlistName||seg.playlistId)}</b></div>`:""}
    <div class="mrow"><input class="in" id="plUrl" placeholder="Paste playlist link, or leave blank to create one on sync"
      value="${esc(seg.playlistId?"https://open.spotify.com/playlist/"+seg.playlistId:"")}"></div>
    <div class="mrow" style="justify-content:flex-end">
      ${seg.playlistId?'<button class="btn" id="plUnlink">Unlink</button>':""}
      <button class="btn" id="plPull" ${connected()?"":"disabled"}>Link &amp; pull tracks in</button>
      <button class="btn primary" id="plLink">Link only</button>
    </div>
    <div class="hint" style="padding:0">“Pull tracks in” replaces this segment's bed with the playlist's current contents — cues are kept.</div>`);
  const get=()=>playlistIdOf(document.getElementById("plUrl").value);
  document.getElementById("plLink").onclick=async()=>{
    seg.playlistId=get();seg.playlistName=null;
    if(seg.playlistId&&connected()){try{const p=await spotifyApi("/playlists/"+seg.playlistId+"?fields=name");seg.playlistName=p.name;}catch(e){}}
    closeModal();markDirty();renderAll();
  };
  const unl=document.getElementById("plUnlink");
  if(unl)unl.onclick=()=>{seg.playlistId=null;seg.playlistName=null;closeModal();markDirty();renderAll();};
  document.getElementById("plPull").onclick=async()=>{
    const id=get();if(!id)return toast("Paste a playlist link first");
    closeModal();await pullPlaylist(seg,id);
  };
}
async function pullPlaylist(seg,id){
  toast("Reading playlist…");
  try{
    const p=await spotifyApi("/playlists/"+id+"?fields=name");
    seg.playlistId=id;seg.playlistName=p.name;
    let url="/playlists/"+id+"/tracks?limit=100&fields=next,items(track(uri,name,duration_ms,artists(name)))";
    const got=[];
    while(url){const page=await spotifyApi(url);
      for(const row of page.items){const t=row.track;if(!t||!t.uri)continue;
        got.push({id:uid(),kind:"track",title:t.name,artist:(t.artists||[]).map(a=>a.name).join(", "),
          uri:t.uri,durationMs:t.duration_ms,at:null,cue:null,matchTried:true});}
      url=page.next;}
    const cues=seg.items.filter(i=>i.kind==="cue");
    seg.items=[...cues,...got];
    markDirty();renderAll();
    toast(`Pulled ${got.length} tracks from “${p.name}”`);
  }catch(e){toast("Import failed: "+e.message);}
}
async function importDialog(){
  if(!connected())return toast("Connect Spotify first");
  toast("Loading your playlists…");
  let items=[];
  try{
    let url="/me/playlists?limit=50";
    while(url&&items.length<200){const p=await spotifyApi(url);items.push(...p.items);url=p.next;}
  }catch(e){return toast("Could not list playlists: "+e.message);}
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>Import a playlist</h2>
    <p class="lead">Pick one of your Spotify playlists and the segment it belongs to.</p>
    <div class="mrow"><label style="width:76px;color:var(--muted)">Playlist</label>
      <select class="in" id="ipPl">${items.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${p.tracks.total} tracks</option>`).join("")}</select></div>
    <div class="mrow"><label style="width:76px;color:var(--muted)">Segment</label>
      <select class="in" id="ipSeg">${state.segments.map(s=>`<option value="${s.id}"${s.id===selId?" selected":""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="mrow" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ipGo">Import</button></div>`);
  document.getElementById("ipGo").onclick=()=>{
    const pid=document.getElementById("ipPl").value;
    const seg=segById(+document.getElementById("ipSeg").value);
    closeModal();selId=seg.id;view="seg";pullPlaylist(seg,pid);
  };
}

/* ---------- matching typed titles to real Spotify tracks ---------- */
function norm(s){return (s||"").toLowerCase().replace(/\(.*?\)|\[.*?\]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}
function score(item,tr){
  // crude but effective: token overlap on title, bonus for artist agreement
  const want=new Set(norm(item.title).split(" ").filter(Boolean));
  const got=new Set(norm(tr.name).split(" ").filter(Boolean));
  if(!want.size)return 0;
  let hit=0;for(const w of want)if(got.has(w))hit++;
  let s=hit/want.size;
  if(item.artist){
    const a=norm(item.artist), names=(tr.artists||[]).map(x=>norm(x.name));
    if(names.some(n=>n&&(a.includes(n)||n.includes(a))))s+=.35;
  }
  return Math.min(1,s);
}
async function matchAll(){
  if(!connected())return toast("Connect Spotify first");
  const todo=[];
  for(const seg of state.segments)for(const it of seg.items)if(!it.uri)todo.push({seg,it});
  if(!todo.length)return toast("Everything is already matched");
  const results=[];
  for(let i=0;i<todo.length;i++){
    const {it}=todo[i];
    toast(`Matching ${i+1}/${todo.length}…`);
    const q=[it.artist?`artist:${it.artist}`:"",`track:${it.title}`].filter(Boolean).join(" ");
    try{
      let r=await spotifyApi("/search?type=track&limit=5&q="+encodeURIComponent(q));
      let cands=(r.tracks&&r.tracks.items)||[];
      if(!cands.length){                                   // fielded query too strict — retry loose
        r=await spotifyApi("/search?type=track&limit=5&q="+encodeURIComponent([it.artist,it.title].filter(Boolean).join(" ")));
        cands=(r.tracks&&r.tracks.items)||[];
      }
      const best=cands.map(t=>({t,s:score(it,t)})).sort((a,b)=>b.s-a.s)[0];
      results.push({it,best:best&&best.s>=.45?best:null,all:cands});
    }catch(e){results.push({it,best:null,all:[],err:e.message});}
  }
  reviewMatches(results);
}
function reviewMatches(results){
  const rows=results.map((r,i)=>{
    const t=r.best&&r.best.t;
    const cls=!t?"bad":(r.best.s<.7?"weak":"");
    return `<tr class="${cls}">
      <td class="q">${esc([r.it.artist,r.it.title].filter(Boolean).join(" – "))}</td>
      <td class="r">${t?esc((t.artists||[]).map(a=>a.name).join(", ")+" – "+t.name):"<i>no match</i>"}</td>
      <td class="s">${t?Math.round(r.best.s*100)+"%":""} ${t?`<input type="checkbox" data-i="${i}" checked>`:""}</td>
    </tr>`;}).join("");
  const nMatched=results.filter(r=>r.best).length;
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>Match review</h2>
    <p class="lead">${nMatched} of ${results.length} found. Untick anything wrong — unticked entries stay unmatched and you can fix the spelling.</p>
    <table class="mtable">${rows}</table>
    <div class="mrow" style="justify-content:flex-end;margin-top:14px">
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="mvApply">Apply</button>
    </div>`);
  document.getElementById("mvApply").onclick=()=>{
    document.querySelectorAll(".mtable input[type=checkbox]").forEach(cb=>{
      const r=results[+cb.dataset.i];
      r.it.matchTried=true;
      if(!cb.checked||!r.best)return;
      const t=r.best.t;
      r.it.uri=t.uri;r.it.durationMs=t.duration_ms;
      r.it.title=t.name;r.it.artist=(t.artists||[]).map(a=>a.name).join(", ");
    });
    results.filter(r=>!r.best).forEach(r=>r.it.matchTried=true);
    closeModal();markDirty();renderAll();toast("Matches applied");
  };
}

/* ---------- push to Spotify ---------- */
async function syncAll(){
  if(!connected())return toast("Connect Spotify first");
  const unmatched=state.segments.reduce((n,s)=>n+s.items.filter(i=>!i.uri).length,0);
  if(unmatched&&!confirm(`${unmatched} entries have no Spotify track and will be skipped. Run “Match tracks” first?\n\nOK = sync anyway, Cancel = go back.`))return;
  if(!me){try{me=await spotifyApi("/me");}catch(e){return toast("Auth problem: "+e.message);}}
  let ok=0;
  for(const seg of state.segments){
    const uris=seg.items.filter(i=>i.uri).map(i=>i.uri);
    if(!uris.length)continue;
    toast(`Syncing ${seg.name}…`);
    try{
      if(!seg.playlistId){
        const p=await spotifyApi(`/users/${encodeURIComponent(me.id)}/playlists`,{method:"POST",
          body:JSON.stringify({name:seg.name,public:false,description:`${seg.start}–${seg.end} · built with the music plan`})});
        seg.playlistId=p.id;seg.playlistName=p.name;
      }
      // replace-then-append keeps the playlist an exact mirror of the plan
      await spotifyApi(`/playlists/${seg.playlistId}/tracks`,{method:"PUT",body:JSON.stringify({uris:uris.slice(0,100)})});
      for(let i=100;i<uris.length;i+=100)
        await spotifyApi(`/playlists/${seg.playlistId}/tracks`,{method:"POST",body:JSON.stringify({uris:uris.slice(i,i+100)})});
      ok++;
    }catch(e){toast(`${seg.name}: ${e.message}`);return;}
  }
  markDirty();renderAll();
  toast(`Synced ${ok} playlist${ok===1?"":"s"} to Spotify`);
}

/* ---------- text export (Spotlistr / TuneMyMusic fallback) ---------- */
function exportText(){
  const blocks=state.segments.map(seg=>{
    const head=`### ${seg.name}  (${seg.start}–${seg.end})`;
    const lines=seg.items.map(i=>{
      const base=[i.artist,i.title].filter(Boolean).join(" - ");
      return i.kind==="cue"?`${base}          # CUE ${i.cue||""} @ ${i.at||""}`.trimEnd():base;
    });
    return head+"\n"+lines.join("\n");
  }).join("\n\n");
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>Export</h2>
    <p class="lead">Paste a block into <b>spotlistr.com</b> (Text Search) or <b>tunemymusic.com</b> to build that playlist without the API. Drop the <code>###</code> header line — one block at a time.</p>
    <textarea id="exBox" readonly></textarea>
    <div class="mrow" style="justify-content:flex-end"><button class="btn" id="exCopy">Copy all</button><button class="btn primary" data-close>Done</button></div>`);
  document.getElementById("exBox").value=blocks;
  document.getElementById("exCopy").onclick=()=>{navigator.clipboard.writeText(blocks).then(()=>toast("Copied"),()=>toast("Copy failed — select manually"));};
}

/* ---------- setup / help ---------- */
function setupDialog(note){
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>Connect Spotify</h2>
    <p class="lead">One-time setup, about two minutes. No secret, no server code.</p>
    ${note?`<div class="warn">${note}</div>`:""}
    <h4>1 · Register an app</h4>
    <ol>
      <li>Open <b>developer.spotify.com/dashboard</b> and log in with your normal Spotify account.</li>
      <li><b>Create app</b> — any name and description.</li>
      <li>Redirect URI: paste exactly <code id="ruri">${esc(redirectUri())}</code></li>
      <li>API used: tick <b>Web API</b>. Save.</li>
      <li>Copy the <b>Client ID</b> from the app's settings.</li>
    </ol>
    <h4>2 · Paste it here</h4>
    <div class="mrow"><input class="in" id="cidBox" placeholder="Client ID" value="${esc(clientId())}"><button class="btn primary" id="cidGo">Save &amp; connect</button></div>`);
  document.getElementById("cidGo").onclick=()=>{
    const v=document.getElementById("cidBox").value.trim();
    if(!v)return toast("Paste the Client ID");
    localStorage.setItem(CID_KEY,v);closeModal();beginAuth();
  };
}
function helpDialog(){
  openModal(`
    <button class="x" data-close>✕</button>
    <h2>How this works</h2>
    <p class="lead">Segments down the left, contents on the right, Spotify on demand.</p>
    <h4>Planning</h4>
    <ul>
      <li><b>Segments</b> are the blocks of the day. Drag to reorder; edit the times in the header. The sidebar bar shows music runtime against slot length, and flags gaps or overlaps between blocks.</li>
      <li><b>Bed tracks</b> play in order and fill the slot. <b>Cues</b> (★) are pinned to a clock time — processional, first dance, cake — and reset the running clock beside each row.</li>
      <li>Paste multiple lines into the add box to bulk-add. <code>Artist – Title</code>, or a Spotify track link.</li>
      <li><b>Timeline</b> is the run-of-show view: every cue at its time, one page to hand to the DJ or the venue.</li>
    </ul>
    <h4>Spotify</h4>
    <ul>
      <li><b>Import playlist</b> pulls one of your existing playlists into a segment — real titles, artists and durations, so the runtime maths becomes accurate immediately.</li>
      <li><b>Match tracks</b> searches Spotify for anything you typed by hand and shows you a review table before applying. Anything under 70% confidence is flagged.</li>
      <li><b>Sync to Spotify</b> makes each segment's playlist an exact mirror of the plan — creating it if it doesn't exist yet, replacing its contents if it does. Safe to run repeatedly.</li>
      <li><b>Export text</b> is the no-API fallback: paste a block into spotlistr.com or tunemymusic.com.</li>
    </ul>
    <h4>Saving</h4>
    <ul>
      <li><b>Save</b> writes the plan to Drive, the same as every other page in this app. If someone else saved in the meantime you'll be asked to reload before you can save.</li>
      <li>Edits only leave your browser when you click Save — there's no autosave-per-keystroke.</li>
    </ul>`);
}

/* ---------- modal + misc ---------- */
function openModal(html){
  document.getElementById("modalBody").innerHTML=html;
  document.getElementById("modal").hidden=false;
  document.querySelectorAll("#modalBody [data-close]").forEach(b=>b.onclick=closeModal);
}
function closeModal(){document.getElementById("modal").hidden=true;document.getElementById("modalBody").innerHTML="";}
document.getElementById("modal").onclick=e=>{if(e.target.id==="modal")closeModal();};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
let toastT;function toast(m){const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2200);}

/* ---------- wiring ---------- */
document.getElementById("addSegBtn").onclick=()=>{
  const last=state.segments[state.segments.length-1];
  const start=last?last.end:"15:00";
  const seg={id:uid(),name:"New segment",start,end:fromMin(toMin(start)+60),playlistId:null,playlistName:null,items:[]};
  state.segments.push(seg);selId=seg.id;view="seg";markDirty();renderAll();
};
document.getElementById("viewSeg").onclick=()=>{view="seg";renderAll();};
document.getElementById("viewTl").onclick=()=>{view="tl";renderAll();};
document.getElementById("connectBtn").onclick=()=>connected()?disconnect():beginAuth();
document.getElementById("importBtn").onclick=importDialog;
document.getElementById("matchBtn").onclick=matchAll;
document.getElementById("syncBtn").onclick=syncAll;
document.getElementById("exportBtn").onclick=exportText;
document.getElementById("historyBtn").onclick=openHistory;
document.getElementById("saveBtn").onclick=saveToServer;
document.getElementById("helpBtn").onclick=helpDialog;
window.addEventListener("beforeunload",e=>{if(dirty){e.preventDefault();e.returnValue="";}});

const appEl=document.getElementById("app");
document.getElementById("sideToggle").addEventListener("click",()=>appEl.classList.toggle("side-open"));
document.getElementById("sideBackdrop").addEventListener("click",()=>appEl.classList.remove("side-open"));
window.addEventListener("keydown",e=>{if(e.key==="Escape")appEl.classList.remove("side-open");});

async function init(){
  await loadSession();
  await loadData();
  canEdit=!!(session&&session.role==="editor");
  document.getElementById("addSegBtn").style.display=canEdit?"":"none";
  selId=state.segments[0]?state.segments[0].id:null;
  renderAll();
  await completeAuth();
  if(connected()&&!me){try{me=await spotifyApi("/me");}catch(e){}updateSpotUI();}
}

fetch("/api/config").then(r=>r.json()).then(config=>{
  document.title="Music Plan"+(config.venueName?" · "+config.venueName:"");
  document.getElementById("subTitle").textContent=config.venueName||"";
}).catch(()=>{});

init();
