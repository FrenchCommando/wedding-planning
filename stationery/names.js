/* How a seating-chart name becomes a name on paper. Shared by the
   stationery page (mockups, copy, Download all) and the table plan card
   print sheet, loaded as a plain script before either. */

/* Chinese entries are one household per line. The chart stores extra party
   members as their own guest records suffixed `+1`, `+2` (`李文轩 +1
   (Li Wenxuan +1)`) because each occupies a real seat; on a name list those
   are one household, so they collapse to the base name with the household
   headcount — `李文轩 (三位) Li Wenxuan` for a base plus +1 and +2. The
   count is the total, not the number of extras. Collapsing keys on the base
   name, so members split across tables collapse per table, not into one
   line under whichever table came first. (Names in these comments are
   invented — this repo is public, the guest list is not.) */
function baseName(name){
  // Strips a trailing " +N" from both the Chinese name and the pinyin
  // parenthetical: "李文轩 +1 (Li Wenxuan +1)" → "李文轩 (Li Wenxuan)".
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

/* The count goes before the pinyin, not after the whole name: on a place
   card "李文轩 (Li Wenxuan) (2)" wraps between the two parentheticals and
   strands the number on its own line. "李文轩 (2) (Li Wenxuan)" keeps the
   number against the characters it belongs to, and any wrap falls in front
   of the romanisation instead. Names with no parenthetical just take the
   count at the end as before. */
// A card written in Chinese counts in Chinese: 两位, 三位 — 两 rather than 二
// for a quantity of two, and the measure word 位 because these are people
// being counted, politely. Latin names keep the bare digit. Past ten the
// numeral falls back to a digit rather than composing 十一 and up for a
// household size this wedding will never have.
const CN_NUM=["","一","两","三","四","五","六","七","八","九","十"];
function countLabel(name,count){
  if(!/[一-鿿]/.test(name))return String(count);
  return (count<CN_NUM.length?CN_NUM[count]:String(count))+"位";
}
function withCount(name,count){
  const m=name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  // A Chinese entry always states its headcount, 一位 included — the count is
  // part of how the line reads, not an annotation added only when there's
  // more than one. Latin names take a count only when there is one to make.
  const n=(count>1||/[一-鿿]/.test(name))?` (${countLabel(name,count)})`:"";
  // The brackets around the pinyin are the seating chart's own notation for
  // "this is a reading aid". On a printed card there's nothing to bracket
  // it off from, and they only add another wrap point in a line that
  // already breaks badly — so the romanisation prints plain.
  return m?`${m[1]}${n} ${m[2]}`:`${name}${n}`;
}
function entryText(e){return withCount(e.name,e.count);}
// A name as it goes on a place card: characters alone for a Chinese guest,
// the name unchanged for everyone else.
function cardName(name){
  return /[一-鿿]/.test(name)?name.replace(/\s*\([^)]*\)\s*$/,"").trim():name;
}
// A table plan entry split for setting on two lines: the characters with
// their count, then the romanisation. A Latin name has only the first.
function splitEntry(e){
  const m=e.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m?{main:withCount(m[1],e.count),rom:m[2]}:{main:entryText(e),rom:""};
}

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
