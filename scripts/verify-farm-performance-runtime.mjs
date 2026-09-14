import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error("Missing Supabase environment");
const svc = createClient(url, service, { auth: { persistSession: false } });
const results = [], users = [], farms = [];
const assert = (value, message = "Assertion failed") => { if (!value) throw new Error(message); };
const test = async (name, fn) => { try { await fn(); results.push([name, "PASS"]); } catch (error) { results.push([name, `FAIL: ${error.message}`]); } };
const rpc = async (client, name, args) => { const { data, error } = await client.rpc(name, args); if (error) throw error; return Array.isArray(data) ? data[0] : data; };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (date, days) => { const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); };
const createUser = async (name) => { const email = `performance-${Date.now()}-${Math.random()}@example.test`; const { data, error } = await svc.auth.admin.createUser({ email, password: "Runtime-Test-42!", email_confirm: true, user_metadata: { full_name: name } }); if (error) throw error; users.push(data.user.id); return data.user; };
const login = async (user) => { const client = createClient(url, anon, { auth: { persistSession: false } }); const { error } = await client.auth.signInWithPassword({ email: user.email, password: "Runtime-Test-42!" }); if (error) throw error; return client; };

try {
  const admin = await createUser("Performance Admin"), worker = await createUser("Performance Worker"), adminClient = await login(admin), workerClient = await login(worker);
  const farm = await rpc(adminClient, "create_farm_with_admin", { farm_name: "Performance Runtime Farm" }); farms.push(farm.id);
  await adminClient.from("farm_members").insert({ farm_id: farm.id, user_id: worker.id, role: "worker" });
  const { data: grades } = await svc.from("egg_grades").select("id,system_code,name,is_unsorted,sort_order").eq("farm_id", farm.id).order("sort_order");
  const grade = (code) => grades.find((item) => item.system_code === code);
  await test("Egg Grade Expansion: six operational grade states", async () => assert(grades.map((item) => item.system_code).join(",") === "unsorted,smaller,small,medium,large,bigger"));
  await test("Egg Grade Expansion: exact sellable names", async () => assert(["smaller", "small", "medium", "large", "bigger"].every((code) => grade(code)?.name === `${code[0].toUpperCase()}${code.slice(1)}`)));
  await rpc(adminClient, "set_opening_egg_stock", { target_grade: grade("smaller").id, effective_date: shift(today, -12), quantity_eggs: 10, notes: "Smaller opening stock" });
  await rpc(adminClient, "set_opening_egg_stock", { target_grade: grade("bigger").id, effective_date: shift(today, -12), quantity_eggs: 20, notes: "Bigger opening stock" });
  const flock = await rpc(adminClient, "create_flock", { flock_name: "Performance Layers", batch_reference: "PERF", breed: "Layer", house_pen: "A", start_date: shift(today, -30), initial_birds: 500, age_at_arrival_weeks: 22, source: "Runtime", notes: "" });
  const valid = await rpc(adminClient, "create_daily_production_graded", { target_flock_id: flock.id, production_date: shift(today, -6), eggs_collected: 480, cracked_eggs: 20, deaths: 0, culls: 0, feed_consumed_kg: 0, feed_type_id: null, transport_cost: 0, other_cost: 0, notes: "Five grade production", grade_allocations: [{ egg_grade_id: grade("smaller").id, quantity_eggs: 20 }, { egg_grade_id: grade("small").id, quantity_eggs: 70 }, { egg_grade_id: grade("medium").id, quantity_eggs: 230 }, { egg_grade_id: grade("large").id, quantity_eggs: 110 }, { egg_grade_id: grade("bigger").id, quantity_eggs: 30 }] });
  await test("Production Integrity: cracked eggs do not lower biological denominator", async () => { const { data } = await svc.from("v_daily_production_metrics").select("hen_day_percentage,good_eggs").eq("production_id", valid.id).single(); assert(Number(data.hen_day_percentage) === 96 && Number(data.good_eggs) === 460); });
  await test("Production Integrity: 500 eggs allows 100%", async () => { const record = await rpc(adminClient, "create_daily_production_graded", { target_flock_id: flock.id, production_date: shift(today, -5), eggs_collected: 500, cracked_eggs: 0, deaths: 0, culls: 0, feed_consumed_kg: 0, feed_type_id: null, transport_cost: 0, other_cost: 0, notes: "100 percent", grade_allocations: null }); assert(record.id); });
  await test("Production Integrity: 501 eggs rejects", async () => { const { error } = await adminClient.rpc("create_daily_production_graded", { target_flock_id: flock.id, production_date: shift(today, -4), eggs_collected: 501, cracked_eggs: 0, deaths: 0, culls: 0, feed_consumed_kg: 0, feed_type_id: null, transport_cost: 0, other_cost: 0, notes: "Invalid", grade_allocations: null }); assert(error && error.message.includes("Production exceeds")); });
  await test("Egg Grade Expansion: Smaller and Bigger stock remain separate", async () => { const { data } = await svc.from("v_current_egg_inventory_by_grade").select("grade_code,total_eggs").eq("farm_id", farm.id); assert(Number(data.find((item) => item.grade_code === "smaller").total_eggs) === 30 && Number(data.find((item) => item.grade_code === "bigger").total_eggs) === 50); });
  await rpc(adminClient, "set_egg_grade_price", { target_grade: grade("medium").id, effective_from: shift(today, -6), crate_price: 52, loose_egg_price: 2, notes: "Runtime price" });
  await test("Weekly Summary: summary RPC is accessible to management", async () => { const summary = await rpc(adminClient, "get_weekly_farm_summary", { anchor_date: shift(today, -5) }); assert(Number(summary.production.eggs_collected) === 980 && Number(summary.production.saleable_eggs) === 960); });
  await test("Weekly Summary: worker sees no commercial data", async () => { const summary = await rpc(workerClient, "get_weekly_farm_summary", { anchor_date: shift(today, -5) }); assert(summary.financial_access === false && Object.keys(summary.commercial).length === 0); });
  await test("Daily Summary: summary reconciliation", async () => { const summary = await rpc(adminClient, "get_daily_farm_summary", { summary_date: shift(today, -6), target_flock: flock.id }); assert(Number(summary.production.eggs_collected) === 480 && Number(summary.production.saleable_eggs) === 460 && Number(summary.production.hen_day_percentage) === 96); });
} finally {
  if (farms.length) await svc.from("farms").delete().in("id", farms);
  for (const id of users.reverse()) await svc.auth.admin.deleteUser(id);
}

for (const [name, status] of results) console.log(`${status}\t${name}`);
const failed = results.filter(([, status]) => status.startsWith("FAIL"));
console.log(`SUMMARY\t${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
