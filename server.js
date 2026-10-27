const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');

const ROOT = __dirname;
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 10 }) : null;
const uploadsDir = path.join(ROOT, 'uploads');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const scrypt = promisify(crypto.scrypt);

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

async function readJson(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 }); chunks.push(chunk); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const makeToken = () => crypto.randomBytes(32).toString('base64url');
const emailOf = (value) => String(value || '').trim().toLowerCase().slice(0, 254);
const publicUser = (row) => ({ id: row.id, email: row.email, user_metadata: { full_name: row.full_name || '', role: row.role || 'owner' } });
const authResult = (user, access, refresh) => ({ access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, user });

async function createSession(userId) {
  const access = makeToken(), refresh = makeToken();
  await pool.query('INSERT INTO app_sessions(user_id, access_hash, refresh_hash, access_expires_at, expires_at) VALUES ($1,$2,$3,now()+interval \'1 hour\',now()+interval \'30 days\')', [userId, tokenHash(access), tokenHash(refresh)]);
  return { access, refresh };
}

async function currentUser(req) {
  const access = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!access) throw Object.assign(new Error('Sign in required'), { status: 401 });
  const result = await pool.query(`SELECT u.* FROM app_sessions s JOIN profiles u ON u.id=s.user_id WHERE s.access_hash=$1 AND s.access_expires_at>now() AND s.expires_at>now()`, [tokenHash(access)]);
  if (!result.rowCount) throw Object.assign(new Error('Invalid or expired session'), { status: 401 });
  return result.rows[0];
}

function petRecord(body, ownerId) {
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('Вкажіть кличку тварини.'), { status: 400 });
  const care = body.care_data && typeof body.care_data === 'object' && !Array.isArray(body.care_data) ? body.care_data : {};
  return [ownerId, name, String(body.species || '').slice(0,80), String(body.breed || '').slice(0,120), String(body.sex || '').slice(0,20), body.birth_date || null, String(body.color || '').slice(0,120), body.weight === '' || body.weight == null ? null : Number(body.weight), String(body.chip_number || '').slice(0,40), body.last_vaccination || null, String(body.notes || '').slice(0,4000), body.photo_path || null, JSON.stringify({ special_needs:String(care.special_needs||'').slice(0,2000), allergies:String(care.allergies||'').slice(0,2000), chronic_conditions:String(care.chronic_conditions||'').slice(0,2000), medications:String(care.medications||'').slice(0,2000), diet:String(care.diet||'').slice(0,2000), behavior:String(care.behavior||'').slice(0,2000), health_records:Array.isArray(care.health_records)?care.health_records.slice(0,300):[], vaccinations:Array.isArray(care.vaccinations)?care.vaccinations.slice(0,300):[], reminders:Array.isArray(care.reminders)?care.reminders.slice(0,300):[], documents:Array.isArray(care.documents)?care.documents.slice(0,300):[] })];
}

function fileSignature(ownerId, filename, expires) { return crypto.createHmac('sha256', AUTH_SECRET).update(`${ownerId}/${filename}:${expires}`).digest('hex'); }
function safeFilePath(ownerId, filename) {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId) || !/^[0-9a-f-]{36}\.(?:jpg|png|webp|pdf|doc|docx)$/i.test(filename)) throw Object.assign(new Error('Invalid file path'), { status: 403 });
  return path.join(uploadsDir, ownerId, filename);
}

async function uploadFile(ownerId, dataUrl, allowed, maxBytes) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !allowed[match[1]]) throw Object.assign(new Error('Unsupported file format.'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw Object.assign(new Error(`File must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`), { status: 413 });
  const filename = `${crypto.randomUUID()}.${allowed[match[1]]}`;
  const folder = path.join(uploadsDir, ownerId);
  await fs.promises.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(safeFilePath(ownerId, filename), bytes, { flag: 'wx', mode: 0o600 });
  return `${ownerId}/${filename}`;
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/health') {
    if (!pool) return json(res, 503, { ok:false, database:false });
    await pool.query('SELECT 1'); return json(res, 200, { ok:true, database:true });
  }
  const fileRoute = route.match(/^\/api\/files\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp|pdf|doc|docx))$/i);
  if (fileRoute && req.method === 'GET') {
    const expires = Number(url.searchParams.get('expires')), sig = url.searchParams.get('signature') || '';
    const expected = fileSignature(fileRoute[1], fileRoute[2], expires);
    const suppliedBuffer = Buffer.from(sig), expectedBuffer = Buffer.from(expected);
    if (expires < Date.now() / 1000 || suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return json(res, 403, { error: 'Link expired' });
    const file = safeFilePath(fileRoute[1], fileRoute[2]);
    const ext = path.extname(file).toLowerCase();
    const type = ({ '.pdf':'application/pdf', '.doc':'application/msword', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })[ext] || MIME[ext];
    res.writeHead(200, { 'content-type':type || 'application/octet-stream', 'cache-control':'private, max-age=300' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === 'POST' && route === '/api/auth/signup') {
    const body = await readJson(req), email = emailOf(body.email), password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) throw Object.assign(new Error('Вкажіть коректний email і пароль не коротший за 8 символів.'), { status:400 });
    const salt = crypto.randomBytes(16), hash = await scrypt(password, salt, 64);
    try {
      const result = await pool.query('INSERT INTO profiles(email,password_hash,password_salt,full_name) VALUES($1,$2,$3,$4) RETURNING *', [email,hash.toString('hex'),salt.toString('hex'),String(body.fullName||'').slice(0,160)]);
      const session = await createSession(result.rows[0].id); return json(res, 200, authResult(publicUser(result.rows[0]),session.access,session.refresh));
    } catch (error) { if (error.code==='23505') throw Object.assign(new Error('Користувач із таким email вже існує.'),{status:409}); throw error; }
  }
  if (req.method === 'POST' && route === '/api/auth/login') {
    const body = await readJson(req), result = await pool.query('SELECT * FROM profiles WHERE email=$1',[emailOf(body.email)]), user=result.rows[0];
    if (!user) throw Object.assign(new Error('Неправильний email або пароль.'),{status:401});
    const hash=await scrypt(String(body.password||''),Buffer.from(user.password_salt,'hex'),64);
    if (!crypto.timingSafeEqual(hash,Buffer.from(user.password_hash,'hex'))) throw Object.assign(new Error('Неправильний email або пароль.'),{status:401});
    const session=await createSession(user.id); return json(res,200,authResult(publicUser(user),session.access,session.refresh));
  }
  if (req.method === 'POST' && route === '/api/auth/refresh') {
    const body=await readJson(req), refresh=String(body.refreshToken||'');
    const result=await pool.query('SELECT u.* FROM app_sessions s JOIN profiles u ON u.id=s.user_id WHERE s.refresh_hash=$1 AND s.expires_at>now()',[tokenHash(refresh)]);
    if(!result.rowCount) throw Object.assign(new Error('Invalid or expired refresh token'),{status:401});
    await pool.query('DELETE FROM app_sessions WHERE refresh_hash=$1',[tokenHash(refresh)]);
    const session=await createSession(result.rows[0].id); return json(res,200,authResult(publicUser(result.rows[0]),session.access,session.refresh));
  }
  if (route.startsWith('/api/')) {
    const user=await currentUser(req), id=user.id;
    if(req.method==='POST'&&route==='/api/auth/logout'){await pool.query('DELETE FROM app_sessions WHERE user_id=$1',[id]);return json(res,200,{ok:true});}
    if(req.method==='GET'&&route==='/api/profile') return json(res,200,{id,full_name:user.full_name||'',phone:user.phone||'',role:user.role||'owner',avatar_path:user.avatar_path||null,emergency_contact:user.emergency_contact||'',schema_updated:true,email:user.email});
    if(req.method==='PATCH'&&route==='/api/profile'){
      const body=await readJson(req);const result=await pool.query('UPDATE profiles SET full_name=$2,phone=$3,role=$4,avatar_path=$5,emergency_contact=$6,updated_at=now() WHERE id=$1 RETURNING *',[id,String(body.full_name||'').slice(0,160),String(body.phone||'').slice(0,40),body.role==='vet'?'vet':'owner',body.avatar_path||null,String(body.emergency_contact||'').slice(0,240)]);
      return json(res,200,{...result.rows[0],schema_updated:true,email:user.email});
    }
    if(req.method==='GET'&&route==='/api/pets'){const r=await pool.query('SELECT * FROM pets WHERE owner_id=$1 ORDER BY created_at ASC',[id]);return json(res,200,r.rows);}
    if(req.method==='POST'&&route==='/api/pets'){
      const v=petRecord(await readJson(req),id);const r=await pool.query('INSERT INTO pets(owner_id,name,species,breed,sex,birth_date,color,weight,chip_number,last_vaccination,notes,photo_path,care_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING *',v);return json(res,201,r.rows[0]);
    }
    const pet=route.match(/^\/api\/pets\/([0-9a-f-]{36})$/i);
    if(pet&&req.method==='PATCH'){
      const v=petRecord(await readJson(req),id);v.shift();v.push(id,pet[1]);const r=await pool.query('UPDATE pets SET name=$1,species=$2,breed=$3,sex=$4,birth_date=$5,color=$6,weight=$7,chip_number=$8,last_vaccination=$9,notes=$10,photo_path=$11,care_data=$12::jsonb,updated_at=now() WHERE owner_id=$13 AND id=$14 RETURNING *',v);if(!r.rowCount)return json(res,404,{error:'Pet not found'});return json(res,200,r.rows[0]);
    }
    if(pet&&req.method==='DELETE'){await pool.query('DELETE FROM pets WHERE owner_id=$1 AND id=$2',[id,pet[1]]);return json(res,200,{ok:true});}
    if(req.method==='POST'&&route==='/api/photos'){
      const body=await readJson(req,7*1024*1024),p=await uploadFile(id,body.dataUrl,{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'},5*1024*1024);return json(res,201,{path:p});
    }
    if(req.method==='POST'&&route==='/api/documents'){
      const body=await readJson(req,14*1024*1024),p=await uploadFile(id,body.dataUrl,{'application/pdf':'pdf','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','image/jpeg':'jpg','image/png':'png','image/webp':'webp'},10*1024*1024);return json(res,201,{path:p});
    }
    if(req.method==='POST'&&(route==='/api/photos/signed-url'||route==='/api/documents/signed-url')){
      const body=await readJson(req),parts=String(body.path||'').split('/');if(parts.length!==2||parts[0]!==id)throw Object.assign(new Error('Invalid file path'),{status:403});
      const file=safeFilePath(id,parts[1]);await fs.promises.access(file);const expires=Math.floor(Date.now()/1000)+3600;const sig=fileSignature(id,parts[1],expires);return json(res,200,{url:`/api/files/${id}/${parts[1]}?expires=${expires}&signature=${sig}`});
    }
    if(req.method==='POST'&&route==='/api/photos/delete'){
      const body=await readJson(req),parts=String(body.path||'').split('/');if(parts.length!==2||parts[0]!==id)throw Object.assign(new Error('Invalid file path'),{status:403});
      await fs.promises.rm(safeFilePath(id,parts[1]),{force:true});return json(res,200,{ok:true});
    }
    return json(res,404,{error:'API route not found'});
  }
  return json(res,404,{error:'API route not found'});
}

async function main(){
  if(!DATABASE_URL)throw new Error('DATABASE_URL is required');
  if(!AUTH_SECRET)throw new Error('AUTH_SECRET is required');
  await pool.query('SELECT 1');
  const schema=fs.readFileSync(path.join(ROOT,'postgres/schema.sql'),'utf8');await pool.query(schema);
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const migrationsDir=path.join(ROOT,'postgres/migrations');
  for(const filename of (await fs.promises.readdir(migrationsDir)).filter(name=>name.endsWith('.sql')).sort()){
    const version=filename.slice(0,-4), client=await pool.connect();
    try{
      await client.query('BEGIN');
      const applied=await client.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version]);
      if(!applied.rowCount){await client.query(await fs.promises.readFile(path.join(migrationsDir,filename),'utf8'));await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[version]);}
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  await fs.promises.mkdir(uploadsDir,{recursive:true,mode:0o700});
  const server=http.createServer(async(req,res)=>{
    try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url);if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';if(pathname.split('/').some(x=>x.startsWith('.'))||pathname==='/server.js')return json(res,404,{error:'Not found'});const file=path.resolve(ROOT,`.${pathname}`);if(!file.startsWith(ROOT+path.sep))return json(res,403,{error:'Forbidden'});const stat=await fs.promises.stat(file);if(!stat.isFile())return json(res,404,{error:'Not found'});res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','content-length':stat.size});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);}catch(e){if(req.url?.startsWith('/api/'))console.error(`[api] ${req.method} ${req.url.split('?')[0]}: ${e.message}`);json(res,e.status||500,{error:e.message||'Internal server error'});}
  });
  server.listen(PORT,'0.0.0.0',()=>console.log(`Animal.ua connected to PostgreSQL; listening on http://localhost:${PORT}`));
}
main().catch(e=>{console.error(`Startup failed: ${e.message}`);process.exit(1);});
