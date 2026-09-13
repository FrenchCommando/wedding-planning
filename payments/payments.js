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

const STATUSES=["Pending","Done"];
// Within this many days of the due date a pending row is tinted "soon".
const SOON_DAYS=14;

let data=null, revisionId=null, editing=false, session=null;

async function loadSession(){
  const res=await api("/whoami");
  const body=await res.json();
  session=body.session;
}

async function loadData(){
  let res=await api("/payments");
  if(res.status===403){
    await promptForLogin();
    await loadSession();
    res=await api("/payments");
  }
  if(!res.ok)throw new Error("failed to load payments");
  const body=await res.json();
  data=body.data;
  revisionId=body.revisionId;
  data.items=data.items||[];
}

function isDone(it){return it.status==="Done";}
function money(n){
  const v=Number(n)||0;
  try{return v.toLocaleString(undefined,{style:"currency",currency:data.currency||"EUR",maximumFractionDigits:0});}
  catch{return `${v} ${data.currency||""}`.trim();}
}
// Dates are ISO strings; compared by day, in the browser's local time.
function today(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function parseDay(s){if(!s)return null;const d=new Date(s+"T00:00:00");return isNaN(d)?null:d;}
function daysUntil(s){const d=parseDay(s);if(!d)return null;return Math.round((d-today())/86400000);}
function fmtDay(s){const d=parseDay(s);if(!d)return "";return d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});}
function dueLabel(s){
  const n=daysUntil(s);
  if(n===null)return "no date";
  if(n<0)return `${fmtDay(s)} · ${-n} day${n===-1?"":"s"} overdue`;
  if(n===0)return `${fmtDay(s)} · today`;
  return `${fmtDay(s)} · in ${n} day${n===1?"":"s"}`;
}
function urgency(it){
  const n=daysUntil(it.dueDate);
  if(n===null)return "";
  if(n<0)return "late";
  if(n<=SOON_DAYS)return "soon";
  return "";
}

function renderSummary(){
  const box=document.getElementById("summary");
  const pending=data.items.filter(it=>!isDone(it));
  const done=data.items.filter(isDone);
  const sum=list=>list.reduce((n,it)=>n+(Number(it.amount)||0),0);
  const dated=pending.filter(it=>parseDay(it.dueDate)).sort((a,b)=>a.dueDate<b.dueDate?-1:1);
  const next=dated[0];
  const late=pending.filter(it=>urgency(it)==="late").length;
  box.innerHTML=`
    <div class="stat"><div class="n">${money(sum(done))}</div><div class="l">paid</div></div>
    <div class="stat"><div class="n">${money(sum(pending))}</div><div class="l">still to pay</div></div>
    <div class="stat${late?" late":""}"><div class="n">${late?`${late} overdue`:next?fmtDay(next.dueDate):"—"}</div><div class="l">${late?"needs attention":next?"next due · "+esc(next.vendor):"nothing due"}</div></div>`;
}

// A row's emoji is typed on the row (the vendor's trade: 🏰 venue, 🍽️
// caterer, 📷 photographer…); blank falls back to a receipt.
const DEFAULT_EMOJI="🧾";
function emojiFor(it){return it.emoji||DEFAULT_EMOJI;}

function payRow(it){
  const done=isDone(it);
  const cls=done?"done":urgency(it);
  const date=done?(it.paidDate?`paid ${fmtDay(it.paidDate)}`:"paid"):dueLabel(it.dueDate);
  const meta=[it.payer?`paid by ${it.payer}`:"",it.method,it.notes].filter(Boolean).join(" · ");
  return `
    <div class="payRow ${cls}">
      <div class="icon">${esc(emojiFor(it))}</div>
      <div><span class="vendor">${esc(it.vendor)||"(no vendor)"}</span>${it.description?` <span class="desc">${esc(it.description)}</span>`:""}</div>
      <div class="date">${esc(date)}</div>
      <div class="amount">${money(it.amount)}</div>
      ${meta?`<div class="meta">${esc(meta)}</div>`:""}
    </div>`;
}

function renderView(){
  renderSummary();
  document.getElementById("currencyEdit").innerHTML="";
  // Pending soonest first, undated last; Done most recently paid first.
  const pending=data.items.filter(it=>!isDone(it)).sort((a,b)=>(a.dueDate||"9999")<(b.dueDate||"9999")?-1:1);
  const done=data.items.filter(isDone).sort((a,b)=>(a.paidDate||"")<(b.paidDate||"")?1:-1);
  const sum=list=>list.reduce((n,it)=>n+(Number(it.amount)||0),0);
  document.getElementById("pendingCount").textContent=pending.length?`${pending.length} payment${pending.length===1?"":"s"} · ${money(sum(pending))}`:"";
  document.getElementById("pendingBox").innerHTML=pending.length?pending.map(payRow).join(""):'<p class="empty">Nothing left to pay.</p>';
  document.getElementById("doneCount").textContent=done.length?`${done.length} payment${done.length===1?"":"s"} · ${money(sum(done))}`:"";
  document.getElementById("doneBox").innerHTML=done.length?done.map(payRow).join(""):'<p class="empty">Nothing paid yet.</p>';
  document.getElementById("addBar").style.display="none";
}

function renderEdit(){
  renderSummary();
  document.getElementById("currencyEdit").innerHTML=`
    <div class="editRow">
      <label class="f">Currency <input id="currency" value="${esc(data.currency||"EUR")}" style="max-width:80px" placeholder="EUR"></label>
    </div>`;
  document.getElementById("currency").addEventListener("input",e=>{data.currency=e.target.value.trim().toUpperCase();renderSummary();});

  // Rows carry their index into data.items, whichever section they land in.
  const editRow=(it,i)=>`
    <div class="editRow" data-i="${i}">
      <input class="emoji-input" data-field="emoji" value="${esc(it.emoji||"")}" placeholder="${DEFAULT_EMOJI}" title="Emoji for the row; blank shows a receipt">
      <input class="vendor-input" data-field="vendor" value="${esc(it.vendor)}" placeholder="Vendor">
      <input class="desc-input" data-field="description" value="${esc(it.description||"")}" placeholder="What for (deposit, balance, invoice #)">
      <input class="num-input" data-field="amount" type="number" min="0" step="0.01" value="${it.amount??""}" placeholder="Amount">
      <select data-field="status">${STATUSES.map(s=>`<option${(it.status||"Pending")===s?" selected":""}>${s}</option>`).join("")}</select>
      <button class="danger" data-action="remove">×</button>
      <div class="more">
        <label class="f">Due <input class="date-input" data-field="dueDate" type="date" value="${esc(it.dueDate||"")}"></label>
        <label class="f">Paid <input class="date-input" data-field="paidDate" type="date" value="${esc(it.paidDate||"")}"></label>
        <input data-field="payer" value="${esc(it.payer||"")}" placeholder="Paid by" style="max-width:160px">
        <input data-field="method" value="${esc(it.method||"")}" placeholder="Method (transfer, card, cash)" style="max-width:200px">
        <input data-field="notes" value="${esc(it.notes||"")}" placeholder="Notes">
      </div>
    </div>`;
  const indexed=data.items.map((it,i)=>[it,i]);
  document.getElementById("pendingCount").textContent="";
  document.getElementById("doneCount").textContent="";
  document.getElementById("pendingBox").innerHTML=indexed.filter(([it])=>!isDone(it)).map(([it,i])=>editRow(it,i)).join("");
  document.getElementById("doneBox").innerHTML=indexed.filter(([it])=>isDone(it)).map(([it,i])=>editRow(it,i)).join("");
  document.querySelectorAll("#pendingBox .editRow, #doneBox .editRow").forEach(row=>{
    const i=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      const apply=()=>{
        const f=inp.dataset.field;
        data.items[i][f]=inp.type==="number"?(inp.value===""?undefined:Number(inp.value)):inp.value;
        // Marking a row Done with no paid date stamps today; the status
        // decides which section the row lives in, so re-render.
        if(f==="status"){
          if(inp.value==="Done"&&!data.items[i].paidDate)data.items[i].paidDate=today().toISOString().slice(0,10);
          renderEdit();return;
        }
        renderSummary();
      };
      inp.addEventListener("input",apply);
      inp.addEventListener("change",apply);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click",()=>{
      data.items.splice(i,1);renderEdit();
    });
  });
  document.getElementById("addBar").style.display="block";
}

async function save(keepForever){
  const res=await api("/payments",{method:"PUT",body:JSON.stringify({data,revisionId,keepForever})});
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
  const res=await api("/payments/revisions");
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
  const res=await api(`/payments/revisions/${encodeURIComponent(id)}/diff`);
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
    document.getElementById("historyBtn").style.display="inline";
  }
  document.getElementById("editToggle").addEventListener("click",async e=>{
    if(!editing){
      editing=true;
      document.getElementById("editToggle").textContent="Save";
      renderEdit();
    }else{
      // Shift+click pins the save as a milestone ("all paid before the
      // day"), same gesture as the seating chart.
      await save(e.shiftKey);
    }
  });
  document.getElementById("addItem").addEventListener("click",()=>{
    data.items.push({id:(data.nextId||1),vendor:"",emoji:"",description:"",status:"Pending",dueDate:"",payer:"",method:"",notes:""});
    data.nextId=(data.nextId||1)+1;
    renderEdit();
    const rows=document.querySelectorAll("#pendingBox .editRow");
    rows[rows.length-1].querySelector(".vendor-input").focus();
  });
  document.getElementById("historyBtn").addEventListener("click",openHistory);
  const historyOverlay=document.getElementById("history");
  document.getElementById("historyClose").addEventListener("click",()=>{historyOverlay.hidden=true;});
  historyOverlay.addEventListener("click",e=>{if(e.target.id==="history")historyOverlay.hidden=true;});
  window.addEventListener("keydown",e=>{if(e.key==="Escape")historyOverlay.hidden=true;});
  const roleTag=document.getElementById("roleTag");
  if(session)roleTag.textContent=session.role;
}

async function loadConfig(){
  const config=await (await fetch("/api/config")).json();
  document.title="Payments"+(config.venueName?" · "+config.venueName:"");
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
