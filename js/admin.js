(function () {
  const session = AnimalApi.getSession();
  if (!session?.access_token) { location.href = 'account.html'; return; }

  const body = document.querySelector('#accounts-body');
  const message = document.querySelector('#admin-message');
  const search = document.querySelector('#account-search');
  const passwordDialog = document.querySelector('#password-dialog');
  const passwordForm = document.querySelector('#password-reset-form');
  const pageSize = 25;
  let offset = 0;
  let total = 0;
  let debounce;

  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const roleLabel = role => role === 'vet' ? 'Ветеринар' : 'Власник';
  const dateLabel = value => value ? new Date(value).toLocaleDateString('uk-UA') : '—';

  function setMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
  }

  function renderAccount(account) {
    const row = node('tr');
    const userCell = node('td');
    userCell.append(node('span', 'account-name', account.full_name || 'Без імені'), node('span', 'account-email', account.email));
    row.append(userCell);

    const roleCell = node('td');
    const role = node('select', 'account-role');
    role.setAttribute('aria-label', `Тип облікового запису: ${account.email}`);
    for (const [value, label] of [['owner','Власник тварини'],['vet','Ветеринар']]) {
      const option = node('option', '', label); option.value = value; role.append(option);
    }
    role.value = account.role;
    role.dataset.previous = account.role;
    roleCell.append(role); row.append(roleCell);

    const statusCell = node('td');
    const status = node('span', `account-status${account.is_active ? '' : ' is-inactive'}`, account.is_active ? 'Активний' : 'Вимкнений');
    statusCell.append(status); row.append(statusCell);
    row.append(node('td', '', String(account.pets_count)));
    row.append(node('td', '', dateLabel(account.created_at)));

    const actionCell = node('td');
    const isCurrentAccount = account.id === session.user?.id;
    const action = node('button', 'account-action', isCurrentAccount ? 'Ваш акаунт' : account.is_active ? 'Деактивувати' : 'Активувати');
    action.type = 'button'; action.disabled = isCurrentAccount;
    action.setAttribute('aria-label', isCurrentAccount ? `Не можна вимкнути власний акаунт: ${account.email}` : `${account.is_active ? 'Деактивувати' : 'Активувати'} ${account.email}`);
    action.dataset.action = 'toggle-active'; action.dataset.id = account.id;
    action.dataset.active = String(account.is_active); action.dataset.email = account.email;
    const actions = node('div','account-actions');
    actions.append(action);
    const resetPassword = node('button','account-action','Змінити пароль');
    resetPassword.type = 'button';
    resetPassword.dataset.action = 'reset-password'; resetPassword.dataset.id = account.id;
    resetPassword.dataset.email = account.email;
    resetPassword.setAttribute('aria-label',`Змінити пароль для ${account.email}`);
    actions.append(resetPassword); actionCell.append(actions); row.append(actionCell);

    role.addEventListener('change', async () => {
      role.disabled = true; setMessage(`Оновлюю тип облікового запису ${account.email}…`);
      try {
        await AnimalApi.request(`/api/admin/accounts/${account.id}`, { method:'PATCH', body:JSON.stringify({role:role.value}) });
        role.dataset.previous = role.value; setMessage('Тип облікового запису оновлено.'); await loadAudit();
      } catch (error) { role.value = role.dataset.previous; setMessage(error.message, true); }
      finally { role.disabled = false; }
    });
    return row;
  }

  async function loadAccounts() {
    setMessage('Завантажую облікові записи…');
    try {
      const params = new URLSearchParams({limit:String(pageSize),offset:String(offset)});
      if (search.value.trim()) params.set('q', search.value.trim());
      const data = await AnimalApi.request(`/api/admin/accounts?${params}`);
      total = data.total;
      document.querySelector('#stat-total').textContent = data.summary.total;
      document.querySelector('#stat-active').textContent = data.summary.active;
      document.querySelector('#stat-vets').textContent = data.summary.vets;
      body.replaceChildren(...data.accounts.map(renderAccount));
      if (!data.accounts.length) {
        const emptyRow = node('tr'), emptyCell = node('td','admin-empty','Облікових записів не знайдено.');
        emptyCell.colSpan = 6; emptyRow.append(emptyCell); body.append(emptyRow);
      }
      setMessage(data.total ? `Знайдено облікових записів: ${data.total}.` : 'Облікових записів ще немає.');
      document.querySelector('#page-label').textContent = data.total ? `${offset + 1}–${Math.min(offset + data.accounts.length,total)} із ${total}` : '0 записів';
      document.querySelector('#previous-page').disabled = offset === 0;
      document.querySelector('#next-page').disabled = offset + pageSize >= total;
    } catch (error) {
      setMessage(error.message, true);
      if (/admin access|required|403/i.test(error.message)) {
        body.replaceChildren();
        setMessage('Ця сторінка доступна лише адміністратору. Якщо ви щойно отримали права, оновіть профіль після повторного входу.', true);
      }
    }
  }

  function auditDescription(event) {
    if (event.action === 'account.password_changed') return 'пароль змінено; активні сеанси завершено';
    const changes = event.details || {};
    const parts = [];
    if (changes.role) parts.push(`тип: ${roleLabel(changes.role.from)} → ${roleLabel(changes.role.to)}`);
    if (changes.is_active) parts.push(`доступ: ${changes.is_active.from ? 'активний' : 'вимкнений'} → ${changes.is_active.to ? 'активний' : 'вимкнений'}`);
    return parts.join(' · ') || 'Зміна облікового запису';
  }

  async function loadAudit() {
    const list = document.querySelector('#audit-list');
    try {
      const data = await AnimalApi.request('/api/admin/audit?limit=20');
      if (!data.events.length) { list.replaceChildren(node('p','admin-empty','Змін поки немає.')); return; }
      list.replaceChildren(...data.events.map(event => {
        const row = node('article','audit-row');
        row.append(node('time','audit-date',new Date(event.created_at).toLocaleString('uk-UA')));
        const description = node('div','audit-description',`${event.target_email || 'Видалений обліковий запис'} — ${auditDescription(event)}`);
        description.append(node('span','audit-actor',`Адміністратор: ${event.actor_email || 'обліковий запис видалено'}`));
        row.append(description,node('span','audit-change',event.action === 'account.password_changed' ? 'Пароль' : event.action)); return row;
      }));
    } catch (error) { list.replaceChildren(node('p','admin-message is-error',`Не вдалося завантажити історію змін: ${error.message}`)); }
  }

  body.addEventListener('click', async event => {
    const resetButton = event.target.closest('[data-action="reset-password"]');
    if (resetButton) {
      document.querySelector('#password-dialog-account').textContent = resetButton.dataset.email;
      document.querySelector('#password-dialog-message').textContent = '';
      passwordDialog.dataset.accountId = resetButton.dataset.id;
      passwordForm.reset(); passwordDialog.showModal();
      document.querySelector('#password-reset-value').focus();
      return;
    }
    const button = event.target.closest('[data-action="toggle-active"]');
    if (!button || button.disabled) return;
    const isActive = button.dataset.active === 'true';
    const next = !isActive;
    const verb = next ? 'активувати' : 'деактивувати';
    if (!window.confirm(`Підтвердити: ${verb} обліковий запис ${button.dataset.email}?${next ? '' : '\nУсі його активні сесії буде завершено.'}`)) return;
    button.disabled = true;
    try {
      await AnimalApi.request(`/api/admin/accounts/${button.dataset.id}`, {method:'PATCH',body:JSON.stringify({is_active:next})});
      setMessage(`Обліковий запис ${button.dataset.email} ${next ? 'активовано' : 'деактивовано'}.`);
      await Promise.all([loadAccounts(),loadAudit()]);
    } catch (error) { setMessage(error.message,true); button.disabled = false; }
  });

  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.querySelector('#password-reset-value').value;
    const confirmation = document.querySelector('#password-reset-confirm').value;
    const status = document.querySelector('#password-dialog-message');
    const submit = passwordForm.querySelector('[type="submit"]');
    if (password !== confirmation) { status.textContent = 'Паролі не збігаються.'; return; }
    submit.disabled = true; status.textContent = 'Змінюю пароль…';
    try {
      await AnimalApi.request(`/api/admin/accounts/${passwordDialog.dataset.accountId}/password`, {method:'POST',body:JSON.stringify({newPassword:password})});
      const email = document.querySelector('#password-dialog-account').textContent;
      const keptCurrentSession = passwordDialog.dataset.accountId === session.user?.id;
      passwordDialog.close(); passwordForm.reset(); setMessage(`Пароль для ${email} змінено. ${keptCurrentSession ? 'Поточний сеанс збережено.' : 'Попередні сеанси завершено.'}`);
      await loadAudit();
    } catch (error) { status.textContent = error.message || 'Не вдалося змінити пароль.'; }
    finally { submit.disabled = false; }
  });
  document.querySelector('#password-dialog-cancel').addEventListener('click', () => passwordDialog.close());
  passwordDialog.addEventListener('close', () => { passwordForm.reset(); passwordDialog.dataset.accountId = ''; });

  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { offset = 0; loadAccounts(); },250); });
  document.querySelector('#previous-page').addEventListener('click', () => { offset = Math.max(0,offset-pageSize); loadAccounts(); });
  document.querySelector('#next-page').addEventListener('click', () => { if(offset+pageSize<total){offset+=pageSize;loadAccounts();} });
  document.querySelector('#logout').addEventListener('click', async () => {
    try { await AnimalApi.request('/api/auth/logout',{method:'POST',body:'{}'}); } catch (_) {}
    AnimalApi.clearSession(); location.href='index.html';
  });

  Promise.all([loadAccounts(),loadAudit()]);
}());
