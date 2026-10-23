/* Creates disposable local-only credentials for manually walking the desktop UI. */
const crypto = require('node:crypto');
const path = require('node:path');
const { createClient } = require(path.join(process.env.HABFARMS_NODE_MODULES, '@supabase/supabase-js'));
if (process.env.LOCAL_API_URL !== 'http://127.0.0.1:60421') throw new Error('Local development Supabase only');
const service = createClient(process.env.LOCAL_API_URL, process.env.LOCAL_SERVICE_KEY,
  { auth: { persistSession: false } });
async function insert(table, value) {
  const result = await service.from(table).insert(value).select().single();
  if (result.error) throw result.error;
  return result.data;
}
async function main() {
  const tag = Date.now().toString(36);
  const makeUser = async (label) => {
    const email = `desktop-demo-${label}-${tag}@example.test`;
    const password = `Desktop-${crypto.randomBytes(12).toString('base64url')}!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    return { email, password, userId: created.data.user.id };
  };
  const userA = await makeUser('a');
  const userB = await makeUser('b');
  const farmA = await insert('farms', { name: `Desktop Farm A ${tag}` });
  const farmB = await insert('farms', { name: `Desktop Farm B ${tag}` });
  const farmC = await insert('farms', { name: `Desktop User B Farm ${tag}` });
  for (const farm of [farmA, farmB]) {
    await insert('farm_members', { farm_id: farm.id, user_id: userA.userId, role: 'admin' });
  }
  await insert('farm_members', { farm_id: farmC.id, user_id: userB.userId, role: 'admin' });
  await insert('flocks', { farm_id: farmA.id, flock_name: 'Farm A Layer Flock', start_date: '2026-10-19',
    initial_birds: 140, created_by: userA.userId });
  await insert('flocks', { farm_id: farmB.id, flock_name: 'Farm B Layer Flock', start_date: '2026-10-19',
    initial_birds: 85, created_by: userA.userId });
  await insert('flocks', { farm_id: farmC.id, flock_name: 'User B Layer Flock', start_date: '2026-10-19',
    initial_birds: 55, created_by: userB.userId });
  console.log(JSON.stringify({
    userA: { email: userA.email, password: userA.password },
    userB: { email: userB.email, password: userB.password },
    farms: {
      a: { name: farmA.name, id: farmA.id },
      b: { name: farmB.name, id: farmB.id },
      userB: { name: farmC.name, id: farmC.id },
    },
  }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
