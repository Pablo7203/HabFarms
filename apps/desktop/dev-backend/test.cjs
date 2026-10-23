const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createClient } = require(path.join(process.env.HABFARMS_NODE_MODULES, '@supabase/supabase-js'));
const api = process.env.LOCAL_API_URL;
assert.equal(api, 'http://127.0.0.1:60421');
const admin = createClient(api, process.env.LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
const base = 'http://127.0.0.1:61421';
const run = Date.now().toString(36);
let passed = 0;
function ok(value, label) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }
async function insert(table, rows) { const r = await admin.from(table).insert(rows).select(); assert.ifError(r.error); return r.data; }
async function user(letter) {
  const email = `phase1-${run}-${letter}@example.test`;
  const password = `Phase1-${run}-Password-42!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const login = await fetch(`${api}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: process.env.LOCAL_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  ok(login.ok, `${letter} signs in with existing Supabase Auth`);
  return { id: created.data.user.id, email, token: (await login.json()).access_token };
}
async function call(route, token, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], { env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let errors = ''; server.stderr.on('data', b => { errors += b; });
  try {
    for (let n = 0; n < 50; n++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    ok((await fetch(`${base}/health`)).ok && !server.exitCode, 'development bridge starts locally');
    const A = await user('A'), B = await user('B');
    const [farmA, farmB, farmC] = await insert('farms', [
      { name: `Phase 1 Farm A ${run}` }, { name: `Phase 1 Farm B ${run}` }, { name: `Phase 1 Farm C ${run}` }]);
    await insert('farm_members', [
      { farm_id: farmA.id, user_id: A.id, role: 'admin' },
      { farm_id: farmB.id, user_id: A.id, role: 'manager' },
      { farm_id: farmC.id, user_id: B.id, role: 'admin' }]);
    await insert('flocks', [{ farm_id: farmB.id, flock_name: 'Prepared Layer Flock',
      start_date: '2026-10-19', initial_birds: 125, created_by: A.id }]);
    const listedA = await call('/farms', A.token);
    ok(listedA.status === 200 && listedA.data.farms.length === 2, 'multi-farm list contains only A memberships');
    const listedB = await call('/farms', B.token);
    ok(listedB.status === 200 && listedB.data.farms.length === 1 && listedB.data.farms[0].id === farmC.id,
      'B cannot list A farms');
    const device = crypto.randomUUID();
    const chosen = await call('/bootstrap', A.token, { farmId: farmB.id, installationId: device });
    ok(chosen.status === 200 && chosen.data.snapshot.farmId === farmB.id && chosen.data.snapshot.farm.name === farmB.name,
      'explicit Farm B selection remains Farm B');
    ok(chosen.data.snapshot.flocks.length === 1 && chosen.data.snapshot.flocks[0].currentLiveBirds === 125,
      'role-shaped flock and population downloaded');
    ok(!JSON.stringify(chosen.data.snapshot).match(/opening_cash_balance|contact_email|price_snapshot|monthly_price/),
      'restricted financial and contact fields absent from server response');
    const publicDer = Buffer.from(fs.readFileSync(path.join(__dirname, '../src-tauri/src/lease-public-key.b64'), 'utf8').trim(), 'base64');
    const publicKey = crypto.createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
    ok(crypto.verify(null, Buffer.from(chosen.data.lease.claims), publicKey, Buffer.from(chosen.data.lease.signature, 'base64')),
      'server signed lease verifies with desktop public key');
    const wrong = await call('/bootstrap', B.token, { farmId: farmB.id, installationId: device });
    ok(wrong.status === 403, 'B cannot bootstrap A farm');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'habfarms-phase1-'));
    const packagePath = path.join(root, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify(chosen.data));
    const exe = process.env.PHASE1_LOCAL_EXE;
    assert.ok(exe && fs.existsSync(exe), 'compiled local core example required');
    const runLocal = (stage, extra = {}) => spawnSync(exe, [stage], { encoding: 'utf8', env: {
      ...process.env, PHASE1_ROOT: root, PHASE1_DEVICE: device, PHASE1_EMAIL: A.email,
      PHASE1_PIN: `Offline-${run}-Secret`, PHASE1_PACKAGE: packagePath, ...extra } });
    let local = runLocal('prepare');
    ok(local.status === 0, `encrypted farm preparation: ${local.stderr}`);
    const file = fs.readdirSync(root).find(name => name.endsWith('.sqlite'));
    assert.ok(file); const raw = fs.readFileSync(path.join(root, file));
    ok(!raw.includes(Buffer.from(farmB.name)) && !raw.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')),
      'prepared farm encrypted at rest');
    local = runLocal('offline');
    ok(local.status === 0 && local.stdout.includes(farmB.name), `separate-process offline reopen: ${local.stderr}`);
    local = runLocal('offline', { PHASE1_PIN: 'Incorrect-Secret-123' });
    ok(local.status !== 0, 'wrong unlock secret rejected');
    local = runLocal('offline', { PHASE1_EMAIL: B.email });
    ok(local.status !== 0, 'other account cannot discover or unlock A workspace');
    const tampered = JSON.parse(JSON.stringify(chosen.data));
    tampered.lease.claims = tampered.lease.claims.replace(farmB.id, farmA.id);
    fs.writeFileSync(packagePath, JSON.stringify(tampered));
    const tamperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'habfarms-phase1-tamper-'));
    local = runLocal('prepare', { PHASE1_ROOT: tamperRoot });
    ok(local.status !== 0 && !fs.readdirSync(tamperRoot).some(name => name.endsWith('.sqlite')),
      'tampered signature rejected before workspace creation');
    fs.writeFileSync(packagePath, JSON.stringify(chosen.data));
    assert.ifError((await admin.from('farm_members').update({ active: false }).eq('farm_id', farmB.id).eq('user_id', A.id)).error);
    ok((await call('/bootstrap', A.token, { farmId: farmB.id, installationId: device })).status === 403,
      'membership revocation wins on reconnect');
    assert.ifError((await admin.from('farm_members').update({ active: true, role: 'worker' }).eq('farm_id', farmB.id).eq('user_id', A.id)).error);
    const worker = await call('/bootstrap', A.token, { farmId: farmB.id, installationId: device });
    ok(worker.status === 200 && worker.data.snapshot.role === 'worker', 'role change reflected in new snapshot');
    await insert('farm_accounts', [{ farm_id: farmB.id, account_status: 'suspended',
      contact_name: 'Phase 1 Test', contact_email: `phase1-${run}@example.test`, created_by_platform_admin: A.id }]);
    ok((await call('/bootstrap', A.token, { farmId: farmB.id, installationId: device })).status === 403,
      'farm suspension blocks refreshed bootstrap');
    await insert('farm_accounts', [{ farm_id: farmC.id, account_status: 'active',
      contact_name: 'Phase 1 Test C', contact_email: `phase1-c-${run}@example.test`, created_by_platform_admin: B.id }]);
    const [plan] = await insert('subscription_plans', [{ code: `DESKTOP_${run.toUpperCase()}`,
      name: 'Phase 1 Test Plan', currency: 'GHS', monthly_price: 1, annual_price: 10 }]);
    await insert('farm_subscriptions', [{ farm_id: farmC.id, plan_id: plan.id, status: 'suspended',
      billing_cycle: 'monthly', currency: 'GHS', started_at: '2026-10-01' }]);
    ok((await call('/bootstrap', B.token, { farmId: farmC.id, installationId: device })).status === 403,
      'subscription suspension blocks refreshed bootstrap');
    ok(runLocal('offline').status === 0, 'revocation preserves encrypted local recovery snapshot');
    console.log(`PHASE 1 BACKEND: ${passed} assertions passed; ${root}`);
  } finally {
    server.kill();
    if (errors) console.error(errors);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
