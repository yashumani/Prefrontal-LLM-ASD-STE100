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
    const stageObserver=new IntersectionObserver(entries=>{
      entries.filter(e=>e.isIntersecting).forEach(({target})=>{
        const scene=target.closest('.story-scene');scene.querySelectorAll('.story-step').forEach(card=>card.classList.toggle('is-reading',card===target));
        scene.querySelector('.mechanism-figure').scrollStage(Number(target.dataset.stageIndex));
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
          stages.forEach((stage,i)=>{
            const card=make('article','story-step');card.dataset.stageIndex=String(i);card.tabIndex=0;
            card.append(make('span','story-step-number',String(i+1).padStart(2,'0')+' / '+stages.length),make('h3','',stage.dataset.stage),make('p','',stage.dataset.stageDetail));
            card.addEventListener('focus',()=>figure.scrollStage(i));insights.append(card);stageObserver.observe(card);
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
