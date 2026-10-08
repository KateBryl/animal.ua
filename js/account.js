(function () {
  const form = document.querySelector('#auth-form');
  const switcher = document.querySelector('#auth-switch');
  const title = document.querySelector('#auth-title');
  const submit = document.querySelector('#auth-submit');
  const message = document.querySelector('#auth-message');
  let signup = false;
  function render() {
    title.textContent = signup ? 'Створити акаунт' : 'Увійти в акаунт';
    submit.textContent = signup ? 'Зареєструватися' : 'Увійти';
    switcher.textContent = signup ? 'Вже маєте акаунт? Увійти' : 'Ще немає акаунта? Зареєструватися';
    message.textContent = '';
  }
  switcher.addEventListener('click', () => { signup = !signup; render(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = 'Зачекайте…';
    try {
      const email = document.querySelector('#auth-email').value.trim();
      const password = document.querySelector('#auth-password').value;
      const result = await AnimalApi.request(signup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (!AnimalApi.saveSession(result, { email })) {
        message.textContent = 'Акаунт створено. Увімкніть вхід без підтвердження email у налаштуваннях Supabase або підтвердьте адресу й увійдіть.';
        return;
      }
      location.href = 'profile.html';
    } catch (error) {
      message.textContent = error.message || 'Не вдалося виконати запит. Перевірте підключення до сервера.';
    } finally {
      submit.disabled = false;
    }
  });
  render();
}());
