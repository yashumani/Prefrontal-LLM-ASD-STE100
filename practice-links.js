/* Relocate reusable prose without altering canonical source or print content. */
(function(global){
 'use strict';
 const data=global.PracticeCatalog||JSON.parse(document.getElementById('practice-data').textContent);
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const moved=new Map();
 data.sections.forEach(section=>section.items.forEach(item=>{
  const refs=[{...item.source,move:item.move},...(item.references||[])];
  if(refs.some(ref=>ref.move&&ref.file==='presentation-content.json'&&/\/items\/\d+\/text$/.test(ref.pointer)))moved.set(item.text,{...item,section:section.title});
 }));
 global.ContextPractices={
  find:item=>moved.get(item.text),
  links:items=>{const targets=[...new Map(items.map(item=>moved.get(item.text)).filter(Boolean).map(item=>[item.section,item])).values()];return targets.length?`<div class="practice-relocation">Guidance moved to Best Practices: ${targets.map(item=>`<a href="best-practices.html#${esc(item.id)}">${esc(item.section)}</a>`).join(' · ')}. Open the reference for the complete guidance.</div>`:'';},
  items:items=>`<div class="items">${items.map(item=>`<article class="item${moved.has(item.text)?' practice-print-original':''}"><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`).join('')}${global.ContextPractices.links(items)}</div>`
 };
})(typeof window==='undefined'?globalThis:window);
