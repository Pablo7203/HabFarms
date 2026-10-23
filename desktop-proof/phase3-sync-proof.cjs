/* Phase 3 authenticated sync service proof. Local Supabase and Next only; never targets hosted services. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { createClient } = require(path.join(process.env.HABFARMS_NODE_MODULES, '@supabase/supabase-js'));
const api = process.env.LOCAL_API_URL;
assert.equal(api, 'http://127.0.0.1:60421');
const route = process.env.LOCAL_SYNC_URL || 'http://localhost:3030/api/desktop/sync';
const service = createClient(api, process.env.LOCAL_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = process.env.LOCAL_ANON_KEY;
const run = Date.now().toString(36);
let passed = 0;
function ok(value, label) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }
async function must(result) { assert.ifError(result.error); return result.data; }
async function user(letter) {
  const email = `phase3-${run}-${letter}@example.test`, password = `Phase3-${run}-Password-42!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true }); assert.ifError(created.error);
  const login = await fetch(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200); return { id: created.data.user.id, email, token: (await login.json()).access_token };
}
function client(u, farmId) { return createClient(api, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${u.token}`, 'x-habfarms-active-farm': farmId } } }); }
async function post(u, farmId, operations, installationId = crypto.randomUUID()) {
  const response = await fetch(route, { method: 'POST', headers: { Authorization: `Bearer ${u.token}`, Origin: 'tauri://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, appVersion: '0.1.0', localSchemaVersion: 4, installationId, farmId, operations }) });
  return { status: response.status, data: await response.json() };
}
function operation(type, farmId, flockId, date, payload, id = crypto.randomUUID()) {
  const now = new Date().toISOString(); return { operationId: id, farmId, flockId, schemaVersion: 1, operationType: type, eventDate: date, createdAtLocal: now, queuedAtLocal: now, dependencies: [], payload };
}
function mortality(farm, flock, date, quantity = 2, id) { return operation('MORTALITY_V1', farm, flock, date, { quantity, notes: 'Offline mortality entry' }, id); }
function production(farm, flock, date, eggGrades, id) { return operation('DAILY_PRODUCTION_V1', farm, flock, date, { eggsCollected: eggGrades.reduce((n, x) => n + x.quantityEggs, 0) || 100, crackedEggs: eggGrades.length ? 0 : 10, deaths: 0, culls: 0, feedConsumedKg: 0, feedTypeId: null, transportCost: 0, otherCost: 0, notes: 'Offline production entry', gradeAllocations: eggGrades }, id); }
async function flock(farmId, userId, name) { return (await must(await service.from('flocks').insert({ farm_id: farmId, flock_name: name, start_date: new Date().toISOString().slice(0,10), initial_birds: 100, created_by: userId }).select().single())); }
function outcome(result, id) { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.outcomes.find(x => x.operationId === id); }
async function main() {
  const preflight = await fetch(route, { method: 'OPTIONS', headers: {
    Origin: 'tauri://localhost', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  } });
  ok(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'tauri://localhost',
    'Tauri sync preflight returns a valid empty 204 response');
  const A = await user('A'), B = await user('B');
  const [farmA, farmB] = await must(await service.from('farms').insert([{ name: `Phase 3 Farm A ${run}` }, { name: `Phase 3 Farm B ${run}` }]).select());
  await must(await service.from('farm_members').insert([{ farm_id: farmA.id, user_id: A.id, role: 'admin' }, { farm_id: farmB.id, user_id: B.id, role: 'admin' }]));
  const [flockMortality, flockUnsorted, flockGraded, flockWeb, flockMixed, flockMixedConflict, flockMixedC] = await Promise.all([
    flock(farmA.id, A.id, 'Mortality Flock'), flock(farmA.id, A.id, 'Unsorted Flock'), flock(farmA.id, A.id, 'Graded Flock'), flock(farmA.id, A.id, 'Web Conflict Flock'), flock(farmA.id, A.id, 'Mixed A Flock'), flock(farmA.id, A.id, 'Mixed B Flock'), flock(farmA.id, A.id, 'Mixed C Flock'),
  ]);
  const grades = await must(await service.from('egg_grades').select('id,system_code,is_unsorted,is_active').eq('farm_id', farmA.id).eq('is_active', true));
  const unsorted = grades.find(g => g.is_unsorted), jumbo = grades.find(g => g.system_code === 'jumbo' && !g.is_unsorted);
  assert.ok(unsorted && jumbo, 'current unsorted and Jumbo grades exist');
  const day = new Date().toISOString().slice(0,10), install = crypto.randomUUID();
  const mort = mortality(farmA.id, flockMortality.id, day, 3);
  const firstMortality = await post(A, farmA.id, [mort], install);
  const firstMortalityOutcome = outcome(firstMortality, mort.operationId);
  ok(firstMortalityOutcome.code === 'SUCCESS', `authenticated mortality committed through existing bird movement transaction: ${JSON.stringify(firstMortalityOutcome)}`);
  const retryMortality = await post(A, farmA.id, [mort], install);
  const retryMortalityOutcome = outcome(retryMortality, mort.operationId);
  ok(retryMortalityOutcome.code === 'ALREADY_SYNCED' && retryMortalityOutcome.receipt.movementId === firstMortalityOutcome.receipt.movementId, 'mortality lost response retry returned original durable receipt');
  const mortBySource = await must(await service.from('bird_movements').select('id,quantity').eq('flock_id', flockMortality.id).eq('movement_type', 'death'));
  ok(mortBySource.length === 1 && mortBySource[0].quantity === 3, 'mortality population effect occurred exactly once');
  const bNow = await must(await service.from('v_current_flock_status').select('current_live_birds').eq('flock_id', flockMortality.id).single());
  ok(bNow.current_live_birds === 97, 'mortality canonical flock population is 97');
  const prod = production(farmA.id, flockUnsorted.id, day, []);
  const firstProduction = await post(A, farmA.id, [prod], install), firstProductionOutcome = outcome(firstProduction, prod.operationId);
  ok(firstProductionOutcome.code === 'SUCCESS', 'unsorted DAILY_PRODUCTION_V1 committed through authoritative graded production RPC');
  const signed = firstProduction.data.prepared;
  assert.ok(signed?.snapshotJson && signed?.claimsJson && signed?.signatureB64);
  const pubDer = Buffer.from(require('node:fs').readFileSync(path.join(__dirname, '../apps/desktop/src-tauri/src/lease-public-key.b64'), 'utf8').trim(), 'base64');
  const pub = crypto.createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
  ok(crypto.verify(null, Buffer.from(signed.claimsJson), pub, Buffer.from(signed.signatureB64, 'base64')), 'canonical refresh lease signature verifies against desktop public key');
  const snapshot = JSON.parse(signed.snapshotJson);
  ok(snapshot.eggInventory.some(x => x.gradeName === 'Unsorted' && x.eggs === 90), 'canonical refresh includes authoritative unsorted inventory');
  ok(snapshot.recentProduction.some(x => x.flockId === flockUnsorted.id && x.productionPercentage === 100), 'canonical refresh includes server-computed dated production percentage');
  const retryProduction = await post(A, farmA.id, [prod], install), retryProductionOutcome = outcome(retryProduction, prod.operationId);
  ok(retryProductionOutcome.code === 'ALREADY_SYNCED' && retryProductionOutcome.receipt.productionRecordId === firstProductionOutcome.receipt.productionRecordId, 'production lost response retry returned original durable receipt');
  const productionRows = await must(await service.from('daily_production_records').select('id,eggs_collected,cracked_eggs').eq('flock_id', flockUnsorted.id).eq('production_date', day));
  const eggMoves = await must(await service.from('egg_inventory_movements').select('id,quantity_eggs').eq('source_type', 'daily_production').eq('source_id', firstProductionOutcome.receipt.productionRecordId));
  const allocations = await must(await service.from('daily_production_grade_allocations').select('quantity_eggs,egg_grade_id').eq('production_record_id', firstProductionOutcome.receipt.productionRecordId));
  ok(productionRows.length === 1 && productionRows[0].eggs_collected === 100 && productionRows[0].cracked_eggs === 10, 'production business record exists exactly once with original quantities');
  ok(eggMoves.length === 1 && eggMoves[0].quantity_eggs === 90 && allocations.length === 1 && allocations[0].egg_grade_id === unsorted.id, 'good eggs credited exactly once to Unsorted with no invented grade');
  const graded = production(farmA.id, flockGraded.id, day, [{ eggGradeId: jumbo.id, quantityEggs: 12 }]);
  const gradedResult = await post(A, farmA.id, [graded]);
  ok(outcome(gradedResult, graded.operationId).code === 'SUCCESS', 'current Jumbo grade ID accepted without guessed grade mapping');
  const changed = { ...mort, payload: { ...mort.payload, quantity: 4 } };
  ok(outcome(await post(A, farmA.id, [changed], install), mort.operationId).code === 'OPERATION_ID_REUSED', 'same operation ID with changed mortality payload rejected');
  const concurrentOp = mortality(farmA.id, flockMixedC.id, day, 4);
  const concurrent = await Promise.all([post(A, farmA.id, [concurrentOp]), post(A, farmA.id, [concurrentOp])]);
  const concurrentCodes = concurrent.map(r => outcome(r, concurrentOp.operationId).code).sort();
  ok(concurrentCodes.join(',') === 'ALREADY_SYNCED,SUCCESS', 'concurrent duplicate requests return one success and one original receipt');
  const concurrentMoves = await must(await service.from('bird_movements').select('id').eq('flock_id', flockMixedC.id).eq('movement_type', 'death'));
  ok(concurrentMoves.length === 1, 'concurrent duplicate applied one mortality movement');
  const webDb = client(A, farmA.id);
  const web = await must(await webDb.rpc('create_daily_production_graded', { target_flock_id: flockWeb.id, production_date: day, eggs_collected: 20, cracked_eggs: 0, deaths: 0, culls: 0, feed_consumed_kg: 0, feed_type_id: null, transport_cost: 0, other_cost: 0, notes: 'Web created production', grade_allocations: null }));
  const webId = Array.isArray(web) ? web[0].id : web.id;
  const duplicateDay = production(farmA.id, flockWeb.id, day, []);
  ok(outcome(await post(A, farmA.id, [duplicateDay]), duplicateDay.operationId).code === 'DAILY_PRODUCTION_EXISTS', 'Web/Desktop same flock-date conflict is structured and preserves web record');
  const mixedA = production(farmA.id, flockMixed.id, day, []);
  const mixedB = mortality(farmA.id, flockMixedConflict.id, day, 101);
  const mixedC = mortality(farmA.id, flockMixedC.id, day, 1);
  const mixed = await post(A, farmA.id, [mixedA, mixedB, mixedC]);
  const mixedCodes = [outcome(mixed, mixedA.operationId).code, outcome(mixed, mixedB.operationId).code, outcome(mixed, mixedC.operationId).code];
  ok(mixedCodes.join(',') === 'SUCCESS,VALIDATION_FAILED,SUCCESS', 'mixed batch commits valid operations around a conflicting mortality');
  const mixedCheck = await must(await service.from('v_current_flock_status').select('flock_id,current_live_birds').in('flock_id', [flockMixed.id, flockMixedConflict.id]));
  ok(mixedCheck.find(x => x.flock_id === flockMixedConflict.id).current_live_birds === 100, 'conflicting mixed batch mortality caused no population change');
  const badBody = await fetch(route, { method: 'POST', headers: { Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, appVersion: '0.1.0', localSchemaVersion: 4, installationId: install, farmId: farmA.id, operations: [{ ...mort, forgedRole: 'admin' }] }) });
  ok(badBody.status === 400, 'malicious unexpected desktop fields rejected at service boundary');
  const wrongFarm = await post(B, farmA.id, [mortality(farmA.id, flockMortality.id, day)]);
  ok(wrongFarm.status === 200 && outcome(wrongFarm, wrongFarm.data.outcomes[0].operationId).code === 'AUTHORIZATION_FAILED', 'unrelated farm user cannot submit or read receipt');
  await must(await service.from('farm_members').update({ role: 'worker' }).eq('farm_id', farmA.id).eq('user_id', A.id));
  ok(outcome(await post(A, farmA.id, [mort], install), mort.operationId).code === 'AUTHORIZATION_FAILED', 'current role downgrade wins before duplicate receipt is returned');
  await must(await service.from('farm_members').update({ role: 'admin' }).eq('farm_id', farmA.id).eq('user_id', A.id));
  const audits = await must(await service.from('audit_logs').select('id,actor_user_id').eq('farm_id', farmA.id).eq('entity_type', 'bird_movements').eq('entity_id', firstMortalityOutcome.receipt.movementId));
  ok(audits.length === 1 && audits[0].actor_user_id === A.id, 'existing audit trail records the authenticated farmer exactly once');
  const receipts = await must(await service.from('desktop_sync_receipts').select('operation_id,state,actor_user_id,payload_fingerprint').eq('farm_id', farmA.id).eq('operation_id', mort.operationId));
  ok(receipts.length === 1 && receipts[0].state === 'SUCCEEDED' && receipts[0].actor_user_id === A.id && /^[0-9a-f]{64}$/.test(receipts[0].payload_fingerprint), 'receipt is farm-scoped, durable, and stores server SHA-256 fingerprint');
  console.log(`PHASE 3 LOCAL SYNC SERVICE: ${passed} assertions passed; run ${run}; web production ${webId}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
