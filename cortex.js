(function(){
 'use strict';
 document.querySelectorAll('.cortex-section').forEach(section=>{
  if(section.closest('noscript'))return;
  const stage=section.querySelector('.cortex-stage'),wire=section.querySelector('.cortex-wire'),dot=section.querySelector('.cortex-packet');
  const length=wire.getTotalLength();let paused=false;
  const motion=ContextMotion.register({element:stage,frame(t){const point=wire.getPointAtLength((t/3%1)*length);dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);const box=stage.getBoundingClientRect();const p=Math.max(-1,Math.min(1,(box.top+box.height/2-innerHeight/2)/innerHeight));stage.style.setProperty('--cortex-tilt',`${-p*6}deg`);},staticFrame(){stage.style.setProperty('--cortex-tilt','0deg');}});motion.setAllowed(true);
  const control=section.querySelector('.cortex-motion');control.onclick=()=>{paused=!paused;stage.dataset.localPaused=String(paused);control.setAttribute('aria-pressed',String(paused));control.textContent=paused?'Resume this visual':'Pause this visual';motion.setAllowed(!paused);};
  const cards=[...section.querySelectorAll('.cortex-mapping')],links=[...section.querySelectorAll('[data-cortex-region]')];
  let requestedCard=null;
  function select(id){cards.forEach(e=>e.classList.toggle('is-selected',e.dataset.region===id));links.forEach(e=>{if(e.dataset.cortexRegion===id)e.setAttribute('aria-current','location');else e.removeAttribute('aria-current');});}
  function destination(card){const margin=parseFloat(getComputedStyle(card).scrollMarginTop)||0;return Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,scrollY+card.getBoundingClientRect().top-margin));}
  function selectReadingCard(){
   // Keep a chosen region selected while native anchor scrolling crosses other cards.
   if(requestedCard){if(Math.abs(scrollY-destination(requestedCard))<=2)requestedCard=null;return;}
   const line=Math.min(innerHeight-1,Math.max(110,innerHeight*.25));
   const visible=cards.map(card=>({card,box:card.getBoundingClientRect()})).filter(({box})=>box.bottom>0&&box.top<innerHeight);
   const current=visible.find(({box})=>box.top<=line&&box.bottom>line)||visible.sort((a,b)=>Math.abs(a.box.top-line)-Math.abs(b.box.top-line))[0];
   if(current)select(current.card.dataset.region);
  }
  links.forEach(a=>a.addEventListener('click',event=>{
   if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const card=cards.find(e=>e.dataset.region===a.dataset.cortexRegion);if(!card)return;
   event.preventDefault();requestedCard=card;select(card.dataset.region);history.pushState(null,'',a.hash);
   card.scrollIntoView({block:'start'});selectReadingCard();
  }));
  // Input, rather than an arbitrary timeout, returns control to ordinary reading.
  const cancelRequestedCard=()=>{requestedCard=null;};
  addEventListener('wheel',cancelRequestedCard,{passive:true});addEventListener('touchstart',cancelRequestedCard,{passive:true});
  addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))cancelRequestedCard();});
  addEventListener('pointerdown',event=>{if(event.clientX>=document.documentElement.clientWidth)cancelRequestedCard();},{passive:true});
  addEventListener('scroll',selectReadingCard,{passive:true});addEventListener('resize',selectReadingCard);
  addEventListener('scrollend',()=>{requestedCard=null;selectReadingCard();});
  selectReadingCard();
  const continuation=section.querySelector('[data-cortex-continue]');if(document.body.dataset.presentation==='story'){continuation.href='#opening-thesis';continuation.textContent='Continue into the product story ↓';}
 });
})();
