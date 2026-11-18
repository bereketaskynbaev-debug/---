(()=>{
  const language=()=>localStorage.getItem('ustaz-lang')==='ru'?'ru':'kk';
  const direct={
    ubaFinder:lang=>`https://uba.edu.kz/${lang==='ru'?'ru':'qaz'}/metodology/3?page=1`,
    bookFinder:lang=>`https://www.gov.kz/org/edu/documents/details/892700?lang=${lang}`,
    programFinder:lang=>`https://adilet.zan.kz/${lang==='ru'?'rus':'kaz'}/docs/V2200029767`,
    communityFinder:()=> 'https://ziatker.kz/materials',
    videoFinder:lang=>`https://bilimland.kz/${lang==='ru'?'ru':'kk'}/teacher-page`,
    directEbooks:lang=>`https://www.gov.kz/org/edu/documents/details/892700?lang=${lang}`
  };
  function updateLinks(){const lang=language();for(const [id,getUrl] of Object.entries(direct)){const link=document.getElementById(id);if(link)link.href=getUrl(lang)}
    document.querySelectorAll('a[href^="https://bilimland-prod.bilimland.com/"]').forEach(a=>a.href='https://bilimland.kz/kk/plans');
    document.querySelectorAll('a[href*="/documents/details/734002"]').forEach(a=>a.href=`https://www.gov.kz/org/edu/documents/details/892700?lang=${lang}`);
    document.querySelectorAll('#sourceGrid a[href="https://uba.edu.kz/"]').forEach(a=>a.href=direct.ubaFinder(lang));
    document.querySelectorAll('a[href*="adilet.zan.kz/"]').forEach(a=>{a.href=a.href.replace(/\/(kaz|rus)\/docs\//,`/${lang==='ru'?'rus':'kaz'}/docs/`)});
    if(typeof openResources!=='undefined'){
      for(const item of openResources){if(item.url&&item.url.includes('adilet.zan.kz/'))item.url=item.url.replace(/\/(kaz|rus)\/docs\//,`/${lang==='ru'?'rus':'kaz'}/docs/`)}
      const sources=[
        [x=>x.kk.includes('ҰБА'),lang==='ru'?'https://uba.edu.kz/ru/metodology/3?page=1':'https://uba.edu.kz/qaz/metodology/3?page=1'],
        [x=>x.kk.includes('Оқулықтар мен оқу-әдістемелік'),`https://www.gov.kz/org/edu/documents/details/892700?lang=${lang}`],
        [x=>x.kk.includes('YouTube'),`https://bilimland.kz/${lang==='ru'?'ru':'kk'}/teacher-page`]
      ];for(const [match,url] of sources){const item=openResources.find(match);if(item){item.url=url;delete item.dynamic}}
    }
    if(typeof renderOpenCatalog==='function')renderOpenCatalog();
    const oldText=document.getElementById('videoFinder');if(oldText)oldText.title=lang==='ru'?'Видео и материалы для учителей на BilimLand':'BilimLand мұғалімдерге арналған видео және материалдар';
  }
  const original=window.renderMaterialFinder;
  if(typeof original==='function')window.renderMaterialFinder=function(){const result=original.apply(this,arguments);updateLinks();return result};
  const langButton=document.getElementById('langBtn');if(langButton){const onClick=langButton.onclick;langButton.onclick=function(event){if(onClick)onClick.call(this,event);setTimeout(updateLinks,0)}}
  updateLinks();
})();
