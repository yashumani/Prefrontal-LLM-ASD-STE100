/* The continuous view reuses the deck, its diagrams and its single motion clock. */
(function (global) {
  'use strict';
  let chapters=[], chapterChanged=()=>{}, current=-1;
  const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
  function markChapter(index){
    if(index===current)return;
    current=index;
    document.querySelectorAll('.story-chapters a').forEach((a,i)=>{if(i===index)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
    document.querySelector('.story-position').textContent=String(index+1).padStart(2,'0')+' / 16';
    const format=document.querySelector('.presentation-format');format.href='index.html#'+chapters[index].dataset.slide;
    chapterChanged(index);
  }
  function navigate(index,updateHash=true){
    const panel=chapters[index];if(!panel)return;
    markChapter(index);
    if(updateHash)history.replaceState(null,'','#'+panel.dataset.slide);
    panel.scrollIntoView({behavior:'instant',block:'start'});
    global.ContextMotion.arrive(panel.querySelector('h1,h2'));
  }
  function initialize({panels,data,onChapter}){
    chapters=panels;chapterChanged=onChapter;
    const format=document.querySelector('.presentation-format');format.textContent='Slide deck ↗';format.title='Open the original slide presentation';
    document.querySelector('.skip').href='#deck';
    const menu=make('details','story-menu'),summary=make('summary','','Explore the story');
    const position=make('span','story-position','01 / 16');summary.append(position);menu.append(summary);
    const links=make('nav','story-chapters');links.setAttribute('aria-label','Story chapters');menu.append(links);
    document.querySelector('.topbar').prepend(menu);
    const progress=make('div','story-progress');progress.setAttribute('aria-hidden','true');document.body.append(progress);
    const reduce=matchMedia('(prefers-reduced-motion: reduce)');
    const depthToggle=make('button','story-depth-toggle','3D view');depthToggle.type='button';
    depthToggle.setAttribute('aria-pressed','true');depthToggle.setAttribute('aria-label','Toggle three-dimensional diagram depth');
    document.querySelector('.tools').prepend(depthToggle);
    depthToggle.addEventListener('click',()=>global.ContextMotion.setDepth(!global.ContextMotion.state().depthRequested));
    global.ContextMotion.subscribe(state=>{
      depthToggle.disabled=state.reduced||!state.depthAvailable;
      depthToggle.textContent=state.depth?'3D view':'Flat view';
      depthToggle.setAttribute('aria-pressed',String(state.depth));
    });
    const selectInsight=(scene,card)=>{
      scene.querySelectorAll('.story-step').forEach(item=>item.classList.toggle('is-reading',item===card));
      const index=Number(card.dataset.stageIndex);
      scene.querySelectorAll('.story-step-jump').forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===index));});
      scene.querySelector('.story-focus-title').textContent=card.querySelector('h3').textContent;
      scene.querySelector('.story-focus-count').textContent=String(index+1).padStart(2,'0')+' / '+scene.querySelectorAll('.story-step').length;
      scene.querySelector('.mechanism-figure').scrollStage(index);
    };
    const stageObserver=new IntersectionObserver(entries=>{
      const scenes=new Set(entries.filter(e=>e.isIntersecting).map(e=>e.target.closest('.story-scene')));
      scenes.forEach(scene=>{
        const cards=[...scene.querySelectorAll('.story-step')],line=innerHeight*.425;
        const card=cards.find(card=>{const box=card.getBoundingClientRect();return box.top<=line&&box.bottom>=line;});
        if(card)selectInsight(scene,card);
      });
    },{rootMargin:'-30% 0px -45% 0px',threshold:0});
    const reveal=new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{if(isIntersecting){target.classList.add('story-arrived');reveal.unobserve(target);}}),{threshold:0.08});
    panels.forEach((panel,index)=>{
      panel.hidden=false;panel.classList.add('story-chapter');panel.style.setProperty('--chapter',index);
      panel.prepend(make('p','chapter-number',String(index+1).padStart(2,'0')+' / '+String(panels.length)));
      const link=make('a','',String(index+1).padStart(2,'0')+'  '+data.slides[index].title);link.href='#'+data.slides[index].id;
      link.addEventListener('click',event=>{event.preventDefault();menu.open=false;navigate(index);});links.append(link);
      // Every authored topic is open in this format. Readers can collapse detail.
      panel.querySelectorAll('details').forEach(detail=>{detail.open=true;});
      panel.querySelectorAll('.detail-intro').forEach(n=>n.textContent='All original topics are included below. Collapse any detail after reading it.');
      panel.querySelectorAll('.suite-page').forEach(page=>{page.hidden=false;page.prepend(make('h3','story-cost-label',({planner:'Task cost',hidden:'Hidden model work',budget:'Monthly model budget',anatomy:'Call anatomy'})[page.dataset.costPage]));});
      // Cost navigation becomes in-page navigation without removing any calculator.
      panel.querySelectorAll('.suite-tabs').forEach(n=>n.hidden=true);
      const figure=panel.querySelector('.mechanism-figure');
      if(figure && data.slides[index].type!=='cost-suite'){
        const stages=[...figure.querySelectorAll('[data-stage]')];
        if(stages.length){
          const scene=make('div','story-scene'),insights=make('div','story-insights');
          figure.before(scene);scene.append(figure,insights);figure.classList.add('story-sticky');
          const guide=make('div','story-focus-guide'),focus=make('div','story-focus-heading');
          focus.append(make('span','story-focus-count','01 / '+stages.length),make('strong','story-focus-title',stages[0].dataset.stage));
          const jumps=make('div','story-step-jumps');jumps.setAttribute('role','group');jumps.setAttribute('aria-label','Choose a diagram step');
          guide.append(make('p','story-scroll-cue','Scroll to follow the flow · or choose a step'),focus,jumps);figure.prepend(guide);
          const viewport=figure.querySelector('.diagram-viewport'),depth=make('div','story-depth-stage');
          viewport.before(depth);depth.append(viewport);depth.setAttribute('data-depth-scene','');
          const depthMotion=global.ContextMotion.register({element:depth,kind:'depth',continuous:false,staticFrame:()=>{depth.style.setProperty('--tilt-x','0deg');depth.style.setProperty('--tilt-y','0deg');depth.style.setProperty('--lift','0px');},measure:()=>{
            const box=scene.getBoundingClientRect(),span=Math.max(1,box.height-innerHeight*.5);
            return Math.max(0,Math.min(1,(innerHeight*.3-box.top)/span));
          },frame:(_t,_delta,progress)=>{
            depth.style.setProperty('--tilt-x',(2-progress*4).toFixed(2)+'deg');
            depth.style.setProperty('--tilt-y',(-2+progress*4).toFixed(2)+'deg');
            depth.style.setProperty('--lift',(Math.sin(progress*Math.PI)*10).toFixed(2)+'px');
          }});depthMotion.setAllowed(true);
          stages.forEach((stage,i)=>{
            const card=make('article','story-step');card.dataset.stageIndex=String(i);card.tabIndex=0;
            card.append(make('span','story-step-number',String(i+1).padStart(2,'0')+' / '+stages.length),make('h3','',stage.dataset.stage),make('p','',stage.dataset.stageDetail));
            const jump=make('button','story-step-jump',String(i+1).padStart(2,'0'));jump.type='button';jump.title=stage.dataset.stage;jump.setAttribute('aria-label','Step '+(i+1)+': '+stage.dataset.stage);jump.setAttribute('aria-pressed',String(i===0));
            jump.addEventListener('click',()=>{card.scrollIntoView({behavior:'instant',block:'center'});selectInsight(scene,card);card.focus({preventScroll:true});});jumps.append(jump);
            card.addEventListener('focus',()=>selectInsight(scene,card));insights.append(card);stageObserver.observe(card);
          });
          figure.dataset.scrollStage='0';
        }
      }
      reveal.observe(panel);
    });
    const update=()=>{
      const edge=innerHeight*.3;
      let index=0;for(let i=0;i<panels.length;i++){if(panels[i].getBoundingClientRect().top<=edge)index=i;}
      markChapter(index);
      const range=document.documentElement.scrollHeight-innerHeight;
      progress.style.transform='scaleX('+Math.max(0,Math.min(1,range>0?scrollY/range:0))+')';
    };
    addEventListener('scroll',update,{passive:true});addEventListener('resize',update);
    reduce.addEventListener('change',update);update();
    document.body.dataset.storyReady='true';
  }
  global.ContextStory={initialize,navigate};
})(window);
