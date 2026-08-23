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

let data=null, revisionId=null, editing=false, session=null;

async function loadSession(){
  const res=await api("/whoami");
  const body=await res.json();
  session=body.session;
}

async function loadData(){
  let res=await api("/sunday-brunch");
  if(res.status===403){
    await promptForLogin();
    await loadSession();
    res=await api("/sunday-brunch");
  }
  if(!res.ok)throw new Error("failed to load sunday brunch data");
  const body=await res.json();
  data=body.data;
  revisionId=body.revisionId;
}

function renderView(){
  const sched=document.getElementById("schedBox");
  if(!data.schedule.length){sched.innerHTML='<p class="empty">No schedule yet.</p>';}
  else{
    sched.innerHTML=data.schedule.map(m=>`
      <div class="schedRow">
        <div class="time">${esc(m.time)}</div>
        <div>
          <div class="title">${esc(m.title)}</div>
          ${m.description?`<div class="desc">${esc(m.description)}</div>`:""}
        </div>
      </div>
    `).join("");
  }

  const guests=document.getElementById("guestBox");
  document.getElementById("guestCount").textContent=`${data.guests.length} attending`;
  if(!data.guests.length){guests.innerHTML='<p class="empty">No one on the list yet.</p>';}
  else{
    guests.innerHTML=data.guests.map(g=>`
      <div class="guestRow">
        <span class="name">${esc(g.name)}</span>
        ${g.household?`<span class="household">${esc(g.household)}</span>`:""}
        ${g.dietary?`<span class="dietary">${esc(g.dietary)}</span>`:""}
        ${g.notes?`<span class="notes">${esc(g.notes)}</span>`:""}
      </div>
    `).join("");
  }

  document.getElementById("addBar").style.display="none";
}

function renderEdit(){
  const sched=document.getElementById("schedBox");
  sched.innerHTML=data.schedule.map((m,i)=>`
    <div class="editRow" data-i="${i}">
      <input class="time-input" data-field="time" value="${esc(m.time)}" placeholder="Time">
      <input data-field="title" value="${esc(m.title)}" placeholder="Title">
      <textarea data-field="description" placeholder="Description">${esc(m.description||"")}</textarea>
      <button class="danger" data-action="remove">×</button>
    </div>
  `).join("");
  sched.querySelectorAll(".editRow").forEach(row=>{
    const i=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("input",()=>{data.schedule[i][inp.dataset.field]=inp.value;});
    });
    row.querySelector('[data-action="remove"]').addEventListener("click",()=>{
      data.schedule.splice(i,1);renderEdit();
    });
  });

  const guests=document.getElementById("guestBox");
  document.getElementById("guestCount").textContent=`${data.guests.length} attending`;
  guests.innerHTML=data.guests.map((g,i)=>`
    <div class="editRow" data-i="${i}">
      <input data-field="name" value="${esc(g.name)}" placeholder="Name">
      <input data-field="household" value="${esc(g.household||"")}" placeholder="Household">
      <input data-field="dietary" value="${esc(g.dietary||"")}" placeholder="Dietary">
      <input data-field="notes" value="${esc(g.notes||"")}" placeholder="Notes">
      <button class="danger" data-action="removeG">×</button>
    </div>
  `).join("");
  guests.querySelectorAll(".editRow").forEach(row=>{
    const i=Number(row.dataset.i);
    row.querySelectorAll("[data-field]").forEach(inp=>{
      inp.addEventListener("input",()=>{data.guests[i][inp.dataset.field]=inp.value;});
    });
    row.querySelector('[data-action="removeG"]').addEventListener("click",()=>{
      data.guests.splice(i,1);renderEdit();
    });
  });

  document.getElementById("addBar").style.display="flex";
}

async function save(){
  const res=await api("/sunday-brunch",{method:"PUT",body:JSON.stringify({data,revisionId})});
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
  const res=await api("/sunday-brunch/revisions");
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
  const res=await api(`/sunday-brunch/revisions/${encodeURIComponent(id)}/diff`);
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
  document.getElementById("addSched").addEventListener("click",()=>{
    data.schedule.push({id:(data.nextId||1),time:"",title:"New item",description:""});
    data.nextId=(data.nextId||1)+1;
    renderEdit();
  });
  document.getElementById("addGuest").addEventListener("click",()=>{
    data.guests.push({id:(data.nextId||1),name:"",household:"",dietary:"",notes:""});
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
  document.title="Sunday Brunch"+(config.venueName?" · "+config.venueName:"");
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
