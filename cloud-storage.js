// Server-only Supabase integration. Never serve this file to browsers.
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
  connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
pool.on('error', () => console.error('Database connection interrupted'));
const base = process.env.SUPABASE_URL;
const secret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^Bearer\s+/i,'').replace(/^(['"])(.*)\1$/,'$2');
if (!base || !secret || !process.env.DATABASE_URL) throw new Error('Configure Supabase server environment variables');
if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(base)) throw new Error('Invalid Supabase URL');
const bucket = 'ustaz-materials';
function parameters(sql) {
  let n = 0;
  // Application queries contain no question marks inside SQL strings.
  return sql.replace(/\?/g, () => '$' + (++n));
}
exports.db = { prepare(sql) {
  const query = (...args) => pool.query(parameters(sql), args);
  return {
    all: async (...args) => (await query(...args)).rows,
    get: async (...args) => (await query(...args)).rows[0],
    run: async (...args) => ({ changes: (await query(...args)).rowCount })
  };
}};
async function objectRequest(name, method, data, mime) {
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(name)) throw new Error('Invalid storage name');
  const response = await fetch(base.replace(/\/$/,'') + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(name), {
    method, headers: { apikey: secret,
      ...(!secret.startsWith('sb_') ? {Authorization: 'Bearer ' + secret} : {}),
      ...(data ? {'Content-Type': mime || 'application/octet-stream', 'x-upsert':'true'} : {}) },
    body: data, signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const code = String(detail.error || detail.code || '').replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,100);
    const message = String(detail.message || '').replace(/Bearer\s+\S+|sb_secret_\S+|eyJ\S+/gi,'[redacted]').slice(0,240);
    console.error('Storage response:', response.status, code, message);
    throw new Error('Storage operation failed: ' + response.status + ' ' + code);
  }
  return response;
}
exports.put = async (name, data, mime) => { await objectRequest(name, 'POST', data, mime); };
exports.read = async name => Buffer.from(await (await objectRequest(name, 'GET')).arrayBuffer());
exports.remove = async name => { await objectRequest(name, 'DELETE'); };
