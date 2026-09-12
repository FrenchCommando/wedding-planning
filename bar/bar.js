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

// Groups the tiles on the page, in pouring order, each with the emoji a
// tile shows unless the row carries its own.
const CATEGORY_EMOJI={
  "Champagne & sparkling":"🍾","White wine":"🥂","Rosé":"🌸","Red wine":"🍷",
  "Beer":"🍺","Spirits":"🥃","Soft drinks & mixers":"🥤","Other":"🧊",
};
const CATEGORIES=Object.keys(CATEGORY_EMOJI);
function emojiFor(it){return it.emoji||CATEGORY_EMOJI[it.category]||CATEGORY_EMOJI.Other;}
// Considering is the default; only the last three count as "in the order".
const STATUSES=["Considering","Shortlisted","Chosen","Ordered","Delivered","Dropped"];
const COUNTED=new Set(["Chosen","Ordered","Delivered"]);

let data=null, revisionId=null, editing=false, session=null;

async function loadSession(){
  const res=await api("/whoami");
  const body=await res.json();
  session=body.session;
}

async function loadData(){
  let res=await api("/bar");
  if(res.status===403){
    await promptForLogin();
    await loadSession();
    res=await api("/bar");
  }
  if(!res.ok)throw new Error("failed to load bar data");
  const body=await res.json();
  data=body.data;
  revisionId=body.revisionId;
  data.items=data.items||[];
}

function counted(it){return COUNTED.has(it.status);}
// Suggested units from the headcount: guests × glasses each ÷ glasses per
// unit, rounded up. Null when any input is missing, so nothing is shown.
function suggested(it){
  const g=Number(data.guestCount)||0, per=Number(it.perGuest)||0, spu=Number(it.servingsPerUnit)||0;
  if(!g||!per||!spu)return null;
  return Math.ceil(g*per/spu);
}

function renderDelivery(){
  const box=document.getElementById("delivery");
  if(!data.deliveryTime&&!data.deliveryNote){box.innerHTML="";return;}
  box.innerHTML=`🚚 Delivery ${esc(data.deliveryTime||"")}`+
    (data.deliveryNote?`<span class="note">${esc(data.deliveryNote)}</span>`:"");
}

function renderSummary(){
  const box=document.getElementById("summary");
  const inOrder=data.items.filter(counted);
  const units=inOrder.reduce((n,it)=>n+(Number(it.quantity)||0),0);
  const g=Number(data.guestCount)||0;
  box.innerHTML=`${g||"?"} drinking · ${inOrder.length} chosen · ${units} bottles in the order`+
    (data.guestCountNote?`<span class="note">${esc(data.guestCountNote)}</span>`:"");
}

// A tile: emoji, name, when it's poured, and the quantity as a badge. The
// hover title carries the rest (status, supplier, notes, suggested
// quantity) so it's there without cluttering the wall. The badge goes red
// when the typed quantity is under the headcount estimate.
function tile(it){
  const sugg=suggested(it);
  const q=Number(it.quantity)||0;
  const short=sugg!=null&&q<sugg;
  const title=[it.status||"Considering",it.supplier,sugg!=null?`≈ ${sugg} suggested`:"",it.notes].filter(Boolean).join("\n");
  const cls=(it.status||"Considering").toLowerCase();
  const unit=it.unit&&!/bottle/i.test(it.unit)?" "+esc(it.unit):"";
  return `
    <div class="tile ${esc(cls)}" title="${esc(title)}">
      ${q?`<span class="qty${short?" short":""}">${q}${unit}</span>`:""}
      <div class="emoji">${esc(emojiFor(it))}</div>
      <div class="name">${esc(it.name)||"(unnamed)"}</div>
      ${it.moment?`<div class="when">${esc(it.moment)}</div>`:""}
    </div>`;
}

function renderView(){
  renderDelivery();
  renderSummary();
  document.getElementById("headcountEdit").innerHTML="";
  const box=document.getElementById("itemBox");
  if(!data.items.length){box.innerHTML='<p class="empty">Nothing on the list yet.</p>';}
  else{
    // Grouped by category in pouring order; a category that isn't in the
    // list (older data, a typo) lands under Other rather than vanishing.
    box.innerHTML='<div class="board">'+CATEGORIES.map(cat=>{
      const rows=data.items.filter(it=>(CATEGORIES.includes(it.category)?it.category:"Other")===cat);
      if(!rows.length)return "";
      return `<div class="section"><h2>${esc(cat)}</h2><div class="tiles">${rows.map(tile).join("")}</div></div>`;
    }).join("")+'</div>';
  }
  document.getElementById("addBar").style.display="none";
}

function renderEdit(){
  renderDelivery();
  renderSummary();
  document.getElementById("headcountEdit").innerHTML=`
    <div class="editRow">
      <label class="f">🚚 Delivery <input id="deliveryTime" value="${esc(data.deliveryTime||"")}" placeholder="10 AM" style="max-width:110px"></label>
      <input id="deliveryNote" value="${esc(data.deliveryNote||"")}" placeholder="Where, who receives it" style="max-width:360px">
    </div>
    <div class="editRow">
      <label class="f">Drinking headcount <input class="num-input" id="guestCount" type="number" min="0" value="${Number(data.guestCount)||0}"></label>
      <input id="guestCountNote" value="${esc(data.guestCountNote||"")}" placeholder="How that number was arrived at" style="max-width:360px">
    </div>`;
  document.getElementById("deliveryTime").addEventListener("input",e=>{data.deliveryTime=e.target.value;renderDelivery();});
  document.getElementById("deliveryNote").addEventListener("input",e=>{data.deliveryNote=e.target.value;renderDelivery();});
  document.getElementById("guestCount").addEventListener("input",e=>{data.guestCount=Number(e.target.value)||0;renderSummary();});
  document.getElementById("guestCountNote").addEventListener("input",e=>{data.guestCountNote=e.target.value;renderSummary();});

  const box=document.getElementById("itemBox");
  box.innerHTML=data.items.map((it,i)=>`
    <div class="editRow" data-i="${i}">
      <input class="emoji-input" data-field="emoji" value="${esc(it.emoji||"")}" placeholder="${esc(CATEGORY_EMOJI[it.category]||CATEGORY_EMOJI.Other)}" title="Emoji for the tile; blank uses the category's">
      <input class="name-input" data-field="name" value="${esc(it.name)}" placeholder="Name">
      <select data-field="category">${CATEGORIES.map(c=>`<option${it.category===c?" selected":""}>${c}</option>`).join("")}</select>
      <select data-field="status">${STATUSES.map(s=>`<option${(it.status||"Considering")===s?" selected":""}>${s}</option>`).join("")}</select>
      <label class="f">Qty <input class="num-input" data-field="quantity" type="number" min="0" value="${it.quantity??""}"></label>
      <button class="danger" data-action="remove">×</button>
      <div class="more">
        <input data-field="moment" value="${esc(it.moment||"")}" placeholder="When (cocktail hour, dinner, party)">
        <input data-field="unit" value="${esc(it.unit||"")}" placeholder="Unit (bottle, keg, case)" style="max-width:150px">
        <input data-field="supplier" value="${esc(it.supplier||"")}" placeholder="Supplier" style="max-width:150px">
        <label class="f">Glasses/unit <input class="num-input" data-field="servingsPerUnit" type="number" min="0" step="0.5" value="${it.servingsPerUnit??""}"></label>
        <label class="f">Glasses/guest <input class="num-input" data-field="perGuest" type="number" min="0" step="0.1" value="${it.perGuest??""}"></label>
        <input data-field="notes" value="${esc(it.notes||"")}" placeholder="Notes">
      </div>
    </div>
  `).join("");
  box.querySelectorAll(".editRow").forEach(row=>{
    const i=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      const apply=()=>{
        const f=inp.dataset.field;
        data.items[i][f]=inp.type==="number"?(inp.value===""?undefined:Number(inp.value)):inp.value;
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
  const res=await api("/bar",{method:"PUT",body:JSON.stringify({data,revisionId,keepForever})});
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
  const res=await api("/bar/revisions");
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
  const res=await api(`/bar/revisions/${encodeURIComponent(id)}/diff`);
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
  document.getElementById("historyBtn").style.display="inline";
  document.getElementById("editToggle").addEventListener("click",async e=>{
    if(!editing){
      editing=true;
      document.getElementById("editToggle").textContent="Save";
      renderEdit();
    }else{
      // Shift+click pins the save as a milestone ("the order as sent to the
      // supplier"), same gesture as the seating chart.
      await save(e.shiftKey);
    }
  });
  document.getElementById("addItem").addEventListener("click",()=>{
    data.items.push({id:(data.nextId||1),name:"",category:CATEGORIES[0],status:"Considering"});
    data.nextId=(data.nextId||1)+1;
    renderEdit();
    const rows=document.querySelectorAll("#itemBox .editRow");
    rows[rows.length-1].querySelector(".name-input").focus();
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
  document.title="Bar"+(config.venueName?" · "+config.venueName:"");
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
