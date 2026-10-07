(function () {
  const node = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls || ''; if (text != null) el.textContent = text; return el; };
  const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function confirmAction(message) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const dialog = node('dialog', 'pet-confirm');
      dialog.setAttribute('aria-label', message);
      dialog.append(node('div', 'confirm-icon', '?'), node('h3', '', message));
      const actions = node('div', 'confirm-actions');
      const no = node('button', 'button button-ghost', 'Ні'); const yes = node('button', 'button button-primary', 'Так');
      const close = value => { dialog.close(); dialog.remove(); previous?.focus(); resolve(value); };
      no.onclick = () => close(false); yes.onclick = () => close(true);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); });
      actions.append(yes, no); dialog.append(actions); document.body.append(dialog); dialog.showModal(); yes.focus();
    });
  }
  function open(options) {
    const draft = structuredClone(options.pet);
    const pending = []; let photo = null; let busy = false; let photoVersion = 0;
    const previous = document.activeElement;
    const dialog = node('dialog', 'pet-editor'); dialog.setAttribute('aria-labelledby', 'pet-editor-title');
    const header = node('header', 'pet-editor-header');
    const heading = node('div'); heading.append(node('p', 'eyebrow', 'Картка улюбленця'));
    const title = node('h2', '', draft.id ? draft.name : 'Додати тварину'); title.id = 'pet-editor-title'; heading.append(title);
    const close = node('button', 'pet-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Закрити');
    function dismiss() { if (busy) return; dialog.close(); dialog.remove(); previous?.focus(); }
    close.onclick = dismiss; dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); }); header.append(heading, close);
    const tabs = node('div', 'pet-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Розділи картки');
    const body = node('div', 'pet-editor-body');
    const panels = ['Загальна інформація', 'Здоров’я та догляд', 'Документи'].map((label, i) => {
      const tab = node('button', 'pet-tab', label); tab.type = 'button'; tab.id = `pet-tab-${i}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `pet-panel-${i}`);
      const panel = node('section', 'pet-panel'); panel.id = `pet-panel-${i}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
      tab.onclick = () => activate(i); tab.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); activate(event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : 2)) % 3, true); } };
      tabs.append(tab); body.append(panel); return panel;
    });
    function activate(index, focus) { [...tabs.children].forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; panels[i].hidden = i !== index; }); if (focus) tabs.children[index].focus(); }
    const general = node('div', 'pet-field-grid'); const healthFields = node('div', 'pet-field-grid pet-health-fields');
    const controls = [];
    function field(container, key, labelText, type = 'text', care = false) {
      const label = node('label', type === 'textarea' ? 'pet-wide' : '', labelText);
      const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
      if (type === 'select') ['', 'Самець', 'Самка'].forEach(value => { const option = node('option', '', value || 'Не вказано'); option.value = value; input.append(option); });
      else if (type !== 'textarea') input.type = type;
      if (key === 'name') input.required = true;
      if (key === 'weight') { input.min = '0'; input.step = '0.01'; }
      if (key === 'chip') { input.pattern = '[0-9]{15}'; input.maxLength = 15; input.inputMode = 'numeric'; input.title = 'Рівно 15 цифр'; input.placeholder = 'Номер чипа — 15 цифр'; }
      input.value = (care ? draft.care[key] : draft[key]) ?? ''; controls.push({ input, key, care }); label.append(input); container.append(label);
    }
    const photoArea = node('div', 'pet-photo-area'); const preview = node('div', 'pet-photo-preview', 'Фото улюбленця');
    if (draft.photo_path) options.signedUrl(draft.photo_path).then(url => { if (photoVersion) return; preview.style.backgroundImage = `url("${url}")`; preview.textContent = ''; }).catch(() => {});
    const photoLabel = node('label', 'button button-outline', 'Обрати фото'); const photoInput = node('input'); photoInput.type = 'file'; photoInput.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'; photoInput.className = 'pet-file-input'; photoLabel.append(photoInput);
    const photoRemove = node('button', 'pet-photo-remove', 'Видалити фото'); photoRemove.type = 'button'; photoRemove.disabled = !draft.photo_path;
    photoRemove.onclick = async () => { if (!await confirmAction('Дійсно бажаєте видалити фото?')) return; photoVersion++; photo = null; draft.photo_path = null; photoInput.value = ''; preview.style.backgroundImage = ''; preview.textContent = 'Фото улюбленця'; photoRemove.disabled = true; status.textContent = 'Фото буде видалено після збереження картки.'; };
    photoInput.onchange = async () => { const file = photoInput.files[0]; if (!file) return; try { const supported = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || ((!file.type || file.type === 'application/octet-stream') && /\.(png|jpe?g|webp)$/i.test(file.name)); if (!supported || file.size > 5 * 1024 * 1024) throw new Error('Оберіть JPEG, PNG або WebP до 5 МБ.'); const version = ++photoVersion; const data = await options.imageData(file); if (version !== photoVersion) return; photo = data; preview.style.backgroundImage = `url("${photo}")`; preview.textContent = ''; photoRemove.disabled = false; status.textContent = ''; } catch (error) { status.textContent = error.message || 'Не вдалося прочитати зображення.'; } };
    const photoActions = node('div', 'pet-photo-actions'); photoActions.append(photoLabel, photoRemove);
    photoArea.append(preview, photoActions, node('small', '', 'JPEG, PNG або WebP · до 5 МБ')); panels[0].append(photoArea, general);
    [['name','Кличка'],['species','Вид'],['breed','Порода'],['sex','Стать','select'],['birthDate','Дата народження','date'],['weight','Вага, кг','number'],['chip','Номер чипа'],['color','Колір / особливі ознаки']].forEach(args => field(general, ...args));
    field(healthFields, 'vaccination', 'Остання вакцинація', 'date');
    [['allergies','Алергії'],['chronic_conditions','Захворювання та хронічні стани'],['medications','Ліки та лікування'],['special_needs','Особливі потреби'],['diet','Харчування'],['behavior','Особливості поведінки']].forEach(([key,label]) => field(healthFields,key,label,'textarea',true));
    field(healthFields,'notes','Додаткові нотатки','textarea'); panels[1].append(healthFields);
    panels[2].append(node('h3','','Документи тварини'),node('p','pet-muted','Ветеринарні довідки, результати обстежень та інші файли. PDF, Word (.doc, .docx) · до 10 МБ.'));
    const docList = node('div'); const docLabel = node('label','button button-outline','＋ Додати документи'); const docInput = node('input','pet-file-input'); docInput.type = 'file'; docInput.multiple = true; docInput.accept = '.pdf,.doc,.docx'; docLabel.append(docInput);
    function paintDocs() { docList.replaceChildren(); [...draft.care.documents,...pending].forEach(doc => { const row = node('div','pet-record-row'); const link = node(doc.path ? 'a' : 'span','',doc.name); if (doc.path) { link.target = '_blank'; link.rel = 'noopener'; options.signedUrl(doc.path,'/api/documents/signed-url').then(url => { link.href = url; }).catch(() => {}); } else link.append(node('small','pet-muted',' · буде завантажено після збереження')); const remove = node('button','care-remove','Прибрати'); remove.onclick = () => { const array = doc.path ? draft.care.documents : pending; array.splice(array.indexOf(doc),1); paintDocs(); }; row.append(link,remove); docList.append(row); }); if (!docList.children.length) docList.append(node('p','pet-muted','Документів поки немає')); }
    docInput.onchange = () => { for (const file of docInput.files) { if (!/\.(pdf|doc|docx)$/i.test(file.name) || file.size > 10 * 1024 * 1024) { status.textContent = 'Оберіть PDF або Word до 10 МБ.'; continue; } pending.push({name:file.name,file}); } docInput.value = ''; paintDocs(); };
    panels[2].append(docLabel,docList); paintDocs();
    const footer = node('footer','pet-editor-footer'); const status = node('p','form-message'); status.setAttribute('role','status');
    const actions = node('div','pet-editor-actions'); const remove = node('button','button button-ghost','Видалити'); const save = node('button','button button-primary','Зберегти');
    function lock(value) { busy = value; save.disabled = remove.disabled = close.disabled = value; body.inert = value; tabs.inert = value; }
    save.onclick = async () => {
      for (const {input,key,care} of controls) { if (!input.checkValidity()) { activate(panels[0].contains(input) ? 0 : 1); input.reportValidity(); return; } (care ? draft.care : draft)[key] = input.value.trim(); }
      if (!await confirmAction('Зберегти зміни?')) return;
      lock(true); status.textContent = 'Зберігаю…';
      try {
        if (photo) { const result = await AnimalApi.request('/api/photos',{method:'POST',body:JSON.stringify({dataUrl:photo})}); draft.photo_path = result.path; photo = null; }
        while (pending.length) { const doc = pending[0]; let dataUrl = await options.fileData(doc.file); const mime = /\.docx$/i.test(doc.name) ? word : /\.doc$/i.test(doc.name) ? 'application/msword' : 'application/pdf'; dataUrl = dataUrl.replace(/^data:[^;]*;/,`data:${mime};`); const result = await AnimalApi.request('/api/documents',{method:'POST',body:JSON.stringify({dataUrl})}); draft.care.documents.push({name:doc.name,path:result.path,date:new Date().toISOString().slice(0,10)}); pending.shift(); }
        await options.save(draft); lock(false); dismiss();
      } catch (error) { status.textContent = `Не вдалося зберегти: ${error.message}`; lock(false); }
    };
    remove.onclick = async () => { if (!await confirmAction('Дійсно бажаєте видалити?')) return; lock(true); try { await options.remove(); lock(false); dismiss(); } catch (error) { status.textContent = error.message; lock(false); } };
    actions.append(remove,save); footer.append(status,actions); dialog.append(header,tabs,body,footer); document.body.append(dialog); activate(0); dialog.showModal(); close.focus();
  }
  window.AnimalPetEditor = { open };
}());
