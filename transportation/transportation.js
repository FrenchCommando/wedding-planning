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

// Two legs, each its own headcount and its own set of departures. A rider
// answered the two questions separately on the RSVP form, so the page keeps
// them separate too — the numbers differ (a few sleep at the venue).
const LEGS=[
  {key:"toVenue",label:"To the venue"},
  {key:"back",label:"Back"},
];

let data=null, revisionId=null, editing=false, session=null;

async function loadSession(){
  const res=await api("/whoami");
  const body=await res.json();
  session=body.session;
}

async function loadData(){
  let res=await api("/transportation");
  if(res.status===403){
    await promptForLogin();
    await loadSession();
    res=await api("/transportation");
  }
  if(!res.ok)throw new Error("failed to load transportation data");
  const body=await res.json();
  data=body.data;
  revisionId=body.revisionId;
  data.shuttles=data.shuttles||[];
  // The server leaves `riders` off entirely for the guest role — the
  // timetable is theirs to see, the passenger list is not.
  if(!data.riders)document.getElementById("riderSection").hidden=true;
}

// Named riders on a leg plus the unnamed headcount, which is assumed to
// ride both ways — it's a group, and a group on a coach comes back on it.
function riding(leg){return (data.riders||[]).filter(r=>r[leg]).length+(Number(data.extraCount)||0);}
function capacity(leg){return data.shuttles.filter(s=>s.direction===leg).reduce((n,s)=>n+(Number(s.capacity)||0),0);}

function shuttleRow(s){
  const route=[s.from,s.to].filter(Boolean).join(" → ");
  const cap=Number(s.capacity)?`<span class="cap">${esc(String(s.capacity))} seats</span>`:"";
  return `
    <div class="shuttleRow">
      <div class="time">${esc(s.time)}</div>
      <div>
        <div class="route">${esc(route)||"(no route)"}${cap}</div>
        ${s.notes?`<div class="desc">${esc(s.notes)}</div>`:""}
      </div>
    </div>`;
}
function renderView(){
  const box=document.getElementById("shuttleBox");
  if(!data.shuttles.length){box.innerHTML='<p class="empty">No shuttles scheduled yet.</p>';}
  else{
    // Grouped by leg, unassigned departures last. The heading carries the
    // seat count against the demand when the rider list is available.
    box.innerHTML=LEGS.concat([{key:undefined,label:"Other"}]).map(l=>{
      const rows=data.shuttles.filter(s=>(s.direction||undefined)===l.key);
      if(!rows.length)return "";
      let head=l.label;
      if(l.key&&data.riders){
        const need=riding(l.key), seats=capacity(l.key);
        head+=` · ${seats} seats for ${need}`+(seats<need?` <span class="over">(${need-seats} short)</span>`:"");
      }
      return `<div class="legHead">${head}</div>`+rows.map(shuttleRow).join("");
    }).join("");
  }
  document.getElementById("shuttleCount").textContent=`${data.shuttles.length} departure${data.shuttles.length===1?"":"s"}`;

  if(!data.riders)return;
  const riders=document.getElementById("riderBox");
  document.getElementById("riderCount").textContent=`${riding("toVenue")} to the venue · ${riding("back")} back`;
  const extra=Number(data.extraCount)||0;
  const extraRow=extra?`
      <div class="riderRow">
        <span class="name">+${extra} more</span>
        <span class="notes">${esc(data.extraCountNote||"headcount only, names not collected")}</span>
      </div>`:"";
  if(!data.riders.length&&!extra){riders.innerHTML='<p class="empty">No one on the list yet.</p>';}
  else{
    riders.innerHTML=data.riders.map(r=>`
      <div class="riderRow">
        <span class="name">${esc(r.name)}</span>
        ${r.household?`<span class="household">${esc(r.household)}</span>`:""}
        ${LEGS.map(l=>`<span class="leg${r[l.key]?" on":""}">${l.label}</span>`).join("")}
        ${r.notes?`<span class="notes">${esc(r.notes)}</span>`:""}
      </div>
    `).join("")+extraRow;
  }

  document.getElementById("addBar").style.display="none";
}

function renderEdit(){
  const box=document.getElementById("shuttleBox");
  box.innerHTML=data.shuttles.map((s,i)=>`
    <div class="editRow" data-i="${i}">
      <input class="time-input" data-field="time" value="${esc(s.time)}" placeholder="Time">
      <select data-field="direction">
        <option value=""${s.direction?"":" selected"}>Leg…</option>
        ${LEGS.map(l=>`<option value="${l.key}"${s.direction===l.key?" selected":""}>${l.label}</option>`).join("")}
      </select>
      <input data-field="from" value="${esc(s.from||"")}" placeholder="From">
      <input data-field="to" value="${esc(s.to||"")}" placeholder="To">
      <input class="num-input" data-field="capacity" type="number" min="0" value="${s.capacity??""}" placeholder="Seats">
      <textarea data-field="notes" placeholder="Notes (pickup point, driver, …)">${esc(s.notes||"")}</textarea>
      <button class="danger" data-action="remove">×</button>
    </div>
  `).join("");
  box.querySelectorAll(".editRow").forEach(row=>{
    const i=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      const apply=()=>{
        const f=inp.dataset.field;
        data.shuttles[i][f]=inp.type==="number"?(inp.value===""?undefined:Number(inp.value))
          :f==="direction"?(inp.value||undefined)
          :inp.value;
      };
      inp.addEventListener("input",apply);
      inp.addEventListener("change",apply);
    });
    row.querySelector('[data-action="remove"]').addEventListener("click",()=>{
      data.shuttles.splice(i,1);renderEdit();
    });
  });

  const riders=document.getElementById("riderBox");
  const refreshCount=()=>{document.getElementById("riderCount").textContent=`${riding("toVenue")} to the venue · ${riding("back")} back`;};
  refreshCount();
  riders.innerHTML=data.riders.map((r,i)=>`
    <div class="editRow" data-i="${i}">
      <input data-field="name" value="${esc(r.name)}" placeholder="Name">
      <input data-field="household" value="${esc(r.household||"")}" placeholder="Household">
      ${LEGS.map(l=>`<label class="check"><input type="checkbox" data-field="${l.key}"${r[l.key]?" checked":""}>${l.label}</label>`).join("")}
      <input data-field="notes" value="${esc(r.notes||"")}" placeholder="Notes">
      <button class="danger" data-action="removeR">×</button>
    </div>
  `).join("");
  riders.querySelectorAll(".editRow").forEach(row=>{
    const i=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      const apply=()=>{
        if(inp.type==="checkbox"){data.riders[i][inp.dataset.field]=inp.checked;refreshCount();}
        else data.riders[i][inp.dataset.field]=inp.value;
      };
      inp.addEventListener("input",apply);
      inp.addEventListener("change",apply);
    });
    row.querySelector('[data-action="removeR"]').addEventListener("click",()=>{
      data.riders.splice(i,1);renderEdit();
    });
  });

  riders.insertAdjacentHTML("beforeend",`
    <div class="editRow" id="extraRow">
      <input id="extraCount" type="number" min="0" value="${Number(data.extraCount)||0}" placeholder="Extra headcount">
      <input id="extraCountNote" value="${esc(data.extraCountNote||"")}" placeholder="What that count covers">
    </div>
  `);
  document.getElementById("extraCount").addEventListener("input",e=>{
    data.extraCount=Number(e.target.value)||0;
    refreshCount();
  });
  document.getElementById("extraCountNote").addEventListener("input",e=>{data.extraCountNote=e.target.value;});

  document.getElementById("addBar").style.display="flex";
}

async function save(){
  const res=await api("/transportation",{method:"PUT",body:JSON.stringify({data,revisionId})});
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
  const res=await api("/transportation/revisions");
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
  const res=await api(`/transportation/revisions/${encodeURIComponent(id)}/diff`);
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
  // History diffs name riders, so like the rider list it stays off the
  // guest's page.
  if(session && session.role!=="guest"){
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
  document.getElementById("addShuttle").addEventListener("click",()=>{
    data.shuttles.push({id:(data.nextId||1),time:"",direction:"toVenue",from:"",to:"",notes:""});
    data.nextId=(data.nextId||1)+1;
    renderEdit();
  });
  document.getElementById("addRider").addEventListener("click",()=>{
    data.riders.push({id:(data.nextId||1),name:"",household:"",toVenue:true,back:true,notes:""});
    data.nextId=(data.nextId||1)+1;
    renderEdit();
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
  document.title="Transportation"+(config.venueName?" · "+config.venueName:"");
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
