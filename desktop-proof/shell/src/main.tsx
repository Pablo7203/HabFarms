import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [userId, setUserId] = useState("synthetic-user-a");
  const [farmId, setFarmId] = useState("synthetic-farm-a");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("Synthetic Secret Farm A");
  const [quantity, setQuantity] = useState(5);
  const [operationId, setOperationId] = useState<string>(crypto.randomUUID());
  const [output, setOutput] = useState("Open a synthetic workspace to begin.");
  async function run<T>(command: string, args: Record<string, unknown>) {
    try { setOutput(JSON.stringify(await invoke<T>(command, args))); }
    catch (error) { setOutput(String(error)); }
  }
  return <main style={{ fontFamily: "system-ui", maxWidth: 620, margin: "2rem auto" }}>
    <h1>HabFarms desktop engineering proof</h1>
    <p>Synthetic local workspace only. This screen does not authenticate with Supabase.</p>
    <label>User ID <input value={userId} onChange={e => setUserId(e.target.value)} /></label><br />
    <label>Farm ID <input value={farmId} onChange={e => setFarmId(e.target.value)} /></label><br />
    <label>Offline unlock secret <input type="password" value={pin} onChange={e => setPin(e.target.value)} /></label><br />
    <button onClick={() => run("open_workspace", { userId, farmId, pin })}>Open workspace</button>
    <hr />
    <label>Farm name <input value={name} onChange={e => setName(e.target.value)} /></label>
    <button onClick={() => run("save_snapshot", { farmId, name })}>Save encrypted snapshot</button>
    <hr />
    <label>Mortality <input type="number" min="1" value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label><br />
    <label>Operation ID <input value={operationId} onChange={e => setOperationId(e.target.value)} /></label><br />
    <button onClick={() => run("save_draft", { operationId, farmId, quantity })}>Save draft</button>
    <button onClick={() => run("queue_operation", { operationId })}>Queue offline</button>
    <button onClick={() => run("read_operation", { operationId })}>Read operation</button>
    <pre>{output}</pre>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
