(function () {
  const session = AnimalApi.getSession();
  if (!session?.access_token) { location.href = 'account.html'; return; }
  const list = document.querySelector('#animals-list');
  const empty = document.querySelector('#animals-empty');
  const noResults = document.querySelector('#animals-no-results');
  const search = document.querySelector('#animal-search');
  const avatar = document.querySelector('.owner-avatar');
  avatar.id = 'owner-avatar';
  avatar.replaceChildren();
  const authUser = session.user || {};
  const userMetadata = authUser.user_metadata || authUser.userMetadata || {};
  const authName = userMetadata.full_name || userMetadata.name || authUser.email?.split('@')[0] || '';
  let profile = { full_name: authName, email: authUser.email || '', phone: '', role: 'owner', avatar_path: null, emergency_contact: '', schema_updated: false };
  let pets = [];

  const blankCare = () => ({ special_needs: '', allergies: '', chronic_conditions: '', medications: '', diet: '', behavior: '', health_records: [], vaccinations: [], reminders: [], documents: [] });
  const careCacheKey = `animalua.care-cache.${authUser.id || authUser.email || 'guest'}`;
  function readCareCache() { try { return JSON.parse(localStorage.getItem(careCacheKey) || '{}'); } catch (_) { return {}; } }
  function writeCareCache(pet) { try { const cache = readCareCache(); cache[pet.id] = pet.care; localStorage.setItem(careCacheKey, JSON.stringify(cache)); } catch (_) {} }
  async function signedUrl(path, route = '/api/photos/signed-url') {
    if (!path) return '';
    const result = await AnimalApi.request(route, { method: 'POST', body: JSON.stringify({ path }) });
    return result.url;
  }
  function imageData(file, maxSize = 1000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function fileData(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }
  async function uploadPhoto(file) {
    const result = await AnimalApi.request('/api/photos', { method: 'POST', body: JSON.stringify({ dataUrl: await imageData(file) }) });
    return result.path;
  }
  async function uploadPhotoData(dataUrl) {
    const result = await AnimalApi.request('/api/photos', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    return result.path;
  }
  async function deletePhoto(path) { if (path) await AnimalApi.request('/api/photos/delete', { method: 'POST', body: JSON.stringify({ path }) }); }
  function paintOwner() {
    document.querySelector('#owner-name').value = profile.full_name || authName;
    document.querySelector('#owner-email').value = profile.email || '';
    document.querySelector('#owner-phone').value = profile.phone || '';
    document.querySelector('#owner-role').value = profile.role || 'owner';
    document.querySelector('#owner-summary-name').textContent = profile.full_name || authName || 'Ваш профіль';
    document.querySelector('#owner-summary-role').textContent = profile.role === 'vet' ? 'Ветеринарна установа' : 'Власник тварини';
  }
  async function paintOwnerPhoto() {
    if (!profile?.avatar_path) { avatar.style.backgroundImage = ''; if (avatarDelete) avatarDelete.hidden = true; return; }
    avatar.style.backgroundImage = `url("${await signedUrl(profile.avatar_path)}")`;
    if (avatarDelete) avatarDelete.hidden = false;
  }
  const avatarInput = document.createElement('input');
  avatarInput.type = 'file'; avatarInput.accept = 'image/jpeg,image/png,image/webp'; avatarInput.className = 'owner-photo-input'; avatarInput.setAttribute('aria-label', 'Змінити фото користувача'); avatarInput.title = 'Змінити фото користувача';
  avatar.classList.add('owner-avatar-upload'); avatar.appendChild(avatarInput);
  const avatarDelete = element('button', 'photo-delete-button', 'Видалити фото'); avatarDelete.type = 'button'; avatarDelete.hidden = true; avatar.parentElement.appendChild(avatarDelete);
  avatarDelete.addEventListener('click', async () => { if (!profile.avatar_path || !await confirmDelete('фото користувача')) return; const message = document.querySelector('#owner-message'); try { await deletePhoto(profile.avatar_path); profile.avatar_path = null; await saveOwner(); await paintOwnerPhoto(); message.textContent = 'Фото користувача видалено.'; } catch (error) { message.textContent = `Не вдалося видалити фото: ${error.message}`; } });
  avatarInput.addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const message = document.querySelector('#owner-message');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { message.textContent = 'Оберіть зображення JPEG, PNG або WebP.'; return; }
    if (file.size > 5 * 1024 * 1024) { message.textContent = 'Розмір фото має бути не більше 5 МБ.'; return; }
    message.textContent = 'Завантажую фото…';
    try { profile.avatar_path = await uploadPhoto(file); await saveOwner(); await paintOwnerPhoto(); avatarDelete.hidden = false; message.textContent = 'Фото збережено.'; }
    catch (error) { message.textContent = error.message; }
  });
  async function saveOwner() {
    profile = await AnimalApi.request('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: document.querySelector('#owner-name').value.trim(), phone: document.querySelector('#owner-phone').value.trim(), role: document.querySelector('#owner-role').value, avatar_path: profile.avatar_path || null }) });
    paintOwner();
  }
  document.querySelector('#owner-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const message = document.querySelector('#owner-message'); message.textContent = 'Зберігаю…';
    try { await saveOwner(); message.textContent = profile.schema_updated ? 'Інформацію збережено.' : 'Основні дані збережено. Для збереження контактної особи та нових даних тварин виконайте оновлену схему Supabase.'; } catch (error) { message.textContent = error.message; }
  });

  function fromApi(pet) { const cached = readCareCache()[pet.id] || {}; return { id: pet.id, name: pet.name || '', species: pet.species || '', breed: pet.breed || '', sex: pet.sex || '', birthDate: pet.birth_date || '', color: pet.color || '', weight: pet.weight ?? '', chip: pet.chip_number || '', vaccination: pet.last_vaccination || '', notes: pet.notes || '', photo_path: pet.photo_path || null, care: { ...blankCare(), ...cached, ...(pet.care_data || {}) } }; }
  function toApi(pet) { return { name: pet.name, species: pet.species, breed: pet.breed, sex: pet.sex, birth_date: pet.birthDate || null, color: pet.color, weight: pet.weight, chip_number: pet.chip, last_vaccination: pet.vaccination || null, notes: pet.notes, photo_path: pet.photo_path || null, care_data: pet.care || blankCare() }; }
  const safeDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('uk-UA') : 'Без дати';
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
  function confirmDelete(name) {
    return new Promise(resolve => {
      const overlay = element('div', 'confirm-overlay');
      const dialog = element('div', 'confirm-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.append(element('div', 'confirm-icon', '!'), element('h3', '', 'Підтвердити видалення'), element('p', '', `Точно видалити тварину «${name || 'без назви'}»?`));
      const actions = element('div', 'confirm-actions'); const cancel = element('button', 'button button-ghost', 'Скасувати'); const remove = element('button', 'button button-primary', 'Видалити');
      cancel.type = 'button'; remove.type = 'button'; actions.append(cancel, remove); dialog.append(actions); overlay.append(dialog); document.body.append(overlay);
      const close = value => { overlay.remove(); resolve(value); };
      cancel.addEventListener('click', () => close(false)); remove.addEventListener('click', () => close(true)); overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
      remove.focus();
    });
  }
  function currentPets() {
    const query = search.value.trim().toLocaleLowerCase('uk');
    const matches = pets.map((pet, index) => ({ pet, index })).filter(({ pet }) => !query || [pet.name, pet.species, pet.breed, pet.chip].some(value => String(value || '').toLocaleLowerCase('uk').includes(query)));
    empty.hidden = pets.length > 0;
    noResults.hidden = pets.length === 0 || matches.length > 0;
    return matches;
  }
  async function renderAnimals() {
    list.replaceChildren();
    currentPets().forEach(({ pet, index }) => {
      const card = element('article', 'animal-card');
      const row = element('button', 'animal-row'); row.type = 'button'; row.setAttribute('aria-haspopup', 'dialog');
      const image = element('span', 'animal-photo'); const meta = element('span', 'animal-row-main');
      meta.append(element('strong', '', pet.name), element('small', '', [pet.species, pet.breed].filter(Boolean).join(' · ')));
      row.append(image, meta, element('span', 'animal-row-chip', pet.chip ? `Чип: ${pet.chip}` : ''), element('span', '', '↗'));
      if (pet.photo_path) signedUrl(pet.photo_path).then(url => { image.style.backgroundImage = `url("${url}")`; }).catch(() => {});
      row.addEventListener('click', () => openEditor(pet, index)); card.append(row); list.append(card);
    });
  }
  function openEditor(pet, index) {
    AnimalPetEditor.open({ pet, signedUrl, imageData, fileData,
      save: async draft => {
        const saved = await AnimalApi.request(draft.id ? `/api/pets/${draft.id}` : '/api/pets', { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(toApi(draft)) });
        if (!saved.care_data || draft.care.documents.some(doc => !saved.care_data.documents?.some(stored => stored.path === doc.path))) throw new Error('Сервер не підтвердив збереження документів. Оновіть схему Supabase та повторіть спробу.');
        const updated = fromApi(saved); writeCareCache(updated);
        if (index == null) pets.push(updated); else pets[index] = updated;
        if (pet.photo_path && pet.photo_path !== draft.photo_path) { try { await deletePhoto(pet.photo_path); } catch (_) { document.querySelector('#owner-message').textContent = 'Картку збережено, але старий файл фото не вдалося видалити зі сховища.'; } }
        await renderAnimals();
      },
      remove: async () => { if (pet.id) await AnimalApi.request(`/api/pets/${pet.id}`, { method: 'DELETE' }); if (index != null) pets.splice(index, 1); await renderAnimals(); }
    });
  }
  search.addEventListener('input', () => renderAnimals());
  document.querySelector('#add-animal').addEventListener('click', () => openEditor({ name: '', species: '', breed: '', sex: '', birthDate: '', color: '', weight: '', chip: '', vaccination: '', notes: '', photo_path: null, care: blankCare() }));
  document.querySelector('#logout').addEventListener('click', async () => { try { await AnimalApi.request('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {} AnimalApi.clearSession(); location.href = 'index.html'; });
  (async () => {
    try {
      const results = await Promise.allSettled([AnimalApi.request('/api/profile'), AnimalApi.request('/api/pets')]);
      if (!AnimalApi.getSession()) { location.href = 'account.html'; return; }
      if (results[0].status === 'fulfilled') {
        profile = { ...profile, ...results[0].value, full_name: results[0].value.full_name || authName, email: results[0].value.email || authUser.email || '' };
        paintOwner();
        try { await paintOwnerPhoto(); } catch (error) { document.querySelector('#owner-message').textContent = `Не вдалося показати фото: ${error.message}`; }
      } else {
        document.querySelector('#owner-message').textContent = `Не вдалося завантажити збережені дані: ${results[0].reason.message}. Ім’я та email показані з акаунта.`;
      }
      if (results[1].status === 'fulfilled') pets = results[1].value.map(fromApi);
      else document.querySelector('#owner-message').textContent = `Не вдалося завантажити тварин: ${results[1].reason.message}`;
      if (!profile.schema_updated && !document.querySelector('#owner-message').textContent) document.querySelector('#owner-message').textContent = 'Базові дані працюють. Щоб зберігати контакт довіри та нові записи про тварин, виконайте оновлену схему Supabase.';
      await renderAnimals();
    } catch (error) {
      if (!AnimalApi.getSession()) { location.href = 'account.html'; return; }
      document.querySelector('#owner-message').textContent = `Не вдалося завантажити дані: ${error.message}`;
      paintOwner();
      await renderAnimals();
    }
  })();
}());
