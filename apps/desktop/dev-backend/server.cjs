/* Development bridge only. It refuses any hosted Supabase URL. */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require(path.join(process.env.HABFARMS_NODE_MODULES, '@supabase/supabase-js'));
const api = process.env.LOCAL_API_URL;
if (api !== 'http://127.0.0.1:60421') throw new Error('Local development Supabase only');
const anon = process.env.LOCAL_ANON_KEY;
const privatePath = path.resolve(__dirname, '../.local/lease-private.pem');
const signer = crypto.createPrivateKey(fs.readFileSync(privatePath));
const publicKey = crypto.createPublicKey(signer).export({ type: 'spki', format: 'der' }).toString('base64');
const expected = fs.readFileSync(path.resolve(__dirname, '../src-tauri/src/lease-public-key.b64'), 'utf8').trim();
if (publicKey !== expected) throw new Error('Desktop public key does not match local signer');
const allowedOrigins = new Set(['http://localhost:1420', 'http://127.0.0.1:1420',
  'http://tauri.localhost', 'tauri://localhost']);
function reply(res, status, data, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Headers': 'authorization,content-type' };
  if (allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}
function client(token) { return createClient(api, anon, { auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } } }); }
async function identity(token) {
  const response = await fetch(`${api}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('SESSION_EXPIRED');
  const user = await response.json();
  if (!user.id) throw new Error('SESSION_EXPIRED');
  return { id: user.id, email: user.email };
}
async function farmsFor(db, userId) {
  const memberships = await db.from('farm_members').select('farm_id,role').eq('user_id', userId).eq('active', true);
  if (memberships.error) throw memberships.error;
  if (!memberships.data.length) return [];
  const farms = await db.from('farms').select('id,name,timezone').in('id', memberships.data.map(m => m.farm_id)).eq('active', true);
  if (farms.error) throw farms.error;
  const result = [];
  for (const farm of farms.data) {
    const access = await db.rpc('get_farm_access_mode', { target_farm_id: farm.id });
    if (access.error) throw access.error;
    if (access.data === 'full') result.push({ id: farm.id, name: farm.name,
      role: memberships.data.find(m => m.farm_id === farm.id).role, timezone: farm.timezone });
  }
  return result;
}
async function bootstrap(db, userId, farmId, installationId) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(farmId) || !uuid.test(installationId)) throw new Error('INVALID_SELECTION');
  const selected = (await farmsFor(db, userId)).find(f => f.id === farmId);
  if (!selected) throw new Error('FARM_ACCESS_DENIED');
  const farm = await db.from('farms').select('id,name,timezone,currency,crate_size').eq('id', farmId).eq('active', true).single();
  const settings = await db.from('farm_settings').select('reporting_week_start').eq('farm_id', farmId).maybeSingle();
  const flocks = await db.from('flocks').select('id,flock_name,batch_reference,breed,house_pen,start_date,status').eq('farm_id', farmId).order('flock_name');
  const population = await db.from('v_current_flock_status').select('flock_id,current_live_birds').eq('farm_id', farmId);
  const grades = await db.from('egg_grades').select('id,system_code,name,is_unsorted,sort_order').eq('farm_id', farmId).eq('is_active', true).order('sort_order');
  const feedTypes = await db.from('feed_types').select('id,name').eq('farm_id', farmId).eq('active', true).order('name');
  const recent = await db.from('daily_production_records').select('flock_id,production_date').eq('farm_id', farmId).order('production_date', { ascending: false }).limit(100);
  for (const query of [farm, settings, flocks, population, grades, feedTypes, recent]) if (query.error) throw query.error;
  const last = new Map(); for (const row of recent.data) if (!last.has(row.flock_id)) last.set(row.flock_id, row.production_date);
  const current = (await farmsFor(db, userId)).find(f => f.id === farmId);
  if (!current) throw new Error('FARM_ACCESS_DENIED');
  const birds = new Map(population.data.map(row => [row.flock_id, row.current_live_birds]));
  const snapshot = { snapshotVersion: 1, schemaVersion: 2, appVersion: '0.1.0', userId, farmId,
    synchronizedAt: new Date().toISOString(), role: current.role,
    farm: { id: farm.data.id, name: farm.data.name, timezone: farm.data.timezone,
      currency: farm.data.currency, crateSize: farm.data.crate_size,
      reportingWeekStart: settings.data?.reporting_week_start ?? 1 },
    flocks: flocks.data.map(row => ({ id: row.id, name: row.flock_name, batchReference: row.batch_reference,
      breed: row.breed, housePen: row.house_pen, startDate: row.start_date, status: row.status,
      currentLiveBirds: birds.get(row.id) ?? null, lastProductionDate: last.get(row.id) ?? null })),
    eggGrades: grades.data.map(row => ({ id: row.id, code: row.system_code, name: row.name,
      isUnsorted: row.is_unsorted, sortOrder: row.sort_order })),
    feedTypes: feedTypes.data.map(row => ({ id: row.id, name: row.name })) };
  const issuedAt = new Date();
  const claims = JSON.stringify({ version: 1, keyId: 'development-2026-10', userId, farmId, installationId,
    issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 7 * 86400000).toISOString(),
    localSchemaMin: 2, localSchemaMax: 3,
    capabilities: ['snapshot_read', 'queue_mortality_v1', 'queue_daily_production_v1'],
    snapshotSha256: crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') });
  return { snapshot, lease: { claims, signature: crypto.sign(null, Buffer.from(claims), signer).toString('base64') } };
}
http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') return reply(res, allowedOrigins.has(origin) ? 200 : 403, {}, origin);
  if (req.url === '/health') {
    try {
      const upstream = await fetch(`${api}/auth/v1/health`, { signal: AbortSignal.timeout(3500) });
      if (!upstream.ok) return reply(res, 200, { status: 'offline' }, origin);
      const host = new URL(api).hostname;
      const local = ['localhost', '127.0.0.1', '::1'].includes(host);
      return reply(res, 200, { status: local ? 'local' : 'online' }, origin);
    } catch { return reply(res, 200, { status: 'offline' }, origin); }
  }
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new Error('SESSION_EXPIRED');
    const identityResult = await identity(token);
    const userId = identityResult.id;
    const db = client(token);
    if (req.method === 'GET' && req.url === '/farms') return reply(res, 200, { userId, email: identityResult.email,
      farms: await farmsFor(db, userId) }, origin);
    if (req.method === 'POST' && req.url === '/bootstrap') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('REQUEST_TOO_LARGE'); }
      const input = JSON.parse(body);
      return reply(res, 200, await bootstrap(db, userId, input.farmId, input.installationId), origin);
    }
    return reply(res, 404, { code: 'NOT_FOUND' }, origin);
  } catch (error) {
    const code = ['SESSION_EXPIRED','FARM_ACCESS_DENIED','INVALID_SELECTION','REQUEST_TOO_LARGE'].includes(error.message) ? error.message : 'SERVER_UNAVAILABLE';
    if (code === 'SERVER_UNAVAILABLE') console.error(error);
    return reply(res, code === 'SESSION_EXPIRED' ? 401 : code === 'FARM_ACCESS_DENIED' ? 403 : 400, { code }, origin);
  }
}).listen(61421, '127.0.0.1', () => console.log('HabFarms desktop local bridge: http://127.0.0.1:61421'));
