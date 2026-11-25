(() => {
  const ru = () => localStorage.getItem('ustaz-lang') === 'ru';
  const label = (r,k) => ru() ? r : k;
  const resources = document.getElementById('sourceDirectory');
  if (!resources) return;
  const edition = () => ru() ? 'rus' : 'kaz';
  const lang = () => ru() ? 'ru' : 'kk';
  const academy = () => 'https://uba.edu.kz/'+(ru()?'ru':'qaz')+'/metodology/3?page=1';
  const books = () => 'https://www.gov.kz/org/edu/documents/details/892700?lang='+lang();
  function address(raw) {
    let url;try {url=new URL(raw);} catch {return null;}
    if(url.protocol!=='https:'||/[{}$]/.test(decodeURI(url.href)))return null;
    if(['adilet.zan.kz','old.adilet.zan.kz'].includes(url.hostname))return 'https://old.adilet.zan.kz'+url.pathname.replace(/\/(kaz|rus)\//,'/'+edition()+'/')+url.hash;
    if(url.hostname==='uba.edu.kz')return academy();
    if(url.hostname==='www.gov.kz' && url.pathname.includes('/documents/details/'))return books();
    if(url.hostname==='bilimland.kz')return 'https://bilimland.kz/'+lang()+'/'+(url.pathname.includes('teacher-page')?'teacher-page':'plans');
    return url.href;
  }
  const checked = new Set(["https://adilet.zan.kz/kaz/docs/V1200008170","https://adilet.zan.kz/kaz/docs/V2000020317","https://adilet.zan.kz/kaz/docs/V2200029031","https://adilet.zan.kz/kaz/docs/V2200029767","https://adilet.zan.kz/rus/docs/V1200008170","https://adilet.zan.kz/rus/docs/V2000020317","https://adilet.zan.kz/rus/docs/V2200029031","https://adilet.zan.kz/rus/docs/V2200029767","https://bilimland.kz/kk/plans","https://bilimland.kz/kk/teacher-page","https://bilimland.kz/ru/plans","https://bilimland.kz/ru/teacher-page","https://old.adilet.zan.kz/kaz/docs/V1200008170","https://old.adilet.zan.kz/kaz/docs/V2000020317","https://old.adilet.zan.kz/kaz/docs/V2200029031","https://old.adilet.zan.kz/kaz/docs/V2200029767","https://old.adilet.zan.kz/rus/docs/V1200008170","https://old.adilet.zan.kz/rus/docs/V2000020317","https://old.adilet.zan.kz/rus/docs/V2200029031","https://old.adilet.zan.kz/rus/docs/V2200029767","https://uba.edu.kz/","https://uba.edu.kz/qaz/metodology/3?page=1","https://uba.edu.kz/ru/metodology/3?page=1","https://www.gov.kz/api/v1/public/assets/2026/11/10/42e62c7a145ea61136d5c4adead0c1f6dc2e196fec4b072ad661a4240e261996_original.2073724.pdf","https://www.gov.kz/org/edu/documents/details/892700?lang=kk","https://www.gov.kz/org/edu/documents/details/892700?lang=ru","https://ziatker.kz/materials"]);
  function annotate(card,link) {
    const href=address(link.getAttribute('href'));
    if(!href){link.removeAttribute('href');return;}
    link.href=href;
    const host=new URL(href).hostname;
    const kind=host==='ziatker.kz'?label('Разработки учителей','Мұғалім әзірлемелері'):host==='bilimland.kz'?label('Образовательная платформа','Білім беру платформасы'):label('Официальный источник','Ресми дереккөз');
    const scope=href.includes('892700')?label('Учебники для 1–11 классов','1–11 сынып оқулықтары'):label('Общий ресурс. Привязка к выбранному предмету и классу не подтверждена','Жалпы ресурс. Таңдалған пән мен сыныпқа сәйкестігі расталмаған');
    const status=checked.has(href)?label('Ссылка открывалась 25.11.2026','Сілтеме 25.11.2026 күні ашылды'):label('Доступность ссылки не проверена','Сілтеменің ашылуы тексерілмеген');
    let note=card.querySelector('.link-review');
    if(!note){note=document.createElement('p');note.className='link-review';card.insertBefore(note,link);}
    note.textContent=[kind,scope,status].join(' · ');
  }
  function review(){
    for(const card of resources.querySelectorAll('.source-card,.open-resource-card')){const link=card.querySelector('a');if(link)annotate(card,link);}
    const direct={ubaFinder:academy(),bookFinder:books(),directEbooks:books(),programFinder:'https://old.adilet.zan.kz/'+edition()+'/docs/V2200029767',communityFinder:'https://ziatker.kz/materials',videoFinder:'https://bilimland.kz/'+lang()+'/teacher-page'};
    for(const [id,url] of Object.entries(direct)){const a=document.getElementById(id);if(a)a.href=url;}
    const v=document.getElementById('videoFinder');if(v)v.textContent=label('Материалы BilimLand ↗','BilimLand материалдары ↗');
  }
  for(const id of ['sourceGrid','openCatalogResults']){
    const grid=document.getElementById(id);if(grid)new MutationObserver(review).observe(grid,{childList:true});
  }
  review();
  const menu=document.createElement('details'),summary=document.createElement('summary');
  menu.className='more-school';menu.append(summary);
  const navs=[...document.querySelectorAll('#sidebar nav')];
  if(navs.length){navs[0].after(menu);for(const nav of navs.slice(1)){const heading=nav.previousElementSibling;if(heading?.classList.contains('nav-label'))menu.append(heading);menu.append(nav);}}
  const more=document.createElement('details'),moreTitle=document.createElement('summary');more.append(moreTitle);more.className='more-school';
  const secondary=navs[0]?[...navs[0].querySelectorAll('button')].filter(b=>['annual','reports','year','report'].includes(b.dataset.nav)):[];
  if(secondary.length){secondary[0].before(more);more.append(...secondary);}
  const cats=document.getElementById('categories'),catTitle=cats?.previousElementSibling;
  const categoriesPanel=document.createElement('details'),categoriesLabel=document.createElement('summary');categoriesPanel.className='extra-resources';
  if(cats&&catTitle?.classList.contains('section-head')){catTitle.before(categoriesPanel);categoriesPanel.append(categoriesLabel,catTitle,cats);}
  const state={materials:null,community:null};
  function serviceText(){
    moreTitle.textContent=label('Годовые планы и отчёты','Жылдық жоспарлар мен есептер');categoriesLabel.textContent=label('Все направления библиотеки','Кітапхананың барлық бағыттары');
    summary.textContent=label('Работа школы и сообщество','Мектеп жұмысы және қауымдастық');
    const items=Object.entries(state).map(([key,value])=>{
      const title=key==='materials'?label('Общая библиотека','Ортақ кітапхана'):label('Сообщество','Қауымдастық');
      return title+' — '+(value===null?label('проверяем доступ','қолжетімділік тексерілуде'):value?label('доступно для просмотра','көруге болады'):label('нет связи','байланыс жоқ'));
    });
    document.getElementById('demoNote').textContent=items.join('. ')+'.';
  }
  async function refresh(key){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
    try {const response=await fetch('/api/'+key,{signal:controller.signal,cache:'no-store'});state[key]=response.ok&&Array.isArray(await response.json());}
    catch{state[key]=false;}finally{clearTimeout(timer);serviceText();}
  }
  function check(){for(const key of Object.keys(state))refresh(key);}
  serviceText();check();window.addEventListener('online',check);window.addEventListener('offline',()=>{state.materials=state.community=false;serviceText();});
  document.getElementById('langBtn').addEventListener('click',()=>setTimeout(()=>{review();serviceText();},0));
})();
