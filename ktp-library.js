(() => {
  const planner = document.getElementById('plannerOpenBtn');
  if (!planner) return;
  const element = (tag, text) => Object.assign(document.createElement(tag), {textContent: text || ''});
  const open = element('button');
  open.type = 'button';
  open.className = planner.className;
  planner.after(open);
  const russian = () => localStorage.getItem('ustaz-lang') === 'ru';
  const refresh = () => { open.textContent = russian() ? 'КТП по предметам' : 'Пәндер бойынша КТЖ'; };
  refresh();
  new MutationObserver(refresh).observe(planner, {childList:true, subtree:true,characterData:true});
  let library;
  open.onclick = async () => {
    const t = (ru, kk) => russian() ? ru : kk;
    const dialog = element('dialog');
    dialog.style.cssText='width:min(1100px,96vw);max-height:90vh;margin:auto;border:0;border-radius:14px;padding:20px;color:#20333a';
    const close = element('button',t('Закрыть','Жабу'));
    close.onclick = () => dialog.close();
    dialog.append(close, element('h2', t('Календарно-тематический план','Күнтізбелік-тақырыптық жоспар')));
    const status = element('p',t('Загружаем программы…','Бағдарламалар жүктелуде…'));
    status.setAttribute('role','status');
    dialog.append(status);
    document.body.append(dialog);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.showModal();
    try {
      if (!library) {
        const response = await fetch('./ktp-data.json');
        if (!response.ok) throw Error();
        library = await response.json();
      }
    } catch {
      status.textContent = t('Не удалось загрузить программы.','Бағдарламаларды жүктеу мүмкін болмады.');
      const retry = element('button',t('Повторить','Қайталау'));
      retry.onclick = () => { dialog.close(); open.click(); };
      dialog.append(retry);
      return;
    }
    if (!dialog.isConnected) return;
    status.textContent = t('Выберите программу, сверьте темы с первоисточником и расставьте часы и даты по расписанию школы.','Бағдарламаны таңдаңыз, тақырыптарды түпнұсқамен салыстырып, сағаттар мен күндерді мектеп кестесіне сай енгізіңіз.');
    const field = (ru,kk) => {
      const label = element('label',t(ru,kk)), select = element('select');
      label.style.cssText='display:inline-grid;gap:4px;margin:4px;max-width:96%';
      select.style.maxWidth='100%';
      label.append(select); dialog.append(label); return select;
    };
    const language = field('Язык программы','Бағдарлама тілі');
    language.add(new Option('Қазақша','kk')); language.add(new Option('Русский','ru'));
    language.value = russian() ? 'ru' : 'kk';
    const grade = field('Класс','Сынып'), subject = field('Предмет','Пән'), variant = field('Программа','Бағдарлама');
    const area = element('section'); dialog.append(area);
    const entries = () => library[language.value];
    function fill(select,values) { select.replaceChildren(...values.map(value=>new Option(value,value))); }
    function updateGrades() {
      fill(grade,[...new Set(entries().map(p=>p.grade))].sort((a,b)=>a-b)); updateSubjects();
    }
    function updateSubjects() {
      fill(subject,[...new Set(entries().filter(p=>p.grade===Number(grade.value)).map(p=>p.subject))].sort()); updateVariants();
    }
    function updateVariants() {
      variant.replaceChildren();
      entries().forEach((p,i)=>{if(p.subject===subject.value && p.grade===Number(grade.value)) variant.add(new Option(p.name,String(i)));});
      render();
    }
    function render() {
      area.replaceChildren();
      const plan = entries()[variant.value]; if (!plan) return;
      const ru = language.value==='ru';
      const headers = ru ? ['Четверть','Раздел','Тема','Цели обучения','Часы','Дата','Примечание'] : ['Тоқсан','Бөлім','Тақырып','Оқу мақсаттары','Сағат','Күні','Ескерту'];
      const key = 'ustaz-ktp-v1:'+JSON.stringify([language.value,plan.grade,plan.name,plan.url,plan.rows[0][2]]);
      let edits = {}; try { edits = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
      const source = element('a',t('Открыть программу №399','№399 бағдарламаны ашу'));
      source.href=plan.url; source.target='_blank'; source.rel='noopener';
      const save = element('button',t('Скачать КТП в Word','КТЖ-ны Word форматында жүктеу'));
      const note = element('p',t('Доступно строк программы: ','Бағдарлама бойынша қолжетімді жол саны: ')+plan.rows.length);
      const scroll = element('div'); scroll.style.overflow='auto';
      const table = element('table'); table.style.borderCollapse='collapse';
      const head = table.createTHead().insertRow();
      headers.forEach(v=>head.append(element('th',v)));
      const body = table.createTBody();
      plan.rows.forEach((values,i)=>{
        const row = body.insertRow();
        values.forEach(value=>{row.insertCell().textContent=value;});
        ['number','date','text'].forEach((type,j)=>{
          const input=element('input'); input.type=type;
          if(type==='number'){input.min='0'; input.step='0.5';}
          input.style.width=type==='number'?'5em':'10em';
          input.setAttribute('aria-label',headers[j+4]+' · '+values[2]);
          const id=JSON.stringify([i,values[2],j]); input.value=edits[id]||'';
          input.oninput=()=>{edits[id]=input.value; try {localStorage.setItem(key,JSON.stringify(edits)); note.textContent=t('Изменения сохранены в этом браузере.','Өзгерістер осы браузерде сақталды.');} catch {note.textContent=t('Память браузера заполнена. Скачайте документ.','Браузер жады толды. Құжатты жүктеңіз.');}};
          row.insertCell().append(input);
        });
      });
      save.onclick=()=>{
        const copy=table.cloneNode(true);
        [...copy.querySelectorAll('input')].forEach((el,i)=>el.replaceWith(document.createTextNode(table.querySelectorAll('input')[i].value)));
        const title=element('h1',plan.subject+' · '+plan.grade+' '+(ru?'класс':'сынып'));
        const html='<meta charset="utf-8"><style>body,table{font:14pt "Times New Roman"}table{border-collapse:collapse}td,th{border:1px solid;padding:4pt}</style>'+title.outerHTML+element('p',plan.name).outerHTML+copy.outerHTML;
        const url=URL.createObjectURL(new Blob(['\ufeff',html],{type:'application/msword'})), link=element('a');
        link.href=url; link.download=(ru?'КТП':'КТЖ')+' '+plan.subject+' '+plan.grade+'.doc'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),15000);
      };
      scroll.append(table); area.append(note,source,' ',save,scroll);
    }
    language.onchange=updateGrades; grade.onchange=updateSubjects; subject.onchange=updateVariants; variant.onchange=render; updateGrades();
  };
})();
