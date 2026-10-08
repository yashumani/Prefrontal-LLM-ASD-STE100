/* Sidebar navigation shares the existing controls and their event handlers. */
(function(){
 'use strict';
 const rail=document.querySelector('.site-navigation');if(!rail)return;
 const mobile=matchMedia('(max-width:800px)'),toggle=rail.querySelector('summary');
 const sync=()=>{rail.open=!mobile.matches;};sync();mobile.addEventListener('change',sync);
 rail.addEventListener('toggle',()=>{toggle.setAttribute('aria-expanded',String(rail.open));});
 rail.addEventListener('click',event=>{
  const target=event.target.closest('a,.nav-item,.story-chapters a');
  if(target&&mobile.matches){rail.open=false;}
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&mobile.matches&&rail.open){rail.open=false;toggle.focus();}});
 document.addEventListener('pointerdown',event=>{if(mobile.matches&&rail.open&&!rail.contains(event.target))rail.open=false;});
 // Preserve native hash navigation and the deck's canonical slide handler.
 rail.querySelectorAll('.sidebar-actions a').forEach(link=>link.addEventListener('click',()=>{
  if(link.hash&&link.pathname===location.pathname&&typeof showSlide==='function'){
   const index=deckData.slides.findIndex(slide=>slide.id===link.hash.slice(1));if(index>=0)showSlide(index);
  }
 }));
 document.getElementById('practice-print')?.addEventListener('click',()=>window.print());
 const cortexTabs=document.querySelector('.cortex-tabs');
 if(cortexTabs){const detail=document.createElement('details');detail.className='cortex-shortcuts';detail.innerHTML='<summary>Brain reference sections</summary>';const nav=cortexTabs;nav.className='sidebar-cortex-links';detail.append(nav);rail.querySelector('.sidebar-sections').append(detail);}
 const context=rail.querySelector('.sidebar-context');
 const deck=document.getElementById('deck');
 const overview=document.getElementById('overview');if(overview)rail.querySelector('.sidebar-sections').append(overview);
 if(deck&&context){
  let currentPanel=null,currentFigure=null;
  context.innerHTML='<strong data-stage-label>Diagram steps</strong><div class="context-buttons"><button id="sidebar-stage-prev" type="button" aria-label="Previous diagram stage">← Stage</button><span id="sidebar-stage-count"></span><button id="sidebar-stage-next" type="button" aria-label="Next diagram stage">Stage →</button></div><label class="sidebar-step-label" hidden>Diagram step<select id="sidebar-step"></select></label><label class="sidebar-topic-label" hidden>Detail section<select id="sidebar-topic"></select></label><label class="sidebar-cost-label" hidden>Cost view<select id="sidebar-cost"></select></label>';
  const count=context.querySelector('#sidebar-stage-count'),step=context.querySelector('#sidebar-step'),topic=context.querySelector('#sidebar-topic'),cost=context.querySelector('#sidebar-cost');
  function fill(select,buttons){select.replaceChildren();buttons.forEach((button,i)=>{const option=document.createElement('option');option.value=i;option.textContent=button.getAttribute('aria-label')||button.textContent;select.append(option);});select.parentElement.hidden=!buttons.length;}
  function refresh(){
   if(!currentPanel)return;
   const figure=[...currentPanel.querySelectorAll('.mechanism-figure')].find(e=>e.checkVisibility());
   currentFigure=figure||null;
   context.querySelector('.context-buttons').hidden=!figure;
   count.textContent=figure?.querySelector('.stage-count')?.textContent||'';
   context.querySelector('[data-stage-label]').textContent=figure?'Diagram steps':'Reading controls';
   if(step.options.length&&figure)step.value=figure.querySelector('svg')?.dataset.currentStep||'0';
  }
  function selectPanel(panel){
   if(!panel||panel===currentPanel)return;
   currentPanel=panel;context.hidden=false;
   fill(topic,[...panel.querySelectorAll('.topic-strip button')]);
   if(topic.options.length){const hint=document.createElement('option');hint.value='';hint.textContent='Choose detail…';hint.disabled=true;hint.selected=true;topic.prepend(hint);}
   fill(cost,[...panel.querySelectorAll('.suite-tabs button')]);
   fill(step,[...panel.querySelectorAll('.story-scene .story-step-jump')]);
   refresh();
  }
  function stage(delta){if(!currentFigure)return;const scene=currentFigure.closest('.story-scene');if(scene){const cards=[...scene.querySelectorAll('.story-step')];const n=Math.max(0,Math.min(cards.length-1,Number(currentFigure.dataset.scrollStage||0)+delta));scene.querySelectorAll('.story-step-jump')[n]?.click();}else currentFigure.querySelector(delta>0?'.stage-next':'.stage-prev')?.click();refresh();}
  context.querySelector('#sidebar-stage-prev').addEventListener('click',()=>stage(-1));context.querySelector('#sidebar-stage-next').addEventListener('click',()=>stage(1));
  const closeMobile=()=>{if(mobile.matches)rail.open=false;};
  step.addEventListener('change',()=>{currentPanel.querySelectorAll('.story-step-jump')[Number(step.value)]?.click();closeMobile();});
  topic.addEventListener('change',()=>{currentPanel.querySelectorAll('.topic-strip button')[Number(topic.value)]?.click();closeMobile();});
  cost.addEventListener('change',()=>{if(document.body.dataset.presentation==='story')currentPanel.querySelectorAll('.suite-page')[Number(cost.value)]?.scrollIntoView({behavior:'instant',block:'start'});else currentPanel.querySelectorAll('.suite-tabs button')[Number(cost.value)]?.click();refresh();closeMobile();});
  // Mutation events mirror the existing animation cursor; no second clock.
  new MutationObserver(()=>{if(document.body.dataset.presentation!=='story')selectPanel([...deck.children].find(e=>e.matches('.slide:not([hidden])')));refresh();}).observe(deck,{subtree:true,attributes:true,attributeFilter:['hidden','data-current-step','data-scroll-stage']});
  if(document.body.dataset.presentation==='story'){
   const observer=new IntersectionObserver(entries=>{const hit=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(hit)selectPanel(hit.target);},{rootMargin:'-10% 0px -65% 0px'});deck.querySelectorAll('.slide').forEach(e=>observer.observe(e));
  }
  selectPanel([...deck.children].find(e=>e.matches('.slide:not([hidden])')));
 }
 document.body.dataset.sidebarReady='true';
})();
