(function(){
 'use strict';
 const data=JSON.parse(document.getElementById('decision-data').textContent);
 const byId=new Map(data.nodes.map(n=>[n.id,n]));
 const inspector=document.getElementById('inspector');
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 let activePaths=[];
 const samples=new WeakMap();
 const flows=new Map();
 function select(id,travel=false){
  const n=byId.get(id);if(!n)return;
  flows.forEach((flow,key)=>flow.setAllowed(key===id));
  document.querySelectorAll('.node').forEach(e=>{const active=e.id===id;e.classList.toggle('active',active);e.querySelector('button').setAttribute('aria-expanded',String(active));});
  document.querySelectorAll('.route').forEach(e=>e.classList.toggle('selected',e.dataset.from===id));
  activePaths=[...document.querySelectorAll('.route.selected path')].map(path=>{
   if(!samples.has(path))samples.set(path,ContextMotion.samplePath(path));
   return {pointAt:samples.get(path),dot:path.parentNode.querySelector('circle')};
  });
  inspector.replaceChildren(el('p',`${n.role.toUpperCase()} · ${n.decision?'DECISION':'STEP'}`),el('h2',n.title),el('p',n.detail));
  const edges=data.edges.filter(e=>e.source===id);
  inspector.append(el('p',edges.length?'Follow an outcome:':'This branch ends here.'));
  edges.forEach(e=>{const b=el('button','');b.append(el('b',e.label),el('span',byId.get(e.target).title));b.onclick=()=>select(e.target,true);inspector.append(b);});
  const close=el('button','Close details');close.className='inspector-close';close.onclick=()=>{inspector.classList.remove('has-selection');document.getElementById(id).querySelector('button').focus({preventScroll:true});};
  const body=el('div','');body.className='inspector-body';body.append(...inspector.childNodes);inspector.append(body,close);inspector.classList.add('has-selection');
  ContextMotion.arrive(inspector.querySelector('h2'));
  if(travel){const target=document.getElementById(id);target.scrollIntoView({block:'center',inline:'center'});target.querySelector('button').focus({preventScroll:true});history.replaceState(null,'',`#${id}`);}
 }
 document.querySelectorAll('[data-node]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.node)));
 document.querySelectorAll('.phases a,.reference a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();select(a.hash.slice(1),true);}));
 document.querySelectorAll('.route').forEach(route=>{const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('r','4');dot.setAttribute('class','flow-dot');route.append(dot);});
 document.querySelectorAll('.node').forEach(e=>{
  const depth=ContextMotion.register({element:e,kind:'depth',continuous:false,
   measure(){const box=e.getBoundingClientRect();return Math.max(-1,Math.min(1,(box.top+box.height/2-innerHeight/2)/innerHeight));},
   frame(_t,_delta,p){e.style.setProperty('--tilt',`${-p*ContextMotion.profile.tiltDegrees}deg`);e.style.setProperty('--lift',`${ContextMotion.profile.liftPx*(1-Math.abs(p))}px`);},
   staticFrame(){e.style.setProperty('--tilt','0deg');e.style.setProperty('--lift','0px');}});
  depth.setAllowed(true);
 });
 // Observe each source card so a long SVG route never keeps off-screen work alive.
 document.querySelectorAll('.node-button').forEach(button=>{
  const flow=ContextMotion.register({element:button,frame(t){if(button.dataset.node===document.querySelector('.node.active')?.id)activePaths.forEach(({pointAt,dot})=>{const point=pointAt(t/ContextMotion.profile.packetSeconds%1);dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);});}});
  flows.set(button.dataset.node,flow);
 });
 const depthButton=document.getElementById('flat');
 depthButton.onclick=()=>ContextMotion.setDepth(!ContextMotion.state().depthRequested);
 ContextMotion.bindPauseControl(document.getElementById('pause'));
 ContextMotion.subscribe(state=>{
  document.body.classList.toggle('flat',!state.depth);
  document.body.classList.toggle('paused',state.stopped);
  depthButton.textContent=`3D depth: ${state.depth?'on':'off'}`;
  depthButton.disabled=state.reduced||!state.depthAvailable;
  depthButton.setAttribute('aria-pressed',String(!state.depth));
 });
 const map=document.querySelector('.map-scroll');map.scrollLeft=(1200-map.clientWidth)/2;

 if(byId.has(location.hash.slice(1)))select(location.hash.slice(1),true);
 window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(byId.has(id))select(id,true);});
})();
