import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase verification environment is incomplete");

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const results = [];
const createdUserIds = [];
const createdFarmIds = [];
const run = async (name, test) => {
  try { await test(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) }); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const clientFor = async (email, password) => {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
};
const createUser = async (email, fullName) => {
  const { data, error } = await service.auth.admin.createUser({ email, password: "Runtime-Test-42!", email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) throw error ?? new Error("User creation returned no user");
  createdUserIds.push(data.user.id); return data.user;
};
const createFarm = async (client, name) => {
  const { data, error } = await client.rpc("create_farm_with_admin", { farm_name: name });
  if (error) throw error;
  const farm = Array.isArray(data) ? data[0] : data;
  assert(farm?.id, "Farm RPC returned no ID"); createdFarmIds.push(farm.id); return farm;
};
const roleOf = async (farmId, userId) => (await service.from("farm_members").select("role").eq("farm_id", farmId).eq("user_id", userId).single()).data?.role;

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const emails = { a: `runtime-a-${suffix}@example.test`, b: `runtime-b-${suffix}@example.test`, manager: `runtime-manager-${suffix}@example.test`, worker: `runtime-worker-${suffix}@example.test` };
let userA, userB, manager, worker, clientA, clientB, clientManager, clientWorker, farmA, farmB;

try {
  await run("Automatic profile creation populates ID, email, and name exactly once", async () => {
    userA = await createUser(emails.a, "Runtime Admin A");
    const { data, error } = await service.from("profiles").select("id,email,full_name").eq("id", userA.id);
    assert(!error && data.length === 1, "Expected exactly one profile");
    assert(data[0].id === userA.id && data[0].email === emails.a && data[0].full_name === "Runtime Admin A", "Profile fields do not match Auth user");
  });
  await run("Second isolated Auth user receives exactly one profile", async () => { userB = await createUser(emails.b, "Runtime Admin B"); const { data } = await service.from("profiles").select("id").eq("id", userB.id); assert(data?.length === 1, "Expected exactly one profile"); });
  await run("Manager and worker Auth profiles are created", async () => { manager = await createUser(emails.manager, "Runtime Manager"); worker = await createUser(emails.worker, "Runtime Worker"); });
  clientA = await clientFor(emails.a, "Runtime-Test-42!"); clientB = await clientFor(emails.b, "Runtime-Test-42!"); clientManager = await clientFor(emails.manager, "Runtime-Test-42!"); clientWorker = await clientFor(emails.worker, "Runtime-Test-42!");

  await run("Unauthenticated caller cannot create a farm", async () => { const anon = createClient(url, anonKey, { auth: { persistSession: false } }); const { error } = await anon.rpc("create_farm_with_admin", { farm_name: "Anonymous Farm" }); assert(error, "Anonymous farm creation unexpectedly succeeded"); });
  await run("create_farm_with_admin atomically creates one farm, settings row, and admin membership", async () => {
    farmA = await createFarm(clientA, "Runtime Farm A"); farmB = await createFarm(clientB, "Runtime Farm B");
    for (const [farm, user] of [[farmA, userA], [farmB, userB]]) {
      const [farms, settings, memberships] = await Promise.all([service.from("farms").select("id", { count: "exact" }).eq("id", farm.id), service.from("farm_settings").select("id", { count: "exact" }).eq("farm_id", farm.id), service.from("farm_members").select("id,role", { count: "exact" }).eq("farm_id", farm.id).eq("user_id", user.id)]);
      assert(farms.count === 1 && settings.count === 1 && memberships.count === 1 && memberships.data?.[0].role === "admin", "Atomic creation counts or role are incorrect");
    }
  });
  await run("Failed farm creation leaves no partial records", async () => { const before = await service.from("farms").select("id", { count: "exact", head: true }); const { error } = await clientA.rpc("create_farm_with_admin", { farm_name: " " }); const after = await service.from("farms").select("id", { count: "exact", head: true }); assert(error && before.count === after.count, "Invalid creation changed farm count"); });
  await run("User A can read Farm A", async () => { const { data, error } = await clientA.from("farms").select("id").eq("id", farmA.id); assert(!error && data.length === 1, "Farm A was not readable"); });
  await run("User A cannot read Farm B", async () => { const { data, error } = await clientA.from("farms").select("id").eq("id", farmB.id); assert(!error && data.length === 0, "Farm B leaked to User A"); });
  await run("User B cannot read Farm A memberships", async () => { const { data, error } = await clientB.from("farm_members").select("id").eq("farm_id", farmA.id); assert(!error && data.length === 0, "Farm A membership leaked to User B"); });
  await run("Admin A creates manager and worker memberships in Farm A", async () => { const { error: e1 } = await clientA.from("farm_members").insert({ farm_id: farmA.id, user_id: manager.id, role: "manager" }); const { error: e2 } = await clientA.from("farm_members").insert({ farm_id: farmA.id, user_id: worker.id, role: "worker" }); assert(!e1 && !e2, `Membership creation failed: ${e1?.message ?? e2?.message}`); });
  await run("Worker cannot promote self", async () => { await clientWorker.from("farm_members").update({ role: "admin" }).eq("farm_id", farmA.id).eq("user_id", worker.id); assert(await roleOf(farmA.id, worker.id) === "worker", "Worker self-promotion succeeded"); });
  await run("Manager cannot promote self", async () => { await clientManager.from("farm_members").update({ role: "admin" }).eq("farm_id", farmA.id).eq("user_id", manager.id); assert(await roleOf(farmA.id, manager.id) === "manager", "Manager self-promotion succeeded"); });
  await run("Worker cannot modify another member", async () => { await clientWorker.from("farm_members").update({ role: "worker" }).eq("farm_id", farmA.id).eq("user_id", manager.id); assert(await roleOf(farmA.id, manager.id) === "manager", "Worker modified manager"); });
  await run("Manager cannot modify another member", async () => { await clientManager.from("farm_members").update({ role: "worker" }).eq("farm_id", farmA.id).eq("user_id", worker.id); assert(await roleOf(farmA.id, worker.id) === "worker", "Manager modified worker"); });
  await run("Admin can administer another member in own farm", async () => { const { error } = await clientA.from("farm_members").update({ role: "worker" }).eq("farm_id", farmA.id).eq("user_id", manager.id); assert(!error && await roleOf(farmA.id, manager.id) === "worker", "Admin update failed"); await clientA.from("farm_members").update({ role: "manager" }).eq("farm_id", farmA.id).eq("user_id", manager.id); });
  await run("Admin B cannot administer Farm A", async () => { await clientB.from("farm_members").update({ role: "worker" }).eq("farm_id", farmA.id).eq("user_id", manager.id); assert(await roleOf(farmA.id, manager.id) === "manager", "Cross-farm membership update succeeded"); });

  const validConfig = { target_farm_id: undefined, farm_name: "Runtime Farm", farm_currency: "GHS", farm_timezone: "Africa/Accra", farm_crate_size: 30, farm_feed_bag_size_kg: 50, farm_opening_cash_balance: 0, egg_price_per_crate: 0, loose_egg_price: 0, warning_days: 14, critical_days: 7, average_days: 7 };
  await run("Admin A cannot modify Farm B configuration", async () => { const { error } = await clientA.rpc("update_farm_configuration", { ...validConfig, target_farm_id: farmB.id, farm_name: "Compromised" }); assert(error, "Cross-farm configuration update succeeded"); const { data } = await service.from("farms").select("name").eq("id", farmB.id).single(); assert(data.name === "Runtime Farm B", "Farm B changed"); });
  await run("Worker and manager cannot update farm configuration", async () => { for (const client of [clientWorker, clientManager]) { const { error } = await client.rpc("update_farm_configuration", { ...validConfig, target_farm_id: farmA.id }); assert(error, "Non-admin configuration update succeeded"); } });
  await run("Unauthenticated caller cannot update farm configuration", async () => { const anon = createClient(url, anonKey, { auth: { persistSession: false } }); const { error } = await anon.rpc("update_farm_configuration", { ...validConfig, target_farm_id: farmA.id }); assert(error, "Anonymous configuration update succeeded"); });
  await run("Invalid farm configuration values are rejected atomically", async () => { const cases = [{ farm_crate_size: 0 }, { farm_feed_bag_size_kg: 0 }, { farm_opening_cash_balance: -1 }, { egg_price_per_crate: -1 }, { loose_egg_price: -1 }, { warning_days: 3, critical_days: 4 }, { average_days: 0 }]; for (const invalid of cases) { const { error } = await clientA.rpc("update_farm_configuration", { ...validConfig, ...invalid, target_farm_id: farmA.id }); assert(error, `Invalid case accepted: ${JSON.stringify(invalid)}`); } const { data } = await service.from("farms").select("name").eq("id", farmA.id).single(); assert(data.name === "Runtime Farm A", "Failed update partially changed the farm"); });
  await run("Auth email changes synchronize to profiles.email without duplication", async () => { const changed = `runtime-a-changed-${suffix}@example.test`; const { error } = await service.auth.admin.updateUserById(userA.id, { email: changed, email_confirm: true }); assert(!error, "Auth email update failed"); const { data } = await service.from("profiles").select("email", { count: "exact" }).eq("id", userA.id); assert(data?.length === 1 && data[0].email === changed, "Profile email did not synchronize exactly once"); });
} finally {
  if (createdFarmIds.length) await service.from("farms").delete().in("id", createdFarmIds);
  for (const id of createdUserIds.reverse()) await service.auth.admin.deleteUser(id);
}

for (const result of results) console.log(`${result.status}\t${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
const failed = results.filter((result) => result.status === "FAIL");
console.log(`SUMMARY\t${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
