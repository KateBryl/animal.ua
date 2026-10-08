const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const PHOTO_BUCKET = 'animal-photos';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

async function readJson(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

function tokenFrom(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function supabase(pathname, options = {}, token = '') {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw Object.assign(new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.'), { status: 503 });
  const headers = { apikey: SUPABASE_KEY, 'content-type': 'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { ...options, headers });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = payload && (payload.msg || payload.message || payload.error_description || payload.error) || `Supabase request failed (${response.status})`;
    const authExpired = /invalid jwt|token.*expired|jwt.*expired/i.test(message);
    throw Object.assign(new Error(message), { status: response.status === 401 || authExpired ? 401 : 400 });
  }
  return payload;
}

async function currentUser(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error('Sign in required'), { status: 401 });
  const user = await supabase('/auth/v1/user', { method: 'GET' }, token);
  return { token, user };
}

async function ensureProfile(user, token) {
  const metadata = user.user_metadata || {};
  const profile = {
    id: user.id,
    full_name: String(metadata.full_name || '').slice(0, 160),
    role: metadata.role === 'vet' ? 'vet' : 'owner'
  };
  await supabase('/rest/v1/profiles?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(profile)
  }, token);
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true });

  if (req.method === 'POST' && route === '/api/auth/signup') {
    const body = await readJson(req);
    const data = await supabase('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: body.email, password: body.password, data: { full_name: body.fullName || '' } }) });
    return json(res, 200, data);
  }
  if (req.method === 'POST' && route === '/api/auth/login') {
    const body = await readJson(req);
    const data = await supabase('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: body.email, password: body.password }) });
    return json(res, 200, data);
  }
  if (req.method === 'POST' && route === '/api/auth/refresh') {
    const body = await readJson(req);
    const data = await supabase('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: body.refreshToken }) });
    return json(res, 200, data);
  }
  if (req.method === 'POST' && route === '/api/auth/logout') {
    const { token } = await currentUser(req);
    await supabase('/auth/v1/logout', { method: 'POST' }, token);
    return json(res, 200, { ok: true });
  }

  if (route.startsWith('/api/')) {
    const { token, user } = await currentUser(req);
    const ownerId = user.id;
    if (req.method === 'GET' && route === '/api/profile') {
      await ensureProfile(user, token);
      let schemaUpdated = true;
      let rows;
      try { rows = await supabase(`/rest/v1/profiles?select=id,full_name,phone,role,avatar_path,emergency_contact&id=eq.${encodeURIComponent(ownerId)}`, { method: 'GET' }, token); }
      catch (error) {
        if (!/emergency_contact|column .* does not exist/i.test(error.message)) throw error;
        schemaUpdated = false;
        rows = await supabase(`/rest/v1/profiles?select=id,full_name,phone,role,avatar_path&id=eq.${encodeURIComponent(ownerId)}`, { method: 'GET' }, token);
      }
      const profile = rows[0] || { id: ownerId, full_name: user.user_metadata?.full_name || '', phone: '', role: 'owner', avatar_path: null, emergency_contact: '' };
      return json(res, 200, { ...profile, emergency_contact: profile.emergency_contact || '', schema_updated: schemaUpdated, email: user.email });
    }
    if (req.method === 'PATCH' && route === '/api/profile') {
      const body = await readJson(req);
      const record = { id: ownerId, full_name: String(body.full_name || '').slice(0, 160), phone: String(body.phone || '').slice(0, 40), role: body.role === 'vet' ? 'vet' : 'owner', avatar_path: body.avatar_path || null, emergency_contact: String(body.emergency_contact || '').slice(0, 240), updated_at: new Date().toISOString() };
      let schemaUpdated = true;
      let rows;
      try { rows = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) }, token); }
      catch (error) {
        if (!/emergency_contact|column .* does not exist/i.test(error.message)) throw error;
        schemaUpdated = false;
        delete record.emergency_contact;
        rows = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) }, token);
      }
      if (!rows.length) {
        try { rows = await supabase('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) }, token); }
        catch (error) {
          if (!/emergency_contact|column .* does not exist/i.test(error.message)) throw error;
          schemaUpdated = false;
          delete record.emergency_contact;
          rows = await supabase('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) }, token);
        }
      }
      return json(res, 200, { ...rows[0], emergency_contact: rows[0].emergency_contact || body.emergency_contact || '', schema_updated: schemaUpdated, email: user.email });
    }
    if (req.method === 'GET' && route === '/api/pets') {
      const rows = await supabase(`/rest/v1/pets?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&order=created_at.asc`, { method: 'GET' }, token);
      return json(res, 200, rows);
    }
    if (req.method === 'POST' && route === '/api/pets') {
      const body = await readJson(req);
      await ensureProfile(user, token);
      const record = petRecord(body, ownerId);
      const rows = await savePetRecord(record, token, 'POST');
      return json(res, 201, rows[0]);
    }
    const petMatch = route.match(/^\/api\/pets\/([0-9a-f-]+)$/i);
    if (petMatch && req.method === 'PATCH') {
      const body = await readJson(req);
      const record = petRecord(body, ownerId);
      delete record.owner_id;
      record.updated_at = new Date().toISOString();
      const rows = await savePetRecord(record, token, 'PATCH', `/rest/v1/pets?id=eq.${encodeURIComponent(petMatch[1])}&owner_id=eq.${encodeURIComponent(ownerId)}`);
      if (!rows.length) return json(res, 404, { error: 'Pet not found' });
      return json(res, 200, rows[0]);
    }
    if (petMatch && req.method === 'DELETE') {
      await supabase(`/rest/v1/pets?id=eq.${encodeURIComponent(petMatch[1])}&owner_id=eq.${encodeURIComponent(ownerId)}`, { method: 'DELETE' }, token);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && route === '/api/photos') {
      const body = await readJson(req, 7 * 1024 * 1024);
      const match = String(body.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json(res, 400, { error: 'Upload a JPEG, PNG, or WebP image.' });
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 5 * 1024 * 1024) return json(res, 413, { error: 'Image must be 5 MB or smaller.' });
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
      const objectPath = `${ownerId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await fetch(`${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${objectPath}`, { method: 'POST', headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': match[1], 'x-upsert': 'false' }, body: bytes });
      if (!uploaded.ok) { const detail = await uploaded.text(); throw Object.assign(new Error(detail || 'Photo upload failed'), { status: uploaded.status === 401 ? 401 : 400 }); }
      return json(res, 201, { path: objectPath });
    }
    if (req.method === 'POST' && route === '/api/photos/delete') {
      const body = await readJson(req);
      const objectPath = String(body.path || '');
      if (!new RegExp(`^${ownerId}/[0-9a-f-]{36}\\.(?:jpg|png|webp)$`, 'i').test(objectPath)) return json(res, 403, { error: 'Invalid photo path.' });
      const removed = await fetch(`${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${objectPath}`, { method: 'DELETE', headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` } });
      if (!removed.ok && removed.status !== 404) { const detail = await removed.text(); throw Object.assign(new Error(detail || 'Photo delete failed'), { status: removed.status === 401 ? 401 : 400 }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && route === '/api/photos/signed-url') {
      const body = await readJson(req);
      const objectPath = String(body.path || '');
      if (!new RegExp(`^${ownerId}/[0-9a-f-]{36}\\.(?:jpg|png|webp)$`, 'i').test(objectPath)) return json(res, 403, { error: 'Invalid photo path.' });
      const result = await supabase(`/storage/v1/object/sign/${PHOTO_BUCKET}/${objectPath}`, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) }, token);
      const signed = result.signedURL || result.signedUrl;
      return json(res, 200, { url: signed.startsWith('http') ? signed : `${SUPABASE_URL}/storage/v1${signed}` });
    }
    if (req.method === 'POST' && route === '/api/documents') {
      const body = await readJson(req, 14 * 1024 * 1024);
      const match = String(body.dataUrl || '').match(/^data:(application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json(res, 400, { error: 'Оберіть PDF, Word або зображення.' });
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 10 * 1024 * 1024) return json(res, 413, { error: 'Файл має бути не більшим за 10 МБ.' });
      const ext = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
      const objectPath = `${ownerId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await fetch(`${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${objectPath}`, { method: 'POST', headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': match[1], 'x-upsert': 'false' }, body: bytes });
      if (!uploaded.ok) { const detail = await uploaded.text(); const message = /invalid_mime_type/i.test(detail) ? 'Формат документа ще не дозволений у сховищі. Застосуйте міграції Supabase для PDF та Word.' : (detail || 'Не вдалося завантажити документ.'); throw Object.assign(new Error(message), { status: uploaded.status === 401 ? 401 : 400 }); }
      return json(res, 201, { path: objectPath });
    }
    if (req.method === 'POST' && route === '/api/documents/signed-url') {
      const body = await readJson(req);
      const objectPath = String(body.path || '');
      if (!new RegExp(`^${ownerId}/[0-9a-f-]{36}\\.(?:pdf|doc|docx|jpg|png|webp)$`, 'i').test(objectPath)) return json(res, 403, { error: 'Некоректний шлях до документа.' });
      const result = await supabase(`/storage/v1/object/sign/${PHOTO_BUCKET}/${objectPath}`, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) }, token);
      const signed = result.signedURL || result.signedUrl;
      return json(res, 200, { url: signed.startsWith('http') ? signed : `${SUPABASE_URL}/storage/v1${signed}` });
    }
    return json(res, 404, { error: 'API route not found' });
  }
  return json(res, 404, { error: 'API route not found' });
}

async function savePetRecord(record, token, method, endpoint = '/rest/v1/pets') {
  const options = { method, headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) };
  try {
    return await supabase(endpoint, options, token);
  } catch (error) {
    if (!/care_data.*(column|schema cache)|column.*care_data/i.test(error.message || '')) throw error;
    throw Object.assign(new Error('Документи та дані здоров’я не збережено: база потребує оновлення. Виконайте supabase/migrations/20261007_pet_documents.sql і повторіть збереження.'), { status: 409 });
  }
}

function petRecord(body, ownerId) {
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('Вкажіть кличку тварини.'), { status: 400 });
  return { owner_id: ownerId, name, species: String(body.species || '').slice(0, 80), breed: String(body.breed || '').slice(0, 120), sex: String(body.sex || '').slice(0, 20), birth_date: body.birth_date || null, color: String(body.color || '').slice(0, 120), weight: body.weight === '' || body.weight == null ? null : Number(body.weight), chip_number: String(body.chip_number || '').slice(0, 40), last_vaccination: body.last_vaccination || null, notes: String(body.notes || '').slice(0, 4000), photo_path: body.photo_path || null, care_data: normalizeCareData(body.care_data) };
}

function normalizeCareData(value) {
  const care = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = (key) => String(care[key] || '').slice(0, 2000);
  const rows = (key) => Array.isArray(care[key]) ? care[key].slice(0, 300) : [];
  return { special_needs: text('special_needs'), allergies: text('allergies'), chronic_conditions: text('chronic_conditions'), medications: text('medications'), diet: text('diet'), behavior: text('behavior'), health_records: rows('health_records'), vaccinations: rows('vaccinations'), reminders: rows('reminders'), documents: rows('documents') };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname.split('/').some((part) => part.startsWith('.')) || pathname === '/server.js') return json(res, 404, { error: 'Not found' });
    const filename = path.resolve(ROOT, `.${pathname}`);
    if (!filename.startsWith(ROOT + path.sep) && filename !== path.join(ROOT, 'index.html')) return json(res, 403, { error: 'Forbidden' });
    let stat;
    try { stat = await fs.promises.stat(filename); } catch { return json(res, 404, { error: 'Not found' }); }
    if (!stat.isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filename).pipe(res);
  } catch (error) {
    if (req.url?.startsWith('/api/')) {
      const requestPath = req.url.split('?')[0];
      const causeCode = error.cause?.code ? ` [${error.cause.code}]` : '';
      console.error(`[api] ${req.method} ${requestPath}: ${error.message || 'Internal server error'}${causeCode}`);
    }
    json(res, error.status || 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Animal.ua server listening on http://localhost:${PORT}`));
