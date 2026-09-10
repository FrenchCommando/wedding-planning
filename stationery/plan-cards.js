/* One 12×17 card per seated table, from the live seating chart — the copy
   the stationery page derives, laid out as the designer's proof but with
   the Chinese tables set properly. Read-only: nothing here writes. Name
   handling comes from names.js. */
function esc(s){return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

/* Names size: Auto shrinks each card's column until it fits its box; the
   stepper pins one size across every card. Same preference key as the
   stationery page's mockup so the two agree, though the units differ —
   the mockup counts px on a 104px card, this page cm on a 12cm one — so
   only the "Auto vs fixed" state is shared, not the number. */
const NAMES_DEFAULT=0.42, NAMES_MIN=0.24, NAMES_MAX=0.6, STEP=0.02;
let namesSize=(()=>{try{const v=Number(localStorage.getItem("stationery.planNamesCm"));return v>0?v:null;}catch{return null;}})();

function entry(e){
  const {main,rom}=splitEntry(e);
  const cjk=/[一-鿿]/.test(main);
  if(!rom)return `<div class="entry lat"><span class="main">${esc(main)}</span></div>`;
  return `<div class="entry${cjk?" cjk":""}"><span class="main">${esc(main)}</span><span class="rom">${esc(rom)}</span></div>`;
}
function card(s,t,room){
  const num=(t.name.match(/\d+/)||[t.name])[0];
  const names=collapseHousehold(seatedNames(s,t)).map(entry).join("");
  return `<div class="card" data-table="${esc(t.name)}">
    <div class="num">${esc(num)}</div>
    <div class="salon">${esc(room.name)}</div>
    <div class="names">${names}</div>
  </div>`;
}
function render(s){
  const sheet=document.getElementById("sheet");
  sheet.innerHTML=s.rooms.map(r=>usedTables(s,r).map(t=>card(s,t,r)).join("")).join("");
  fit();
}
function fit(){
  const cards=document.querySelectorAll(".card");
  document.getElementById("size").textContent=namesSize?namesSize.toFixed(2)+"cm":"Auto";
  document.getElementById("down").disabled=!!namesSize&&namesSize<=NAMES_MIN;
  document.getElementById("up").disabled=!!namesSize&&namesSize>=NAMES_MAX;
  document.getElementById("auto").disabled=!namesSize;
  cards.forEach(c=>{
    const names=c.querySelector(".names");
    let size=namesSize||NAMES_DEFAULT;
    c.style.setProperty("--names",size+"cm");
    if(namesSize)return;
    while(size>NAMES_MIN&&names.scrollHeight>names.clientHeight+1){
      size=Math.round((size-STEP)*100)/100;
      c.style.setProperty("--names",size+"cm");
    }
  });
}
function setSize(v){
  namesSize=v;
  try{if(v)localStorage.setItem("stationery.planNamesCm",String(v));else localStorage.removeItem("stationery.planNamesCm");}catch{}
  fit();
}
function step(d){
  const cur=namesSize||NAMES_DEFAULT;
  setSize(Math.min(NAMES_MAX,Math.max(NAMES_MIN,Math.round((cur+d*STEP)*100)/100)));
}

async function init(){
  document.getElementById("down").addEventListener("click",()=>step(-1));
  document.getElementById("up").addEventListener("click",()=>step(1));
  document.getElementById("auto").addEventListener("click",()=>setSize(null));
  document.getElementById("print").addEventListener("click",()=>window.print());
  const res=await fetch("/api/seating",{credentials:"same-origin"});
  if(res.status===403){
    document.getElementById("err").textContent="Sign in on the Stationery page first, then come back.";
    return;
  }
  if(!res.ok){document.getElementById("err").textContent="Couldn't load the seating chart.";return;}
  const s=(await res.json()).data;
  render(s);
  // The web fonts arrive after first paint and change every measurement,
  // so the fit runs again once they're in.
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
}
init();
