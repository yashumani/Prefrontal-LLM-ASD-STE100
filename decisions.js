(function(){
 'use strict';
 const data=JSON.parse(document.getElementById('decision-data').textContent);
 const byId=new Map(data.nodes.map(n=>[n.id,n]));
 const inspector=document.getElementById('inspector');
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 let activePaths=[];
 function select(id,travel=false){
  const n=byId.get(id);if(!n)return;
  document.querySelectorAll('.node').forEach(e=>{const active=e.id===id;e.classList.toggle('active',active);e.querySelector('button').setAttribute('aria-expanded',String(active));});
  document.querySelectorAll('.route').forEach(e=>e.classList.toggle('selected',e.dataset.from===id));
  activePaths=[...document.querySelectorAll('.route.selected path')].map(path=>({path,length:path.getTotalLength(),dot:path.parentNode.querySelector('circle')}));
  inspector.replaceChildren(el('p',`${n.role.toUpperCase()} · ${n.decision?'DECISION':'STEP'}`),el('h2',n.title),el('p',n.detail));
  const edges=data.edges.filter(e=>e.source===id);
  inspector.append(el('p',edges.length?'Follow an outcome:':'This branch ends here.'));
  edges.forEach(e=>{const b=el('button','');b.append(el('b',e.label),el('span',byId.get(e.target).title));b.onclick=()=>select(e.target,true);inspector.append(b);});
  const close=el('button','Close details');close.onclick=()=>{inspector.classList.remove('has-selection');document.getElementById(id).querySelector('button').focus({preventScroll:true});};inspector.append(close);inspector.classList.add('has-selection');
  if(travel){const target=document.getElementById(id);target.scrollIntoView({block:'center',inline:'center'});target.querySelector('button').focus({preventScroll:true});history.replaceState(null,'',`#${id}`);}
 }
 document.querySelectorAll('[data-node]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.node)));
 document.querySelectorAll('.phases a,.reference a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();select(a.hash.slice(1),true);}));
 document.querySelectorAll('.route').forEach(route=>{const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('r','4');dot.setAttribute('class','flow-dot');route.append(dot);});
 let flat=false,paused=false;
 const registrations=[...document.querySelectorAll('.node')].map(e=>ContextMotion.register({element:e,frame(t){if(e.classList.contains('active'))activePaths.forEach(({path,length,dot})=>{const point=path.getPointAtLength((t/3%1)*length);dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);});const box=e.getBoundingClientRect();const p=Math.max(-1,Math.min(1,(box.top+box.height/2-innerHeight/2)/innerHeight));e.style.setProperty('--tilt',`${p*-7}deg`);e.style.setProperty('--lift',`${8*(1-Math.abs(p))}px`);},staticFrame(){e.style.setProperty('--tilt','0deg');e.style.setProperty('--lift','0px');}}));
 registrations.forEach(r=>r.setAllowed(true));
 document.getElementById('flat').onclick=function(){flat=!flat;document.body.classList.toggle('flat',flat);this.textContent=`3D depth: ${flat?'off':'on'}`;this.setAttribute('aria-pressed',String(flat));registrations.forEach(r=>r.setAllowed(!flat));};
 document.getElementById('pause').onclick=function(){paused=!paused;document.body.classList.toggle('paused',paused);ContextMotion.setPaused(paused);this.textContent=paused?'Resume motion':'Pause motion';this.setAttribute('aria-pressed',String(paused));};
 const map=document.querySelector('.map-scroll');map.scrollLeft=(1200-map.clientWidth)/2;
 if(byId.has(location.hash.slice(1)))select(location.hash.slice(1),true);
})();
