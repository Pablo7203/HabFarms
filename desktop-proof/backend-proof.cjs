/* Synthetic local-backend proof. Requires LOCAL_API_URL, LOCAL_ANON_KEY,
 * LOCAL_SERVICE_KEY and HABFARMS_NODE_MODULES; never point at hosted URLs. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createClient } = require(path.join(process.env.HABFARMS_NODE_MODULES, '@supabase/supabase-js'));

const api = process.env.LOCAL_API_URL;
assert.match(api || '', /^http:\/\/127\.0\.0\.1:60421$/);
const service = createClient(api, process.env.LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
const anonKey = process.env.LOCAL_ANON_KEY;
const runId = Date.now().toString(36);
let passed = 0;
function ok(value, label) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }
function expectNoError(response, label) { assert.ifError(response.error); ok(Boolean(response.data), label); return response.data; }
async function insert(table, rows) {
  const response = await service.from(table).insert(rows).select();
  assert.ifError(response.error);
  return response.data;
}
async function createUser(letter) {
  const email = `desktop-proof-${runId}-${letter}@example.test`;
  const password = `Proof-${runId}-Strong-Password-42!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  return { id: created.data.user.id, email, password };
}
async function clientFor(user, farmId) {
  const client = createClient(api, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-habfarms-active-farm': farmId } },
  });
  const login = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ifError(login.error);
  ok(Boolean(login.data.session?.access_token), `Supabase login ${user.email.includes('-A@') ? 'A' : 'B'}`);
  return client;
}
function args(operationId, farmId, flockId, quantity = 5) {
  return { p_schema_version: 1, p_operation_type: 'MORTALITY_V1',
    p_operation_id: operationId, p_farm_id: farmId, p_flock_id: flockId,
    p_event_date: '2026-10-20', p_quantity: quantity, p_notes: 'Synthetic mortality proof',
    p_created_at_local: '2026-10-20T12:00:00Z', p_queued_at_local: '2026-10-20T12:00:01Z',
    p_dependencies: [] };
}
async function submit(client, input) { return client.rpc('desktop_proof_submit_mortality_v1', input); }
async function movementCount(flockId) {
  const r = await service.from('bird_movements').select('id,quantity').eq('flock_id', flockId).eq('movement_type', 'death');
  assert.ifError(r.error);
  return { count: r.data.length, total: r.data.reduce((n, row) => n + row.quantity, 0) };
}
async function main() {
  const A = await createUser('A');
  const B = await createUser('B');
  const [farmA, farmB] = await insert('farms', [
    { name: `Desktop Proof Farm A ${runId}` }, { name: `Desktop Proof Farm B ${runId}` },
  ]);
  await insert('farm_members', [
    { farm_id: farmA.id, user_id: A.id, role: 'admin' },
    { farm_id: farmB.id, user_id: B.id, role: 'admin' },
  ]);
  const [flockA] = await insert('flocks', [{ farm_id: farmA.id, flock_name: 'Synthetic Flock A',
    start_date: '2026-10-19', initial_birds: 100, created_by: A.id }]);
  const [flockB] = await insert('flocks', [{ farm_id: farmB.id, flock_name: 'Synthetic Flock B',
    start_date: '2026-10-19', initial_birds: 100, created_by: B.id }]);
  const [offlineFlock] = await insert('flocks', [{ farm_id: farmA.id, flock_name: 'Encrypted Offline Flock',
    start_date: '2026-10-19', initial_birds: 100, created_by: A.id }]);
  ok(farmA.id !== farmB.id && flockA.id !== flockB.id, 'synthetic farm and flock isolation');
  const clientA = await clientFor(A, farmA.id);
  const clientB = await clientFor(B, farmB.id);
  const session = await clientA.auth.getSession();
  assert.ifError(session.error);
  const localExe = process.env.PROOF_LOCAL_EXE;
  assert.ok(localExe && fs.existsSync(localExe), 'compiled local proof executable required');
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'habfarms-phase05-'));
  const localEnv = { ...process.env, PROOF_ROOT: localRoot, PROOF_USER: A.id,
    PROOF_FARM: farmA.id, PROOF_FLOCK: offlineFlock.id, PROOF_OPERATION: crypto.randomUUID(),
    PROOF_PIN: `Local-Unlock-${runId}-A`, PROOF_ACCESS_TOKEN: session.data.session.access_token,
    PROOF_RETRY_ONCE: '1' };
  function localStage(stage, environment = localEnv) {
    const result = spawnSync(localExe, [stage], { env: environment, encoding: 'utf8' });
    assert.equal(result.status, 0, `${stage}: ${result.stderr}`);
    const marker = stage === 'prepare' ? 'PREPARED' : stage === 'lost' ? 'LOST_ACK'
      : stage === 'retryable' ? 'RETRYABLE'
      : stage === 'retry' ? 'RETRIED' : stage === 'reject' ? 'REJECTED' : 'VERIFIED';
    ok(result.stdout.includes(marker),
      `encrypted local ${stage} process`);
  }
  localStage('prepare');
  const encryptedFile = fs.readdirSync(localRoot).find(name => name.endsWith('.sqlite'));
  assert.ok(encryptedFile);
  const raw = fs.readFileSync(path.join(localRoot, encryptedFile));
  ok(!raw.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) && !raw.includes(Buffer.from('Synthetic Encrypted Farm A')),
    'offline database is encrypted externally');
  localStage('retryable');
  const afterRetryable = await movementCount(offlineFlock.id);
  ok(afterRetryable.count === 0, 'retryable server response did not post mortality');
  localStage('lost');
  const afterLost = await movementCount(offlineFlock.id);
  ok(afterLost.count === 1 && afterLost.total === 5, 'server committed offline queue once before lost response');
  localStage('retry');
  localStage('verify');
  const afterIntegratedRetry = await movementCount(offlineFlock.id);
  ok(afterIntegratedRetry.count === 1 && afterIntegratedRetry.total === 5, 'retry left offline flock at 95 birds');
  const operationId = crypto.randomUUID();
  const input = args(operationId, farmA.id, flockA.id);
  const first = expectNoError(await submit(clientA, input), 'first authenticated mortality request');
  ok(first.code === 'SUCCESS', 'first request committed');
  // Deliberate lost acknowledgement: throw away first receipt before local resolution.
  const retry = expectNoError(await submit(clientA, input), 'lost acknowledgement retry');
  ok(retry.code === 'ALREADY_SYNCED' && retry.movementId === first.movementId, 'original receipt returned');
  const afterRetry = await movementCount(flockA.id);
  ok(afterRetry.count === 1 && afterRetry.total === 5, 'mortality changed exactly once after lost response');
  const concurrentId = crypto.randomUUID();
  const concurrentInput = args(concurrentId, farmA.id, flockA.id, 3);
  const concurrent = await Promise.all([submit(clientA, concurrentInput), submit(clientA, concurrentInput)]);
  ok(concurrent.every(r => !r.error) && new Set(concurrent.map(r => r.data.movementId)).size === 1,
    'concurrent duplicate shares one movement');
  const afterConcurrent = await movementCount(flockA.id);
  ok(afterConcurrent.count === 2 && afterConcurrent.total === 8, 'concurrent duplicate applied once');
  const mismatch = await submit(clientA, args(operationId, farmA.id, flockA.id, 6));
  ok(Boolean(mismatch.error), 'same operation ID with changed payload denied');
  ok(Boolean((await submit(clientA, { ...args(crypto.randomUUID(), farmA.id, flockA.id), p_schema_version: 99 })).error),
    'unsupported operation schema rejected before business write');
  ok(Boolean((await submit(clientA, args(crypto.randomUUID(), farmB.id, flockB.id))).error), 'Farm A user cannot post Farm B');
  ok(Boolean((await submit(clientA, args(crypto.randomUUID(), farmA.id, flockB.id))).error), 'Farm B flock cannot be paired with Farm A');
  ok(Boolean((await submit(clientB, args(crypto.randomUUID(), farmA.id, flockA.id))).error), 'Farm B user cannot post Farm A');
  ok(Boolean((await submit(clientB, args(operationId, farmB.id, flockB.id))).error), 'different user cannot reuse committed operation ID');
  ok(Boolean((await submit(clientA, args(crypto.randomUUID(), farmA.id, flockA.id, 1000))).error), 'mortality over population denied');
  const rejectedEnv = { ...localEnv, PROOF_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'habfarms-phase05-rejected-')),
    PROOF_OPERATION: crypto.randomUUID(), PROOF_RETRY_ONCE: '0' };
  localStage('prepare', rejectedEnv);
  const membership = await service.from('farm_members').update({ active: false }).eq('farm_id', farmA.id).eq('user_id', A.id);
  assert.ifError(membership.error);
  localStage('reject', rejectedEnv);
  localStage('verify-rejected', rejectedEnv);
  const afterRevoked = await movementCount(offlineFlock.id);
  ok(afterRevoked.count === 1 && afterRevoked.total === 5, 'revoked queued operation left server unchanged');
  ok(Boolean((await submit(clientA, args(crypto.randomUUID(), farmA.id, flockA.id))).error), 'membership removal blocks pending operation');
  assert.ifError((await service.from('farm_members').update({ active: true, role: 'worker' }).eq('farm_id', farmA.id).eq('user_id', A.id)).error);
  ok(Boolean((await submit(clientA, args(crypto.randomUUID(), farmA.id, flockA.id))).error), 'role downgrade blocks pending operation');
  ok(Boolean((await submit(clientA, { ...args(crypto.randomUUID(), farmA.id, flockA.id), p_role: 'admin', p_user_id: A.id })).error),
    'forged role and user fields do not restore access');
  assert.ifError((await service.from('farm_members').update({ role: 'admin' }).eq('farm_id', farmA.id).eq('user_id', A.id)).error);
  await insert('farm_accounts', [{ farm_id: farmA.id, account_status: 'suspended',
    contact_name: 'Synthetic Proof', contact_email: `proof-${runId}@example.test`, created_by_platform_admin: A.id }]);
  ok(Boolean((await submit(clientA, args(crypto.randomUUID(), farmA.id, flockA.id))).error), 'farm suspension blocks pending operation');
  await insert('farm_accounts', [{ farm_id: farmB.id, account_status: 'active',
    contact_name: 'Synthetic Proof B', contact_email: `proof-b-${runId}@example.test`, created_by_platform_admin: B.id }]);
  const [plan] = await insert('subscription_plans', [{ code: `PROOF_${runId.toUpperCase()}`,
    name: 'Synthetic Proof Plan', currency: 'GHS', monthly_price: 1, annual_price: 10 }]);
  await insert('farm_subscriptions', [{ farm_id: farmB.id, plan_id: plan.id, status: 'suspended',
    billing_cycle: 'monthly', currency: 'GHS', started_at: '2026-10-01' }]);
  ok(Boolean((await submit(clientB, args(crypto.randomUUID(), farmB.id, flockB.id))).error),
    'subscription suspension blocks pending operation');
  const final = await movementCount(flockA.id);
  ok(final.count === 2 && final.total === 8, 'negative cases leave authoritative mortality unchanged');
  const audits = await service.from('audit_logs').select('id').eq('farm_id', farmA.id).eq('entity_type', 'bird_movements');
  assert.ifError(audits.error);
  ok(audits.data.length === 3, 'normal HabFarms bird movement audit recorded exactly three times');
  console.log(`BACKEND PROOF: ${passed} assertions passed; run ${runId}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
