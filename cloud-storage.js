// Server-only Supabase integration. Never serve this file to browsers.
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
  connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
pool.on('error', () => console.error('Database connection interrupted'));
const base = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    method, headers: { apikey: secret, Authorization: 'Bearer ' + secret,
      ...(data ? {'Content-Type': mime || 'application/octet-stream', 'x-upsert':'true'} : {}) },
    body: data, signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error('Storage operation failed: ' + response.status);
  return response;
}
exports.put = async (name, data, mime) => { await objectRequest(name, 'POST', data, mime); };
exports.read = async name => Buffer.from(await (await objectRequest(name, 'GET')).arrayBuffer());
exports.remove = async name => { await objectRequest(name, 'DELETE'); };
