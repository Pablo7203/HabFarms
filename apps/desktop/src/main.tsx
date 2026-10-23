import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { dailyProductionV1, mortalityV1, type DesktopOperationV1 } from "../../../src/lib/desktop/sync-contract";
import { projectLocalState } from "./projections";
import "./style.css";

type FarmChoice = { id: string; name: string; role: string; timezone: string };
type LocalFarm = { userId: string; farmId: string; farmName: string };
type Flock = { id: string; name: string; breed: string | null; housePen: string | null; status: string; currentLiveBirds: number | null; lastProductionDate: string | null };
type Snapshot = { userId: string; farmId: string; synchronizedAt: string; role: string; farm: { name: string; timezone: string; currency: string; crateSize: number }; flocks: Flock[]; eggGrades: { id: string; code: string; name: string; isUnsorted: boolean; sortOrder: number }[]; feedTypes: { id: string; name: string }[]; eggInventory?: { gradeId: string; gradeName: string; eggs: number; isUnsorted: boolean }[]; recentProduction?: { productionRecordId: string; flockId: string; eventDate: string; eggsCollected: number; crackedEggs: number; goodEggs: number; eligibleBirds: number; productionPercentage: number | null }[] };
type Prepared = { snapshotJson: string; synchronizedAt: string; expiresAt: string; leaseExpired: boolean; operationCapabilities: string[] };
type Stored = { operationJson: string; state: string; serverReceiptJson: string | null; syncErrorCode: string | null; syncedAt: string | null };
type SyncSummary = { synced: number; needsAttention: number; waiting: number; lastSuccessfulSync: string | null };
type Connection = "CONNECTING" | "ONLINE" | "LOCAL SERVER" | "OFFLINE" | "INTERNET AVAILABLE / HABFARMS UNREACHABLE" | "REAUTHENTICATION REQUIRED" | "LEASE EXPIRED";
type EntryKind = "DAILY_PRODUCTION_V1" | "MORTALITY_V1";
const supabase = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const bridge = import.meta.env.VITE_DESKTOP_BRIDGE_URL as string | undefined;
const syncUrl = import.meta.env.VITE_DESKTOP_SYNC_URL as string | undefined;
const stagingQa = import.meta.env.VITE_DESKTOP_ENV === "staging";
const rememberEmailKey = "habfarms.desktop.remember-email";
const savedEmailKey = "habfarms.desktop.email";
function isLocalBackend() {
  try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(supabase ?? "").hostname); }
  catch { return false; }
}
function readRememberedEmail() {
  try { return localStorage.getItem(rememberEmailKey) === "true" ? localStorage.getItem(savedEmailKey) ?? "" : ""; }
  catch { return ""; }
}

function friendly(error: unknown): string {
  const message = String(error);
  if (/SESSION_EXPIRED|401/.test(message)) return "Your online session has expired. Sign in again to refresh farm access.";
  if (/FARM_ACCESS_DENIED|403/.test(message)) return "This farm is no longer available to your account. Your saved local data has been kept.";
  if (/fetch|network|SERVER_UNAVAILABLE/i.test(message)) return "HabFarms cannot be reached. Your entries remain saved on this computer.";
  if (/unlock|prepared|lease|snapshot|access has expired|Reconnect/i.test(message)) return message.replace(/^Error:\s*/, "");
  return message.replace(/^Error:\s*/, "") || "Something went wrong. Please try again or contact HabFarms support.";
}
async function json(url: string, init: RequestInit) {
  const response = await fetch(url, init); const data = await response.json();
  if (!response.ok) throw new Error(data.code ?? "SERVER_UNAVAILABLE"); return data;
}
function date(value: string) { return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function dateInZone(zone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`;
}
function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}
function newId() { return crypto.randomUUID(); }
function timestamp() { return new Date().toISOString(); }
function intValue(value: string) { return value === "" ? Number.NaN : Number(value); }
function wheelGuard(event: React.WheelEvent<HTMLInputElement>) { if (document.activeElement === event.currentTarget) event.currentTarget.blur(); }

function App() {
  const [email, setEmail] = useState(readRememberedEmail); const [password, setPassword] = useState(""); const [pin, setPin] = useState("");
  const [rememberMe, setRememberMe] = useState(() => { try { return localStorage.getItem(rememberEmailKey) === "true"; } catch { return false; } });
  const [entryMode, setEntryMode] = useState<"online" | "offline">("online");
  const [token, setToken] = useState<string | null>(null); const [userId, setUserId] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null); const [farms, setFarms] = useState<FarmChoice[]>([]);
  const [localFarms, setLocalFarms] = useState<LocalFarm[]>([]); const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [rows, setRows] = useState<Stored[]>([]);
  const [connection, setConnection] = useState<Connection>(bridge ? "CONNECTING" : "INTERNET AVAILABLE / HABFARMS UNREACHABLE");
  const [screen, setScreen] = useState<"home" | "flocks" | "entries" | "settings">("home");
  const [entryKind, setEntryKind] = useState<EntryKind | null>(null); const [editing, setEditing] = useState<DesktopOperationV1 | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false); const [syncSummary, setSyncSummary] = useState<SyncSummary>({ synced: 0, needsAttention: 0, waiting: 0, lastSuccessfulSync: null });
  const reloadRows = useCallback(async () => { setRows(await invoke<Stored[]>("list_local_operations")); }, []);
  useEffect(() => {
    if (!bridge) return; let active = true;
    const probe = async () => {
      if (!navigator.onLine) { if (active) setConnection("OFFLINE"); return; }
      try {
        const endpoint = syncUrl ?? `${bridge}/health`;
        const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        const health = response.ok ? await response.json() as { status?: string } : null;
        if (active) setConnection(response.ok
          ? (prepared?.leaseExpired ? "LEASE EXPIRED" : !token && prepared ? "REAUTHENTICATION REQUIRED" : health?.status === "local" ? "LOCAL SERVER" : health?.status === "online" ? "ONLINE" : "INTERNET AVAILABLE / HABFARMS UNREACHABLE")
          : "INTERNET AVAILABLE / HABFARMS UNREACHABLE");
        if (response.ok && health?.status !== "unreachable" && token && snapshot && bridge) {
          const current = await json(`${bridge}/farms`, { headers: { Authorization: `Bearer ${token}` } });
          const selected = (current.farms as FarmChoice[]).find(f => f.id === snapshot.farmId);
          if (active && (!selected || selected.role !== snapshot.role)) {
            await lock(false); setMessage("Your farm access has changed. Sign in and prepare this farm again. Saved local data has been kept.");
          }
        }
      } catch { if (active) setConnection(prepared?.leaseExpired ? "LEASE EXPIRED" : navigator.onLine ? "INTERNET AVAILABLE / HABFARMS UNREACHABLE" : "OFFLINE"); }
    };
    const networkOffline = () => { if (active) setConnection("OFFLINE"); };
    const networkOnline = () => { void probe(); };
    window.addEventListener("offline", networkOffline); window.addEventListener("online", networkOnline);
    void probe(); const timer = setInterval(probe, 15000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("offline", networkOffline); window.removeEventListener("online", networkOnline); };
  }, [token, prepared, snapshot]);

  function updateEmail(value: string) {
    setEmail(value);
    if (rememberMe) { try { localStorage.setItem(savedEmailKey, value); } catch { /* email remembering is optional */ } }
  }
  function updateRememberMe(checked: boolean) {
    setRememberMe(checked);
    try {
      if (checked) { localStorage.setItem(rememberEmailKey, "true"); localStorage.setItem(savedEmailKey, email); }
      else { localStorage.removeItem(rememberEmailKey); localStorage.removeItem(savedEmailKey); }
    } catch { /* email remembering is optional */ }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (!supabase || !anon || !bridge) throw new Error("SERVER_UNAVAILABLE");
      const auth = await json(`${supabase}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      setPassword(""); const accessToken = auth.access_token as string;
      const choices = await json(`${bridge}/farms`, { headers: { Authorization: `Bearer ${accessToken}` } });
      setToken(accessToken); setUserId(choices.userId); setVerifiedEmail(choices.email); updateEmail(choices.email); setFarms(choices.farms); setConnection(navigator.onLine ? (isLocalBackend() ? "LOCAL SERVER" : "ONLINE") : "OFFLINE");
      if (!choices.farms.length) setMessage("No active farms are available to this account.");
    } catch (error) { setPassword(""); setMessage(friendly(error)); } finally { setBusy(false); }
  }
  async function prepare(farmId: string) {
    setBusy(true); setMessage("");
    try {
      if (!token || !userId || !verifiedEmail || !bridge || pin.length < 8) throw new Error("Use an offline unlock secret of at least eight characters.");
      const installationId = await invoke<string>("get_installation_id");
      const result = await json(`${bridge}/bootstrap`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ farmId, installationId }) });
      const local = await invoke<Prepared>("prepare_workspace", { email: verifiedEmail, pin, userId, farmId, snapshotJson: JSON.stringify(result.snapshot), claimsJson: result.lease.claims, signatureB64: result.lease.signature });
      setPrepared(local); setSnapshot(JSON.parse(local.snapshotJson)); setPin(""); setScreen("home"); await reloadRows();
    } catch (error) { setMessage(friendly(error)); } finally { setBusy(false); }
  }
  async function findLocal() {
    setBusy(true); setMessage(""); try { setLocalFarms(await invoke<LocalFarm[]>("list_local_farms", { email, pin })); } catch (error) { setMessage(friendly(error)); } finally { setBusy(false); }
  }
  async function unlock(farmId: string) {
    setBusy(true); setMessage("");
    try {
      const local = await invoke<Prepared>("unlock_workspace", { email, pin, farmId });
      setPrepared(local); setSnapshot(JSON.parse(local.snapshotJson)); setPin(""); setScreen("home"); setLocalFarms([]); await reloadRows();
    } catch (error) { setMessage(friendly(error)); } finally { setBusy(false); }
  }
  async function lock(signOut: boolean) {
    await invoke("lock_workspace"); setPrepared(null); setSnapshot(null); setRows([]); setLocalFarms([]); setPin(""); setEntryKind(null); setEditing(null);
    if (signOut) { setToken(null); setUserId(null); setVerifiedEmail(null); setFarms([]); if (!rememberMe) setEmail(""); }
  }
  async function refresh() {
    if (!token || !snapshot || !bridge) { setMessage("Sign in online to verify access and refresh this farm."); return; }
    setBusy(true); setMessage("");
    try {
      const choices = await json(`${bridge}/farms`, { headers: { Authorization: `Bearer ${token}` } }); setFarms(choices.farms);
      if (!choices.farms.some((farm: FarmChoice) => farm.id === snapshot.farmId)) { await lock(false); setMessage("Farm access has changed. Your encrypted local data has been kept."); }
      else setMessage("Farm access is current. Prepare the farm again to update saved information and the offline lease.");
    } catch (error) { setMessage(friendly(error)); } finally { setBusy(false); }
  }
  async function refreshRows() { try { await reloadRows(); } catch (error) { setMessage(friendly(error)); } }
  async function syncNow() {
    if (!snapshot) return;
    if (!token || !userId || userId !== snapshot.userId) {
      setMessage("Sign in as the account that owns this prepared farm, then unlock it again to sync.");
      await lock(true); setEntryMode("online"); return;
    }
    if (!syncUrl) { setMessage("Desktop synchronization is not configured for this build."); return; }
    const pending = rows.filter((row) => row.state === "PENDING_SYNC");
    if (!pending.length) { setMessage("There are no entries waiting to sync."); return; }
    setBusy(true); setSyncing(true); setMessage("");
    let synced = 0; let needsAttention = 0; let waiting = 0; let refreshedAt: string | null = null;
    try {
      const installationId = await invoke<string>("get_installation_id");
      // A lost response must leave just its own operation pending for retry.
      for (let offset = 0; offset < pending.length; offset += 1) {
        const batch = pending.slice(offset, offset + 1);
        const parsedOperations = batch.map((row) => JSON.parse(row.operationJson) as DesktopOperationV1);
        for (const operation of parsedOperations) await invoke("mark_local_operation_syncing", { operationId: operation.operationId });
        let response: Response;
        try {
          response = await fetch(syncUrl, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ protocolVersion: 1, appVersion: "0.1.0", localSchemaVersion: 4,
              installationId, farmId: snapshot.farmId, operations: parsedOperations }) });
        } catch (error) {
          for (const operation of parsedOperations) { try { await invoke("restore_local_pending", { operationId: operation.operationId }); } catch { /* restart recovery also restores SYNCING */ } }
          if (/401/.test(String(error))) setConnection("REAUTHENTICATION REQUIRED"); else setConnection("INTERNET AVAILABLE / HABFARMS UNREACHABLE");
          waiting += parsedOperations.length; throw error;
        }
        const data = await response.json().catch(() => null) as { code?: string; outcomes?: { operationId: string; code: string; receipt?: unknown; message?: string }[]; prepared?: { snapshotJson: string; claimsJson: string; signatureB64: string }; refreshError?: string } | null;
        if (response.status === 401) {
          for (const operation of parsedOperations) { try { await invoke("restore_local_pending", { operationId: operation.operationId }); } catch { /* restart recovery also restores SYNCING */ } }
          setConnection("REAUTHENTICATION REQUIRED"); waiting += parsedOperations.length;
          throw new Error("SESSION_EXPIRED");
        }
        if (!response.ok || !data?.outcomes) {
          for (const operation of parsedOperations) { try { await invoke("restore_local_pending", { operationId: operation.operationId }); } catch { /* restart recovery also restores SYNCING */ } }
          waiting += parsedOperations.length;
          throw new Error(data?.code ?? "SERVER_UNAVAILABLE");
        }
        const outcomes = new Map(data.outcomes.map((outcome) => [outcome.operationId, outcome]));
        for (const operation of parsedOperations) {
          const outcome = outcomes.get(operation.operationId);
          if (!outcome) { await invoke("restore_local_pending", { operationId: operation.operationId }); waiting++; continue; }
          if ((outcome.code === "SUCCESS" || outcome.code === "ALREADY_SYNCED") && outcome.receipt) {
            await invoke("save_local_sync_receipt", { operationId: operation.operationId, receiptJson: JSON.stringify(outcome.receipt) }); synced++;
          } else if (["OPERATION_ID_REUSED", "DAILY_PRODUCTION_EXISTS", "CONFLICT", "VALIDATION_FAILED", "AUTHORIZATION_FAILED", "ACCESS_BLOCKED"].includes(outcome.code)) {
            await invoke("mark_local_needs_attention", { operationId: operation.operationId, code: outcome.code }); needsAttention++;
          } else {
            await invoke("restore_local_pending", { operationId: operation.operationId }); waiting++;
          }
        }
        if (data.prepared) {
          const refreshed = await invoke<Prepared>("refresh_workspace_snapshot", data.prepared);
          setPrepared(refreshed); setSnapshot(JSON.parse(refreshed.snapshotJson)); refreshedAt = refreshed.synchronizedAt;
        } else if (data.refreshError) {
          setMessage("Entries synced. HabFarms could not refresh the farm snapshot; use Sync Now again after the service is available.");
        }
      }
      await reloadRows();
      setSyncSummary({ synced, needsAttention, waiting, lastSuccessfulSync: refreshedAt });
      if (!message) setMessage(`${synced} synced · ${needsAttention} need attention · ${waiting} remain queued.`);
    } catch (error) {
      await reloadRows();
      setSyncSummary({ synced, needsAttention, waiting, lastSuccessfulSync: refreshedAt });
      setMessage(friendly(error));
    } finally { setSyncing(false); setBusy(false); }
  }
  const projection = useMemo(() => snapshot ? projectLocalState(snapshot, rows) : null, [snapshot, rows]);
  const offline = connection !== "ONLINE" && connection !== "LOCAL SERVER";
  const serverAvailable = connection === "ONLINE" || connection === "LOCAL SERVER";
  const canRecord = !!prepared && !prepared.leaseExpired && prepared.operationCapabilities.includes("queue_mortality_v1") && prepared.operationCapabilities.includes("queue_daily_production_v1");
  const openEntry = (kind: EntryKind, existing?: DesktopOperationV1) => { setEditing(existing ?? null); setEntryKind(kind); setScreen("entries"); };
  async function persistDraft(operation: DesktopOperationV1, confirm: boolean) {
    setBusy(true); setMessage("");
    try {
      await invoke("save_local_draft", { operationJson: JSON.stringify(operation) });
      if (confirm) {
        await invoke("confirm_local_operation", { operationId: operation.operationId });
        setMessage("Saved on this computer. Waiting to sync."); setEntryKind(null); setEditing(null);
      } else { setMessage("Draft saved on this computer. It is not waiting to sync until you confirm it."); setEntryKind(null); setEditing(null); }
      await reloadRows();
    } catch (error) { setMessage(friendly(error)); }
    finally { setBusy(false); }
  }
  async function discardDraft(id: string) { setBusy(true); try { await invoke("discard_local_draft", { operationId: id }); await reloadRows(); setMessage("Draft discarded."); } catch (error) { setMessage(friendly(error)); } finally { setBusy(false); } }

  return <div className="app-shell">
    <header className="topbar"><img src="/habfarms-logo.svg" alt="HabFarms"/><span className="desktop-label">DESKTOP{stagingQa ? " · STAGING QA" : ""}</span><div className="top-actions"><span className={`status ${offline ? "muted" : "live"}`}>{connection}</span>{snapshot && <><button className="quiet" onClick={() => void lock(false)}>Switch farm</button><button className="quiet" onClick={() => void lock(false)}>Lock workspace</button></>}{token && <button className="quiet" onClick={() => void lock(true)}>Sign out</button>}</div></header>
    {message && <div className="notice" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss message">×</button></div>}
    {!snapshot ? <main className="auth-shell"><section className="auth-card">
      <p className="eyebrow">HABFARMS DESKTOP</p><h1>{token ? "Choose your farm" : entryMode === "online" ? "Sign in" : "Open offline"}</h1>
      <p className="auth-subtitle">{token ? "Prepare a farm for offline work on this computer." : entryMode === "online" ? "Sign in to your HabFarms account." : "Unlock a farm already saved on this computer."}</p>
      {!token && <div className="auth-tabs" role="tablist" aria-label="Sign-in method"><button role="tab" disabled={busy} aria-selected={entryMode === "online"} className={entryMode === "online" ? "active" : ""} onClick={() => { setEntryMode("online"); setMessage(""); }}>Sign in</button><button role="tab" disabled={busy} aria-selected={entryMode === "offline"} className={entryMode === "offline" ? "active" : ""} onClick={() => { setEntryMode("offline"); setMessage(""); }}>Open offline</button></div>}
      {token ? <div className="auth-flow"><div className="auth-account">Signed in as <strong>{verifiedEmail}</strong><button className="quiet" onClick={() => void lock(true)}>Sign out</button></div><label>Offline unlock secret<input type="password" minLength={8} value={pin} onChange={e => setPin(e.target.value)} autoComplete="new-password"/><small>Choose a secret you can use to open this farm on this computer.</small></label><div className="farm-options">{farms.map(f => <button className="farm-choice" disabled={busy || pin.length < 8 || !serverAvailable} key={f.id} onClick={() => void prepare(f.id)}><strong>{f.name}</strong><span>{f.role} · Prepare</span></button>)}{!farms.length && <p>No farms are available to this account.</p>}</div></div>
        : entryMode === "online" ? <form className="auth-flow" onSubmit={e => void login(e)}><label>Email<input type="email" required value={email} onChange={e => updateEmail(e.target.value)} autoComplete="username"/></label><label>Password<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label><label className="remember-row"><input type="checkbox" checked={rememberMe} onChange={e => updateRememberMe(e.target.checked)}/><span>Remember me on this computer</span></label><button className="primary auth-submit" disabled={busy || !serverAvailable}>{busy ? "Signing in…" : "Sign in"}</button></form>
        : <div className="auth-flow"><label>Account email<input type="email" value={email} onChange={e => updateEmail(e.target.value)} autoComplete="username"/></label><label>Offline unlock secret<input type="password" value={pin} onChange={e => setPin(e.target.value)} autoComplete="current-password"/></label><button className="primary auth-submit" disabled={busy || !email || !pin} onClick={() => void findLocal()}>{busy ? "Finding farms…" : "Find prepared farms"}</button>{localFarms.length > 0 && <div className="farm-options">{localFarms.map(f => <button className="farm-choice" key={f.farmId} disabled={busy} onClick={() => void unlock(f.farmId)}><strong>{f.farmName}</strong><span>Open farm →</span></button>)}</div>}</div>}
      {busy && <LoadingSkeleton label={token ? "Preparing farm data" : entryMode === "offline" ? localFarms.length ? "Opening your farm" : "Finding prepared farms" : "Signing in to HabFarms"}/>}
      {message && <p className="auth-message" role="alert">{message}</p>}
      <p className="auth-footnote">Offline entries are saved on this computer and wait to sync.</p>
    </section></main>
    : <><div className="farm-heading"><div><p className="eyebrow">PREPARED FARM</p><h1>{snapshot.farm.name}</h1><p>{snapshot.role} access · {snapshot.farm.timezone}</p></div><div className="freshness"><strong>{connection === "ONLINE" ? "ONLINE" : connection === "LOCAL SERVER" ? "LOCAL SERVER" : "OFFLINE"}</strong><span>Last synced {date(prepared!.synchronizedAt)}</span><span>Offline access until {date(prepared!.expiresAt)}</span></div></div>
      <nav className="tabs" aria-label="Desktop sections"><button className={screen === "home" ? "selected" : ""} onClick={() => setScreen("home")}>Overview</button><button className={screen === "flocks" ? "selected" : ""} onClick={() => setScreen("flocks")}>Flocks</button><button className={screen === "entries" ? "selected" : ""} onClick={() => { setEntryKind(null); setEditing(null); setScreen("entries"); }}>Offline entries {projection?.pendingCount ? `(${projection.pendingCount})` : ""}</button><button className={screen === "settings" ? "selected" : ""} onClick={() => setScreen("settings")}>Connection & settings</button></nav>
      <main className="workspace">{prepared!.leaseExpired && <div className="warning">Offline access has expired. Your snapshot, drafts, and queued entries are preserved. Reconnect and prepare the farm to record new entries.</div>}
        {screen === "home" && <><div className="summary-grid"><div className="metric"><span>Flocks</span><strong>{snapshot.flocks.length}</strong></div><div className="metric"><span>Birds at last sync</span><strong>{snapshot.flocks.every(f => f.currentLiveBirds !== null) ? snapshot.flocks.reduce((sum, f) => sum + (f.currentLiveBirds ?? 0), 0).toLocaleString() : "—"}</strong></div><div className="metric"><span>Waiting to sync</span><strong>{projection?.pendingCount ?? 0}</strong></div><div className="metric"><span>Needs attention</span><strong>{projection?.needsAttentionCount ?? 0}</strong></div></div>
          <section className="quick-actions"><button className="primary" disabled={!canRecord} onClick={() => openEntry("DAILY_PRODUCTION_V1")}>Record Production</button><button className="secondary" disabled={!canRecord} onClick={() => openEntry("MORTALITY_V1")}>Record Mortality</button></section>
          {!canRecord && !prepared!.leaseExpired && <p className="hint">Reconnect and prepare this farm before using offline entry on this workspace.</p>}
          <section className="card projection-card"><h2>Server-confirmed information</h2><p>The values below came from the last synchronized farm snapshot. Pending offline entries appear separately and do not change the confirmed values.</p><div className="projection-row"><span>Birds at last sync</span><strong>{snapshot.flocks.reduce((sum, f) => sum + (f.currentLiveBirds ?? 0), 0).toLocaleString()}</strong></div><div className="projection-row projected"><span>Projected population after pending local deaths/culls</span><strong>{projection?.mayIncludePendingOperations ? "—" : [...(projection?.projectedPopulation.values() ?? [])].reduce<number>((sum, n) => sum + (n ?? 0), 0).toLocaleString()}</strong></div><p className="hint">{projection?.mayIncludePendingOperations ? "The latest snapshot may already include a pending entry whose server response was lost. Sync to confirm its result before using projected totals." : "Projection uses the latest synchronized flock population and pending local operations. It is not server accepted."}</p></section>
          <section className="card"><h2>Egg production projection</h2>{!projection?.mayIncludePendingOperations && snapshot.eggGrades.filter(g => (projection?.pendingEggAdds.get(g.id) ?? 0) > 0).map(g => <div className="projection-row projected" key={g.id}><span>Pending {g.name} production</span><strong>{projection!.pendingEggAdds.get(g.id)!.toLocaleString()}</strong></div>)}{!projection?.mayIncludePendingOperations && !(projection?.pendingEggAdds.size) && <p>No pending production quantities.</p>}<p className="hint">{projection?.mayIncludePendingOperations ? "The latest snapshot may already include pending production. Sync to confirm before using projected additions." : "Pending additions are shown separately from server-confirmed egg inventory and production percentage."}</p></section>
          <section className="card"><h2>Farm information</h2><p>Snapshot last synchronized {date(snapshot.synchronizedAt)}. Reconnect to check current access.</p><button className="secondary" disabled={busy} onClick={() => void refresh()}>Check current access</button></section></>}
        {screen === "flocks" && <><section className="card"><h2>Flocks at last sync</h2><p>Server-confirmed flock population and reference information.</p><div className="flock-list">{snapshot.flocks.map(f => { const projected = projection?.projectedPopulation.get(f.id); return <div className="flock" key={f.id}><div><strong>{f.name}</strong><span>{f.breed || "Breed not recorded"} · {f.housePen || "House not recorded"} · {f.status}</span></div><div><strong>{f.currentLiveBirds ?? "—"}</strong><span>birds at last sync</span><strong className="projected-number">{projection?.mayIncludePendingOperations ? "—" : projected ?? "—"}</strong><span>projected after pending local operations</span></div></div>; })}{!snapshot.flocks.length && <p>No flocks were included in this snapshot.</p>}</div></section><section className="card"><h2>Egg inventory at last sync</h2><div className="flock-list">{(snapshot.eggInventory ?? []).map((grade) => <div className="flock" key={grade.gradeId}><strong>{grade.gradeName}{grade.isUnsorted ? " · awaiting grading" : ""}</strong><strong>{grade.eggs.toLocaleString()} eggs</strong></div>)}{!snapshot.eggInventory?.length && <p>Inventory will appear after the next successful sync refresh.</p>}</div>{snapshot.recentProduction?.length ? <p className="hint">Latest server production: {snapshot.recentProduction[0].eggsCollected.toLocaleString()} eggs · {snapshot.recentProduction[0].productionPercentage == null ? "percentage unavailable" : `${snapshot.recentProduction[0].productionPercentage}%`} on {snapshot.recentProduction[0].eventDate}</p> : null}</section></>}
        {screen === "entries" && <section className="card"><div className="section-heading"><div><h2>Offline entries</h2><p>Confirmed entries stay encrypted here until HabFarms accepts them.</p></div><div className="button-row"><button className="primary" disabled={busy || !token || !serverAvailable || !projection?.pendingCount} onClick={() => void syncNow()}>{syncing ? "Syncing…" : "Sync Now"}</button><button className="secondary" disabled={!canRecord || !!entryKind} onClick={() => openEntry("DAILY_PRODUCTION_V1")}>Record Production</button><button className="secondary" disabled={!canRecord || !!entryKind} onClick={() => openEntry("MORTALITY_V1")}>Record Mortality</button></div></div>
          {entryKind && snapshot && <OfflineEntryForm key={editing?.operationId ?? entryKind} kind={entryKind} existing={editing} snapshot={snapshot} rows={rows} busy={busy} onCancel={() => { setEntryKind(null); setEditing(null); }} onSave={persistDraft}/>}
          {projection && <div className="operation-groups">{(["DRAFT", "PENDING_SYNC", "NEEDS_ATTENTION", "SYNCED"] as const).map(state => { const group = projection.entries.filter(x => x.state === state); if (!group.length) return null; return <div className="operation-group" key={state}><h3>{state === "PENDING_SYNC" ? "Waiting to sync" : state === "DRAFT" ? "Drafts" : state === "NEEDS_ATTENTION" ? "Needs attention" : "Synced"}<span>{group.length}</span></h3>{group.map(({ operation, state: currentState }) => { const flock = snapshot.flocks.find(f => f.id === operation.flockId); const summary = operation.operationType === "MORTALITY_V1" ? `${operation.payload.quantity} deaths` : `${operation.payload.eggsCollected - operation.payload.crackedEggs} good eggs · ${operation.payload.deaths + operation.payload.culls} flock losses`; return <article className="operation" key={operation.operationId}><div><strong>{operation.operationType === "MORTALITY_V1" ? "Mortality" : "Daily production"} · {flock?.name ?? "Unknown flock"}</strong><span>{operation.eventDate} · {summary}</span><small>Entered {date(operation.createdAtLocal)}</small>{rows.find((row) => { try { return (JSON.parse(row.operationJson) as DesktopOperationV1).operationId === operation.operationId; } catch { return false; } })?.syncErrorCode && <small className="form-error">{syncErrorMessage(rows.find((row) => { try { return (JSON.parse(row.operationJson) as DesktopOperationV1).operationId === operation.operationId; } catch { return false; } })!.syncErrorCode!)}</small>}</div><span className={`operation-state ${currentState.toLowerCase()}`}>{currentState === "PENDING_SYNC" ? "Waiting to sync" : currentState.replaceAll("_", " ")}</span><div className="operation-actions">{currentState === "DRAFT" && <><button className="quiet" onClick={() => openEntry(operation.operationType, operation)}>Edit</button><button className="quiet danger" onClick={() => void discardDraft(operation.operationId)}>Discard</button><button className="secondary" disabled={!canRecord || busy} onClick={() => void persistDraft(operation, true)}>Confirm entry</button></>}</div></article>; })}</div>; })}</div>}
          <p className="hint sync-honesty">Waiting to sync: {projection?.pendingCount ?? 0} · Synced: {rows.filter((row) => row.state === "SYNCED").length} · Needs attention: {projection?.needsAttentionCount ?? 0}</p>{syncSummary.lastSuccessfulSync && <p className="hint">Last successful sync {date(syncSummary.lastSuccessfulSync)}</p>}{!token && projection?.pendingCount ? <button className="secondary" onClick={() => void syncNow()}>Sign in to sync</button> : null}<button className="quiet" onClick={() => void refreshRows()}>Refresh local entries</button>
        </section>}
        {screen === "settings" && <section className="card"><h2>Connection & access</h2><dl><dt>Connection</dt><dd>{connection}</dd><dt>Last synchronized</dt><dd>{date(snapshot.synchronizedAt)}</dd><dt>Offline access expires</dt><dd>{date(prepared!.expiresAt)}</dd><dt>Entries waiting to sync</dt><dd>{projection?.pendingCount ?? 0}</dd><dt>Needs attention</dt><dd>{projection?.needsAttentionCount ?? 0}</dd></dl><p>HabFarms rechecks your current account and farm permissions for every synchronization attempt. Unsynced entries remain encrypted on this computer.</p><button className="secondary" disabled={busy || !token || !serverAvailable || !projection?.pendingCount} onClick={() => void syncNow()}>{syncing ? "Syncing…" : "Sync Now"}</button><button className="secondary" disabled={busy} onClick={() => void refresh()}>Check current access</button></section>}
      </main></>}
  </div>;
}

function syncErrorMessage(code: string) {
  switch (code) {
    case "DAILY_PRODUCTION_EXISTS": return "Production already exists in HabFarms for this flock and date. Review that record before resolving this entry.";
    case "AUTHORIZATION_FAILED": return "Current farm access does not permit this entry to sync. Sign in and ask a Farm Admin to review access.";
    case "VALIDATION_FAILED": return "HabFarms rejected this entry under its current population, date, feed, or grade rules.";
    case "OPERATION_ID_REUSED": return "This operation ID was already used for different information. Contact HabFarms support.";
    default: return "HabFarms reported a conflict. Review the current farm record before resolving this entry.";
  }
}

function LoadingSkeleton({ label }: { label: string }) {
  return <div className="loading-skeleton" role="status" aria-live="polite">
    <span>{label}</span>
    <div className="skeleton-block skeleton-wide" aria-hidden="true"/><div className="skeleton-block" aria-hidden="true"/><div className="skeleton-block skeleton-short" aria-hidden="true"/>
  </div>;
}

function OfflineEntryForm({ kind, existing, snapshot, rows, busy, onCancel, onSave }: {
  kind: EntryKind; existing: DesktopOperationV1 | null; snapshot: Snapshot; rows: Stored[]; busy: boolean;
  onCancel: () => void; onSave: (operation: DesktopOperationV1, confirm: boolean) => Promise<void>;
}) {
  const production = kind === "DAILY_PRODUCTION_V1";
  const flocks = snapshot.flocks.filter(f => f.status === "active" && (f.currentLiveBirds ?? 0) > 0);
  const grades = snapshot.eggGrades.filter(g => !g.isUnsorted);
  const [flockId, setFlockId] = useState(existing?.flockId ?? (flocks.length === 1 ? flocks[0].id : ""));
  const [eventDate, setEventDate] = useState(existing?.eventDate ?? dateInZone(snapshot.farm.timezone));
  const [quantity, setQuantity] = useState(existing?.operationType === "MORTALITY_V1" ? String(existing.payload.quantity) : "");
  const payload = existing?.operationType === "DAILY_PRODUCTION_V1" ? existing.payload : null;
  const [eggs, setEggs] = useState(String(payload?.eggsCollected ?? "")); const [cracked, setCracked] = useState(String(payload?.crackedEggs ?? 0));
  const [lossDeaths, setLossDeaths] = useState(String(payload?.deaths ?? 0)); const [culls, setCulls] = useState(String(payload?.culls ?? 0));
  const [feed, setFeed] = useState(String(payload?.feedConsumedKg ?? 0)); const [feedType, setFeedType] = useState(payload?.feedTypeId ?? "");
  const [transportCost, setTransportCost] = useState(String(payload?.transportCost ?? 0)); const [otherCost, setOtherCost] = useState(String(payload?.otherCost ?? 0));
  const [notes, setNotes] = useState(existing?.payload.notes ?? ""); const [graded, setGraded] = useState((payload?.gradeAllocations.length ?? 0) > 0);
  const [allocations, setAllocations] = useState<Record<string, string>>(() => Object.fromEntries(grades.map(g => [g.id, String(payload?.gradeAllocations.find(a => a.eggGradeId === g.id)?.quantityEggs ?? 0)])));
  const [formError, setFormError] = useState("");
  const currentDraftId = existing?.operationId ?? newId();
  const before = useMemo(() => projectLocalState(snapshot, rows), [snapshot, rows]);
  const selectedFlock = snapshot.flocks.find(f => f.id === flockId);
  const baseBirds = selectedFlock?.currentLiveBirds ?? null;
  const projectedBirds = before.projectedPopulation.get(flockId) ?? null;
  const goodEggs = Number(eggs) - Number(cracked || 0);
  const allocated = Object.values(allocations).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const duplicate = production && rows.some(row => { try { const op = JSON.parse(row.operationJson) as DesktopOperationV1; return op.operationType === "DAILY_PRODUCTION_V1" && op.flockId === flockId && op.eventDate === eventDate && row.state !== "DRAFT" && row.state !== "SYNCED" && op.operationId !== existing?.operationId; } catch { return false; } });
  function buildOperation(): DesktopOperationV1 | null {
    setFormError("");
    if (!flockId) { setFormError("Choose an eligible flock."); return null; }
    if (!validCalendarDate(eventDate)) { setFormError("Choose a valid calendar date."); return null; }
    const now = timestamp(); const common = { operationId: currentDraftId, farmId: snapshot.farmId, flockId, schemaVersion: 1 as const, eventDate, createdAtLocal: existing?.createdAtLocal ?? now, queuedAtLocal: existing?.queuedAtLocal ?? now, dependencies: [] as string[] };
    if (!production) {
      const operation = { ...common, operationType: "MORTALITY_V1" as const, payload: { quantity: intValue(quantity), notes: notes.trim() } };
      const parsed = mortalityV1.safeParse(operation); if (!parsed.success) { setFormError(parsed.error.issues[0]?.message ?? "Check the mortality quantity and date."); return null; }
      if (projectedBirds !== null && operation.payload.quantity > projectedBirds) { setFormError(`Mortality is above the projected flock population (${projectedBirds.toLocaleString()}).`); return null; }
      return parsed.data;
    }
    if (graded && (!Number.isInteger(allocated) || allocated !== goodEggs)) { setFormError("Grade allocations must be whole numbers that equal the good eggs."); return null; }
    const gradeAllocations = graded ? grades.map(g => ({ eggGradeId: g.id, quantityEggs: intValue(allocations[g.id] ?? "0") })).filter(x => x.quantityEggs > 0) : [];
    const operation = { ...common, operationType: "DAILY_PRODUCTION_V1" as const, payload: { eggsCollected: intValue(eggs), crackedEggs: intValue(cracked), deaths: intValue(lossDeaths), culls: intValue(culls), feedConsumedKg: Number(feed), feedTypeId: feedType || null, transportCost: Number(transportCost), otherCost: Number(otherCost), notes: notes.trim(), gradeAllocations } };
    const parsed = dailyProductionV1.safeParse(operation); if (!parsed.success) { setFormError(parsed.error.issues[0]?.message ?? "Check the production values."); return null; }
    if (projectedBirds !== null && operation.payload.deaths + operation.payload.culls > projectedBirds) { setFormError(`Deaths and culls exceed the projected flock population (${projectedBirds.toLocaleString()}).`); return null; }
    return parsed.data;
  }
  async function save(confirm: boolean) { const operation = buildOperation(); if (operation) await onSave(operation, confirm); }
  const numeric = (label: string, value: string, set: (v: string) => void, step = 1, max = 2_000_000) => <label>{label}<input type="number" min="0" max={max} step={step} value={value} onChange={e => set(e.target.value)} onWheel={wheelGuard} inputMode={step === 1 ? "numeric" : "decimal"}/></label>;
  return <div className="entry-form"><div className="section-heading"><div><h3>{existing ? "Edit draft" : "New"} {production ? "daily production" : "mortality"}</h3><p>This is saved locally. Confirmation creates a pending entry and does not update the server snapshot.</p></div><button className="quiet" onClick={onCancel}>Close</button></div>
    <div className="form-grid"><label>Event date<input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}/></label><label>Flock<select value={flockId} onChange={e => setFlockId(e.target.value)}><option value="">Select flock</option>{flocks.map(f => <option key={f.id} value={f.id}>{f.name} · {f.currentLiveBirds?.toLocaleString() ?? "—"} at last sync</option>)}</select></label></div>
    {selectedFlock && <p className="form-context">Last synced: {baseBirds?.toLocaleString() ?? "Population unavailable"} birds · projected after pending entries: {projectedBirds?.toLocaleString() ?? "Unavailable"}</p>}
    {production ? <><div className="form-grid">{numeric("Eggs collected", eggs, setEggs)}{numeric("Cracked eggs", cracked, setCracked)}{numeric("Deaths", lossDeaths, setLossDeaths)}{numeric("Culls", culls, setCulls)}</div><p className="form-context">Good eggs for production/inventory accounting: {Number.isFinite(goodEggs) ? Math.max(0, goodEggs).toLocaleString() : "—"}. Cracked eggs are excluded, following the web production workflow.</p>
      <fieldset><legend>Grade recording</legend><label className="inline"><input type="radio" checked={!graded} onChange={() => setGraded(false)}/>Store as Unsorted</label><label className="inline"><input type="radio" checked={graded} onChange={() => setGraded(true)}/>Grade now</label>{graded && <div className="form-grid grade-grid">{grades.map(g => numeric(`${g.name} eggs`, allocations[g.id] ?? "0", value => setAllocations(x => ({ ...x, [g.id]: value }))))}</div>}{graded && <p className="form-context">Allocated {allocated.toLocaleString()} · good eggs {Number.isFinite(goodEggs) ? goodEggs.toLocaleString() : "—"} · values must match</p>}</fieldset>
      <div className="form-grid">{numeric("Feed consumed (kg)", feed, setFeed, 0.001, 1_000_000)}<label>Feed type<select value={feedType} onChange={e => setFeedType(e.target.value)}><option value="">{snapshot.feedTypes.length ? "Choose feed type" : "No feed types prepared"}</option>{snapshot.feedTypes.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select><small>Required when feed is recorded. Stock availability is checked by the server during a later sync.</small></label>{numeric("Transport cost", transportCost, setTransportCost, 0.01, 1_000_000_000)}{numeric("Other cost", otherCost, setOtherCost, 0.01, 1_000_000_000)}</div>
      {duplicate && <div className="warning">Another pending production draft/entry exists for this flock and date. The server may also have a record added on another device since last sync.</div>}
      {baseBirds === null && <div className="warning">The synchronized snapshot has no flock population. Local loss validation cannot compare this entry with population.</div>}
      <p className="hint">Projected production percentage is unavailable because the snapshot does not include eligible layer counts. No authoritative percentage is shown.</p>
    </> : <>{numeric("Birds died", quantity, setQuantity)}{baseBirds === null && <div className="warning">The synchronized snapshot has no flock population. Local safety validation is limited to a positive whole number.</div>}</>}
    <label>Notes<textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}/></label>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="button-row"><button className="secondary" disabled={busy} onClick={() => void save(false)}>Save Draft</button><button className="primary" disabled={busy || !flocks.length} onClick={() => void save(true)}>Save Offline / Confirm Entry</button><button className="quiet" onClick={onCancel}>Cancel</button></div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
