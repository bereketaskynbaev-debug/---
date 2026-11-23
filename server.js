// Minimal dependency-free server for the Ustaz demo. Uses Node 24's built-in SQLite.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const cloudMode = Boolean(process.env.DATABASE_URL);
const cloud = cloudMode ? require('./cloud-storage') : null;
if (process.env.NODE_ENV === 'production' && !cloudMode && !process.env.USTAZ_DATA_DIR) throw new Error('Set USTAZ_DATA_DIR to the mounted persistent storage path before starting Ustaz.');
// Configure this to the host's persistent volume before accepting user uploads.
const STORE = process.env.USTAZ_DATA_DIR ? path.resolve(process.env.USTAZ_DATA_DIR) : (cloudMode ? path.join(os.tmpdir(), 'ustaz') : path.join(ROOT, 'data'));
const UPLOADS = path.join(STORE, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const db = cloudMode ? cloud.db : new DatabaseSync(path.join(STORE, 'ustaz.sqlite'));
if (!cloudMode) {
db.exec(`PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS materials (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL,
 subject TEXT NOT NULL, grade TEXT NOT NULL, author TEXT NOT NULL, language TEXT NOT NULL,
 source_url TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'teacher_original', rights_confirmed INTEGER NOT NULL DEFAULT 0, filename TEXT NOT NULL, original_name TEXT NOT NULL,
 mime TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 reviewed_at TEXT, reviewer_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS planner_drafts (
 id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
 id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
 language TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS community_posts (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
 author TEXT NOT NULL, language TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL, reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS community_replies (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL, message TEXT NOT NULL, author TEXT NOT NULL,
 language TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT,
 FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS community_reports (
 id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL,
 language TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT
);`);
if (!db.prepare('PRAGMA table_info(materials)').all().some(col => col.name === 'source_type')) db.exec("ALTER TABLE materials ADD COLUMN source_type TEXT NOT NULL DEFAULT 'teacher_original'");
if (!db.prepare('PRAGMA table_info(materials)').all().some(col => col.name === 'rights_confirmed')) db.exec('ALTER TABLE materials ADD COLUMN rights_confirmed INTEGER NOT NULL DEFAULT 0');
for (const [table, column, definition] of [
  ['community_posts','status',"TEXT NOT NULL DEFAULT 'pending'"], ['community_posts','reviewed_at','TEXT'],
  ['community_replies','status',"TEXT NOT NULL DEFAULT 'pending'"], ['community_replies','reviewed_at','TEXT']
]) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(col => col.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);

}
const ADMIN_FILE = path.join(STORE, 'admin-password.txt');
let adminPassword = process.env.USTAZ_ADMIN_PASSWORD;
if (process.env.NODE_ENV === 'production' && !adminPassword) throw new Error('Set USTAZ_ADMIN_PASSWORD in the production environment before starting Ustaz.');
if (!adminPassword) {
  if (fs.existsSync(ADMIN_FILE)) adminPassword = fs.readFileSync(ADMIN_FILE, 'utf8').trim();
  else {
    adminPassword = crypto.randomBytes(18).toString('base64url');
    fs.writeFileSync(ADMIN_FILE, adminPassword, { mode: 0o600 });
  }
}
const sessions = new Map();
const feedbackRate = new Map();
const communityRate = new Map();
const uploadRate = new Map();
const plannerDraftRate = new Map();
const plannerCommitRate = new Map();
const MAX_FILE = 15 * 1024 * 1024;
function rateLimit(map, req, limit, windowMs) {
  const forwarded = process.env.USTAZ_TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = forwarded || req.socket.remoteAddress || 'unknown', now = Date.now();
  const times = (map.get(ip) || []).filter(time => now - time < windowMs);
  if (times.length >= limit) return false;
  times.push(now); map.set(ip, times); return true;
}
const TYPES = {
  '.pdf': ['application/pdf', 'pdf'], '.doc': ['application/msword', 'doc'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  '.xls': ['application/vnd.ms-excel', 'xls'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  '.ppt': ['application/vnd.ms-powerpoint', 'ppt'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  '.odt': ['application/vnd.oasis.opendocument.text', 'odt'],
  '.ods': ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  '.odp': ['application/vnd.oasis.opendocument.presentation', 'odp']
};
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req, max = MAX_FILE + 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > max) { reject(new Error('FILE_TOO_LARGE')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function fieldsFromMultipart(buffer, boundary) {
  const result = {}; let file = null;
  const delimiter = Buffer.from('--' + boundary);
  let pos = 0;
  while ((pos = buffer.indexOf(delimiter, pos)) !== -1) {
    pos += delimiter.length;
    if (buffer.subarray(pos, pos + 2).equals(Buffer.from('--'))) break;
    if (buffer.subarray(pos, pos + 2).equals(Buffer.from('\r\n'))) pos += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos); if (headerEnd < 0) break;
    const headers = buffer.subarray(pos, headerEnd).toString('utf8');
    const next = buffer.indexOf(delimiter, headerEnd + 4); if (next < 0) break;
    let end = next; if (buffer.subarray(end - 2, end).equals(Buffer.from('\r\n'))) end -= 2;
    const value = buffer.subarray(headerEnd + 4, end);
    const name = (headers.match(/name="([^"]+)"/) || [])[1];
    const filename = (headers.match(/filename="([^"]*)"/) || [])[1];
    if (name === 'file' && filename) file = { originalName: path.basename(filename.replace(/\\/g, '/')), data: value };
    else if (name) result[name] = value.toString('utf8').trim();
    pos = next;
  }
  return { fields: result, file };
}
function isAdmin(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ustaz_admin='))?.slice(12);
  const expiry = sessions.get(token); return Boolean(token && expiry && expiry > Date.now());
}
function safeRow(row) { const { filename, ...publicRow } = row; return publicRow; }
function validText(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'ustaz-local' });
    if (req.method === 'GET' && url.pathname === '/api/materials') {
      const rows = (await db.prepare("SELECT id,title,description,kind,subject,grade,author,language,source_url,source_type,original_name,mime,status,created_at,reviewed_at,reviewer_note FROM materials WHERE status='published' ORDER BY created_at DESC").all());
      return send(res, 200, rows);
    }
    if (req.method === 'POST' && url.pathname === '/api/planner/draft') {
      if (!rateLimit(plannerDraftRate, req, 180, 10 * 60 * 1000)) return send(res,429,{error:'Автоматты сақтау жиілігі шектелді. Біраздан соң жалғастырыңыз / Слишком частое автосохранение. Попробуйте позже'});
      let draft; try { draft = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}'); } catch { return send(res,400,{error:'Сақтау деректері оқылмады / Не удалось прочитать данные черновика'}); }
      if (!/^[a-f0-9-]{36}$/i.test(String(draft.id||''))) return send(res,400,{error:'Жоспар нобайының идентификаторы қате / Неверный идентификатор черновика'});
      if (!Array.isArray(draft.fields) || draft.fields.length !== 13 || draft.fields.some(x => typeof x !== 'string' || x.length > 5000) || !Array.isArray(draft.rows) || draft.rows.length > 50 || draft.rows.some(row => !Array.isArray(row) || row.length !== 5 || row.some(x => typeof x !== 'string' || x.length > 5000)) || !Array.isArray(draft.materials) || draft.materials.length > 40) return send(res,400,{error:'Жоспар құрылымы жарамсыз / Недопустимая структура плана'});
      if (draft.textbook && (typeof draft.textbook !== 'object' || typeof draft.textbook.title !== 'string' || draft.textbook.title.length > 250 || typeof draft.textbook.pages !== 'string' || draft.textbook.pages.length > 100 || typeof draft.textbook.excerpt !== 'string' || draft.textbook.excerpt.length > 2000)) return send(res,400,{error:'Недопустимые данные учебника / Оқулық деректері жарамсыз'});
      const payload = JSON.stringify({textbook:draft.textbook?{title:draft.textbook.title,pages:draft.textbook.pages,excerpt:draft.textbook.excerpt}:null,fields:draft.fields,rows:draft.rows,materials:draft.materials,documentLanguage:draft.documentLanguage==='ru'?'ru':'kk',author:validText(draft.author,100)?draft.author:''}), now = new Date().toISOString();
      (await db.prepare('INSERT INTO planner_drafts(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(draft.id,payload,now));
      return send(res,200,{ok:true,saved:true,updated_at:now});
    }
    if (req.method === 'POST' && url.pathname === '/api/planner/commit') {
      if (!rateLimit(plannerCommitRate, req, 60, 10 * 60 * 1000)) return send(res,429,{error:'Жоспарды сақтау шегі уақытша аяқталды / Лимит сохранений временно исчерпан'});
      let plan; try { plan = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8') || '{}'); } catch { return send(res,400,{error:'Жоспар деректері оқылмады / Не удалось прочитать план'}); }
      const {id,html,title,description,subject,grade,author,language,rights_confirmed} = plan;
      if (!/^[a-f0-9-]{36}$/i.test(String(id||'')) || !validText(title,140) || !validText(description,1200) || !validText(subject,120) || !validText(grade,80) || !validText(author,100) || rights_confirmed !== true || !['kk','ru'].includes(language)) return send(res,400,{error:'Пәнді, сыныпты, тақырыпты, авторды толтырып, жариялау құқығын растаңыз / Заполните предмет, класс, тему, автора и подтвердите право на публикацию'});
      if (typeof html !== 'string' || Buffer.byteLength(html,'utf8') > 200 * 1024) return send(res,413,{error:'Жоспар файлының көлемі тым үлкен / Файл плана слишком большой'});
      const lowerHtml = html.toLowerCase();
      if (!lowerHtml.startsWith('<!doctype html') || !lowerHtml.includes('<meta name="generator" content="ustaz plan builder">') || /<(script|iframe|object|embed|form)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(html)) return send(res,415,{error:'Жоспар файлы қауіпсіз пішімде емес / Недопустимый формат файла плана'});
      const textContent = html.replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#\d+|#x[\da-f]+);/gi,' '), flags=[];
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(textContent)) flags.push('email');
      if (/(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{2}[\s().-]*\d{2}/.test(textContent) || /\b\d{12}\b/.test(textContent)) flags.push('personal-number');
      const now = new Date().toISOString(), status = flags.length ? 'pending' : 'published', note = flags.length ? 'Автоматты тексеру жеке байланыс не сәйкестендіру нөмірін байқады; жариялау тоқтатылды / Автопроверка обнаружила контактные или идентификационные данные; публикация отложена' : 'Автоматты тексеруден өтті / Автоматическая проверка пройдена', filename = id + '.doc', tempPath = path.join(UPLOADS,id+'.tmp'), finalPath = path.join(UPLOADS,filename);
      if (cloudMode) await cloud.put(filename,Buffer.from('\uFEFF'+html,'utf8'),'application/msword');
      else { fs.writeFileSync(tempPath,Buffer.from('\uFEFF'+html,'utf8')); fs.renameSync(tempPath,finalPath); }
      (await db.prepare(`INSERT INTO materials(id,title,description,kind,subject,grade,author,language,source_url,source_type,rights_confirmed,filename,original_name,mime,status,created_at,reviewed_at,reviewer_note)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,subject=excluded.subject,grade=excluded.grade,author=excluded.author,language=excluded.language,source_type=excluded.source_type,rights_confirmed=1,filename=excluded.filename,original_name=excluded.original_name,mime=excluded.mime,status=excluded.status,reviewed_at=excluded.reviewed_at,reviewer_note=excluded.reviewer_note`).run(id,title,description,'lesson',subject,grade,author,language,'','teacher_original',1,filename,language==='ru'?'Краткосрочный план.doc':'Қысқа мерзімді жоспар.doc','application/msword',status,now,now,note));
      (await db.prepare('DELETE FROM planner_drafts WHERE id=?').run(id));
      return send(res,200,{ok:true,status,autoModerated:true,message:note,review_url:status==='published'?`/download/${id}?v=${encodeURIComponent(now)}`:null,updated_at:now});
    }
    if (req.method === 'GET' && url.pathname === '/api/community') {
      const posts = (await db.prepare("SELECT * FROM community_posts WHERE status='published' ORDER BY created_at DESC LIMIT 100").all());
      const replies = (await db.prepare("SELECT * FROM community_replies WHERE status='published' ORDER BY created_at").all());
      return send(res, 200, posts.map(p => ({...p, replies: replies.filter(r => r.post_id === p.id)})));
    }
    if (req.method === 'POST' && url.pathname === '/api/community') {
      if (!rateLimit(communityRate, req, 5, 60 * 60 * 1000)) return send(res,429,{error:'Бір сағатта 5 жазбаға дейін / Не более 5 публикаций в час'});
      const b = JSON.parse((await readBody(req, 12000)).toString('utf8') || '{}');
      if (!['topic','question'].includes(b.kind) || !validText(b.title,140) || !validText(b.message,3000) || !validText(b.author,80) || b.terms_accepted !== true) return send(res,400,{error:'Тақырыпты толтырып, жариялау шартын қабылдаңыз / Заполните тему и примите правила публикации'});
      const id=crypto.randomUUID(); (await db.prepare("INSERT INTO community_posts(id,kind,title,message,author,language,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)").run(id,b.kind,b.title,b.message,b.author,b.language==='ru'?'ru':'kk',new Date().toISOString()));
      return send(res,201,{ok:true,id,status:'pending'});
    }
    const replyMatch=url.pathname.match(/^\/api\/community\/([a-f0-9-]+)\/replies$/i);
    if(req.method==='POST'&&replyMatch){
      if (!rateLimit(communityRate, req, 5, 60 * 60 * 1000)) return send(res,429,{error:'Бір сағатта 5 жауапқа дейін / Не более 5 ответов в час'});
      const b=JSON.parse((await readBody(req,6000)).toString('utf8')||'{}');
      if(!validText(b.message,2000)||!validText(b.author,80)||b.terms_accepted!==true)return send(res,400,{error:'Жауапты толтырып, жариялау шартын қабылдаңыз / Заполните ответ и примите правила публикации'});
      if(!(await db.prepare("SELECT id FROM community_posts WHERE id=? AND status='published'").get(replyMatch[1])))return send(res,404,{error:'Тақырып табылмады / Тема не найдена'});
      (await db.prepare("INSERT INTO community_replies(id,post_id,message,author,language,status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(crypto.randomUUID(),replyMatch[1],b.message,b.author,b.language==='ru'?'ru':'kk',new Date().toISOString()));return send(res,201,{ok:true,status:'pending'});
    }
    const reportMatch=url.pathname.match(/^\/api\/community\/(posts|replies)\/([a-f0-9-]+)\/report$/i);
    if(req.method==='POST'&&reportMatch){
      if(!rateLimit(communityRate,req,5,60*60*1000))return send(res,429,{error:'Шағым лимитіне жеттіңіз / Превышен лимит жалоб'});
      const b=JSON.parse((await readBody(req,3000)).toString('utf8')||'{}'),type=reportMatch[1]==='posts'?'post':'reply';
      if(!validText(b.reason,500))return send(res,400,{error:'Себебін қысқаша жазыңыз / Кратко укажите причину'});
      const table=type==='post'?'community_posts':'community_replies';if(!(await db.prepare(`SELECT id FROM ${table} WHERE id=? AND status='published'`).get(reportMatch[2])))return send(res,404,{error:'Жазба табылмады / Запись не найдена'});
      (await db.prepare('INSERT INTO community_reports(id,target_type,target_id,reason,language,status,created_at) VALUES(?,?,?,?,?,\'pending\',?)').run(crypto.randomUUID(),type,reportMatch[2],b.reason,b.language==='ru'?'ru':'kk',new Date().toISOString()));return send(res,201,{ok:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const ip = (process.env.USTAZ_TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown', now = Date.now(), times = (feedbackRate.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
      if (times.length >= 5) return send(res, 429, { error: 'Бір сағатта 5 пікірге дейін жіберуге болады / Лимит — 5 отзыва в час' });
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      if (!['suggestion','translation','bug','resource'].includes(body.category)) return send(res, 400, { error: 'Пікір түрін таңдаңыз / Выберите тип отзыва' });
      if (!validText(body.title, 140) || !validText(body.message, 3000)) return send(res, 400, { error: 'Тақырып пен пікірді толтырыңыз / Заполните тему и сообщение' });
      const id = crypto.randomUUID();
      (await db.prepare('INSERT INTO feedback(id,category,title,message,language,status,created_at) VALUES(?,?,?,?,?,\'pending\',?)').run(id,body.category,body.title,body.message,body.language==='ru'?'ru':'kk',new Date().toISOString()));
      times.push(now); feedbackRate.set(ip,times);
      return send(res, 201, { ok:true, message:'Пікіріңіз қабылданды. Рақмет! / Отзыв принят. Спасибо!' });
    }
    if (req.method === 'POST' && url.pathname === '/api/submit') {
      if (!rateLimit(uploadRate, req, 3, 60 * 60 * 1000)) return send(res,429,{error:'Бір сағатта 3 файлға дейін / Не более 3 файлов в час'});
      const ct = req.headers['content-type'] || '', boundary = (ct.match(/boundary=(?:"([^"]+)"|([^;]+))/) || []).slice(1).find(Boolean);
      if (!boundary) return send(res, 400, { error: 'Файл жіберілмеді / Не получена форма загрузки' });
      const parsed = fieldsFromMultipart(await readBody(req), boundary), f = parsed.fields, file = parsed.file;
      if (!file || !file.data.length) return send(res, 400, { error: 'Файлды таңдаңыз / Выберите файл' });
      if (file.data.length > MAX_FILE) return send(res, 413, { error: 'Файл 15 МБ-тан аспауы керек / Максимальный размер файла — 15 МБ' });
      if (!validText(f.title, 140) || !validText(f.description, 1200) || !validText(f.author, 100)) return send(res, 400, { error: 'Атауы, сипаттамасы және авторы қажет / Заполните название, описание и автора' });
      if (!['lesson','plan','report','school','education','teaching','leadership'].includes(f.kind)) return send(res, 400, { error: 'Құжат санатын таңдаңыз / Выберите категорию документа' });
      if (!['teacher_original','official_guidance','open_license','permission_granted'].includes(f.source_type)) return send(res, 400, { error: 'Материалдың құқықтық негізін таңдаңыз / Укажите основание для публикации материала' });
      if (f.rights_confirmed !== 'on') return send(res, 400, { error: 'Материалды жариялауға құқығыңыз бар екенін растаңыз / Подтвердите право на публикацию материала' });
      if (f.source_type === 'open_license' && !f.source_url) return send(res, 400, { error: 'Ашық лицензияның дереккөзін көрсетіңіз / Укажите источник открытой лицензии' });
      if (f.source_url && (!validText(f.source_url, 500) || !/^https?:\/\//i.test(f.source_url))) return send(res, 400, { error: 'Дереккөзге http немесе https сілтемесін енгізіңіз / Укажите ссылку http или https' });
      const ext = path.extname(file.originalName).toLowerCase(), info = TYPES[ext];
      if (!info) return send(res, 415, { error: 'PDF, Word, Excel немесе PowerPoint файлын жүктеңіз / Поддерживаются PDF, Word, Excel и PowerPoint' });
      const sig = file.data.subarray(0, 8), textStart = file.data.toString('utf8', 0, Math.min(file.data.length, 4096)).replace(/^\uFEFF/, '').trimStart().toLowerCase();
      const htmlWord = ext === '.doc' && textStart.startsWith('<!doctype html') && textStart.includes('<meta name="generator" content="ustaz plan builder">');
      if ((ext === '.pdf' && sig.toString() !== '%PDF-') || (['.docx','.xlsx','.pptx','.odt','.ods','.odp'].includes(ext) && !(sig[0] === 0x50 && sig[1] === 0x4b)) || (['.doc','.xls','.ppt'].includes(ext) && !(sig[0] === 0xd0 && sig[1] === 0xcf) && !htmlWord)) return send(res, 415, { error: 'Файл кеңейтімі мен мазмұны сәйкес емес / Тип файла не совпадает с содержимым' });
      const id = crypto.randomUUID(), filename = id + ext;
      if (cloudMode) await cloud.put(filename,file.data,info[0]);
      else fs.writeFileSync(path.join(UPLOADS, filename), file.data, { flag: 'wx' });
      (await db.prepare(`INSERT INTO materials(id,title,description,kind,subject,grade,author,language,source_url,source_type,rights_confirmed,filename,original_name,mime,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`).run(id,f.title,f.description,f.kind,f.subject||'',f.grade||'',f.author,f.language==='ru'?'ru':'kk',f.source_url||'',f.source_type,1,filename,file.originalName,info[0],new Date().toISOString()));
      return send(res, 201, { ok: true, status: 'pending', message: 'Материал тексеруге жіберілді / Материал отправлен на проверку' });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const b = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const supplied = Buffer.from(String(b.password || '')), expected = Buffer.from(adminPassword);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(res, 401, { error: 'Құпиясөз қате / Неверный пароль' });
      const token = crypto.randomBytes(32).toString('base64url'); sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
      res.setHeader('Set-Cookie', `ustaz_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'Әкімші ретінде кіріңіз / Войдите как администратор' });
      if (req.method === 'GET' && url.pathname === '/api/admin/pending') return send(res, 200, (await db.prepare("SELECT * FROM materials WHERE status='pending' ORDER BY created_at").all()).map(safeRow));
      if (req.method === 'GET' && url.pathname === '/api/admin/feedback') return send(res, 200, (await db.prepare("SELECT * FROM feedback WHERE status='pending' ORDER BY created_at").all()));
      if (req.method === 'GET' && url.pathname === '/api/admin/community') {
        const posts=(await db.prepare("SELECT id,'post' AS item_type,kind,title AS heading,message,author,language,created_at FROM community_posts WHERE status='pending' ORDER BY created_at").all());
        const replies=(await db.prepare("SELECT id,'reply' AS item_type,'reply' AS kind,'Жауап / Ответ' AS heading,message,author,language,created_at FROM community_replies WHERE status='pending' ORDER BY created_at").all());
        return send(res,200,[...posts,...replies].sort((a,b)=>a.created_at.localeCompare(b.created_at)));
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/community/reports')return send(res,200,(await db.prepare("SELECT * FROM community_reports WHERE status='pending' ORDER BY created_at").all()));
      const reportReview=url.pathname.match(/^\/api\/admin\/community\/reports\/([a-f0-9-]+)\/(dismiss|hide)$/i);
      if(req.method==='POST'&&reportReview){
        const report=(await db.prepare("SELECT * FROM community_reports WHERE id=? AND status='pending'").get(reportReview[1]));if(!report)return send(res,404,{error:'Шағым табылмады / Жалоба не найдена'});
        if(reportReview[2]==='hide'){const table=report.target_type==='post'?'community_posts':'community_replies';(await db.prepare(`UPDATE ${table} SET status='rejected',reviewed_at=? WHERE id=? AND status='published'`).run(new Date().toISOString(),report.target_id))}
        (await db.prepare("UPDATE community_reports SET status=?,reviewed_at=? WHERE id=?").run(reportReview[2]==='hide'?'actioned':'reviewed',new Date().toISOString(),report.id));return send(res,200,{ok:true});
      }
      const communityReview=url.pathname.match(/^\/api\/admin\/community\/(posts|replies)\/([a-f0-9-]+)\/(approve|reject)$/i);
      if(req.method==='POST'&&communityReview){
        const [,table,id,action]=communityReview, status=action==='approve'?'published':'rejected';
        const result=(await db.prepare(`UPDATE community_${table} SET status=?,reviewed_at=? WHERE id=? AND status='pending'`).run(status,new Date().toISOString(),id));
        if(!result.changes)return send(res,404,{error:'Жазба табылмады / Запись не найдена'});
        return send(res,200,{ok:true,status});
      }
      const feedbackReview = url.pathname.match(/^\/api\/admin\/feedback\/([a-f0-9-]+)\/review$/i);
      if (req.method === 'POST' && feedbackReview) {
        const result = (await db.prepare("UPDATE feedback SET status='reviewed',reviewed_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(),feedbackReview[1]));
        if (!result.changes) return send(res, 404, {error:'Пікір табылмады / Отзыв не найден'});
        return send(res, 200, {ok:true});
      }
      const action = url.pathname.match(/^\/api\/admin\/([a-f0-9-]+)\/(approve|reject)$/i);
      if (req.method === 'POST' && action) {
        const row = (await db.prepare('SELECT * FROM materials WHERE id=?').get(action[1])); if (!row) return send(res, 404, { error: 'Материал табылмады / Материал не найден' });
        if (action[2] === 'approve') (await db.prepare("UPDATE materials SET status='published',reviewed_at=? WHERE id=?").run(new Date().toISOString(), row.id));
        else { (await db.prepare("UPDATE materials SET status='rejected',reviewed_at=? WHERE id=?").run(new Date().toISOString(), row.id)); if (cloudMode) await cloud.remove(row.filename); else fs.rmSync(path.join(UPLOADS,row.filename), {force:true}); }
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method === 'GET' && (url.pathname.startsWith('/files/') || url.pathname.startsWith('/view/') || url.pathname.startsWith('/download/'))) {
      const viewMode = url.pathname.startsWith('/view/');
      const row = (await db.prepare("SELECT filename,original_name,mime FROM materials WHERE id=? AND status='published'").get(path.basename(url.pathname.slice(url.pathname.startsWith('/download/') ? 10 : viewMode ? 6 : 7))));
      if (!row) return send(res, 404, { error: 'Файл табылмады / Файл не найден' });
      const filePath = path.join(UPLOADS, row.filename); if (!cloudMode && !fs.existsSync(filePath)) return send(res, 404, { error: 'Файл табылмады / Файл не найден' });
      const cloudFile = cloudMode ? await cloud.read(row.filename) : null;
      const disposition = viewMode && row.mime === 'application/pdf' ? 'inline' : 'attachment';
      res.writeHead(200, {'Content-Type': row.mime, 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`, 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store'}); return cloudMode ? res.end(cloudFile) : fs.createReadStream(filePath).pipe(res);
    }
    if (req.method === 'GET' && ['/expanded-plans.js', '/planner-builder.js', '/release-guards.js', '/open-source-links.js', '/journal-shortcuts.js'].includes(url.pathname)) {
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const body = zlib.gzipSync(fs.readFileSync(path.join(ROOT, path.basename(url.pathname))));
        res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8', 'Content-Encoding':'gzip', 'Vary':'Accept-Encoding', 'Cache-Control':'no-store'});
        return res.end(body);
      }
      res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8', 'Cache-Control':'no-store'});
      return fs.createReadStream(path.join(ROOT, path.basename(url.pathname))).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}); return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err.message === 'FILE_TOO_LARGE') return send(res, 413, { error: 'Файл 15 МБ-тан аспауы керек / Максимальный размер файла — 15 МБ' });
    console.error(err); if (!res.headersSent) send(res, 500, { error: 'Сервер қатесі / Ошибка сервера' });
  }
});
const port = Number(process.env.PORT || 4180), host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`Ұстаз сервері / Сервер Ustaz: http://127.0.0.1:${port}`);
  if (host === '0.0.0.0') for (const entries of Object.values(os.networkInterfaces())) for (const addr of entries || []) if (addr.family === 'IPv4' && !addr.internal) console.log(`Мектеп желісінен / В сети школы: http://${addr.address}:${port}`);
  if (!process.env.USTAZ_ADMIN_PASSWORD) console.log(`Әкімші құпиясөзі / Пароль администратора: ${adminPassword}`);
  console.log('Материалдар модерациядан кейін жарияланады / Материалы публикуются после проверки.');
});
