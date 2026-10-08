(function () {
  const SESSION_KEY = 'animalua.session';
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { return null; } };
  const setSession = (session) => localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const clearSession = () => localStorage.removeItem(SESSION_KEY);
  async function request(path, options = {}, retried = false) {
    const session = getSession();
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;
    const response = await fetch(path, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (response.status === 401 && session?.refresh_token && !retried) {
      try {
        const refreshed = await request('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refresh_token }) }, true);
        setSession({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || session.refresh_token, expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000, user: refreshed.user || session.user });
        return request(path, options, true);
      } catch (_) { clearSession(); }
    }
    if (response.status === 401 && !session?.refresh_token) clearSession();
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return data;
  }
  function saveSession(auth, fallback = {}) {
    if (!auth?.access_token) return false;
    const user = auth.user || {};
    const userMetadata = user.user_metadata || {};
    setSession({ access_token: auth.access_token, refresh_token: auth.refresh_token, expires_at: Date.now() + (auth.expires_in || 3600) * 1000, user: { ...user, email: user.email || fallback.email || '', user_metadata: { ...userMetadata, full_name: userMetadata.full_name || fallback.fullName || '' } } });
    return true;
  }
  window.AnimalApi = { request, saveSession, getSession, clearSession };
}());
