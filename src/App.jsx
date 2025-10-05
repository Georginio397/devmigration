// frontend/App.jsx
import React, { useEffect, useState } from "react";
import "./App.css";

export default function App() {
  const API_URL = "https://devmigbackend-production-61a0.up.railway.app";

  const [activeTab, setActiveTab] = useState("migrates");
  const [tokens, setTokens] = useState([]);
  const [goodDevs, setGoodDevs] = useState([]);
  const [scanResultsLive, setScanResultsLive] = useState([]);
  const [scanResultsHistory, setScanResultsHistory] = useState([]);
  const [nextFetch, setNextFetch] = useState("...");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  // ==== Monitoring ====
  const [wallets, setWallets] = useState([]);
  const [newWallet, setNewWallet] = useState("");
  const [events, setEvents] = useState([]);
  const [loadingWallets, setLoadingWallets] = useState(false);

  // ====== API loaders ======
  const loadTokens = async () => {
    const res = await fetch(`${API_URL}/migrated-tokens`);
    const data = await res.json();
    setTokens(data);
    setLastUpdated(new Date().toLocaleTimeString());
  };

  const loadGoodDevs = async () => {
    const res = await fetch(`${API_URL}/good-devs`);
    const data = await res.json();
    setGoodDevs(data);
  };

  const loadScanHistory = async () => {
    const res = await fetch(`${API_URL}/scan-results`);
    const data = await res.json();
    setScanResultsHistory(data);
  };

  const loadNextFetch = async () => {
    try {
      const res = await fetch(`${API_URL}/next-fetch`);
      const data = await res.json();
      setNextFetch(data.nextFetch || "...");
      if (data.nextFetch === "0m 0s") {
        loadTokens();
        loadGoodDevs();
        loadScanHistory();
      }
    } catch (err) {
      console.error("❌ Failed to fetch /next-fetch:", err.message);
    }
  };

  // ===== Monitoring load functions =====
  const loadWallets = async () => {
    try {
      setLoadingWallets(true);
      const res = await fetch(`${API_URL}/monitored-wallets`);
      const data = await res.json();
      setWallets(data);
    } catch (err) {
      console.error("❌ Failed to load wallets:", err.message);
    } finally {
      setLoadingWallets(false);
    }
  };

  const addWallet = async () => {
    if (!newWallet.trim()) return;
    try {
      const res = await fetch(`${API_URL}/monitored-wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: newWallet.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert("❌ " + (err.error || "Error adding wallet"));
        return;
      }
      setNewWallet("");
      loadWallets();
    } catch (err) {
      console.error("❌ Add wallet error:", err.message);
    }
  };

  const deleteWallet = async (wallet) => {
    if (!window.confirm(`Ștergi walletul ${wallet}?`)) return;
    try {
      const res = await fetch(`${API_URL}/monitored-wallets/${wallet}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        alert("❌ " + (err.error || "Error deleting wallet"));
        return;
      }
      loadWallets();
    } catch (err) {
      console.error("❌ Delete wallet error:", err.message);
    }
  };

  const loadEvents = async () => {
    try {
      const res = await fetch(`${API_URL}/monitor-events`);
      const data = await res.json();
      setEvents(data);
    } catch (err) {
      console.error("❌ Load events error:", err.message);
    }
  };

  // ====== Delete good dev ======
  const deleteGoodDev = async (creator) => {
    if (!window.confirm(`Sigur vrei să ștergi ${creator}?`)) return;
    try {
      const res = await fetch(`${API_URL}/good-dev/${creator}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setGoodDevs((prev) => prev.filter((d) => d.creator !== creator));
      } else {
        const err = await res.json();
        alert("❌ Eroare la ștergere: " + err.error);
      }
    } catch (err) {
      alert("❌ Request error: " + err.message);
    }
  };

  // ====== Scan button ======
  const scanGoodDevs = (force = false) => {
    setScanning(true);
    setScanMsg(force ? "Rescan all..." : "Scanning new creators...");
    setScanResultsLive([]);

    const es = new EventSource(`${API_URL}/scan-good-devs-stream?force=${force}`);

    es.addEventListener("started", (e) => {
      try {
        const d = JSON.parse(e.data);
        setScanMsg(`Started scan (${d.total} creators)`);
      } catch {}
    });

    es.addEventListener("scanning", (e) => {
      try {
        const d = JSON.parse(e.data);
        setScanMsg(`Scanning: ${d.creator}`);
      } catch {}
    });

    es.addEventListener("found", (e) => {
      try {
        const record = JSON.parse(e.data);
        setScanResultsLive((prev) => [record, ...prev]);
      } catch {}
    });

    es.addEventListener("not_found", (e) => {
      try {
        const d = JSON.parse(e.data);
        setScanMsg(`Checked: ${d.creator} (no valid pool)`);
      } catch {}
    });

    es.addEventListener("done", (e) => {
      try {
        const stats = JSON.parse(e.data);
        setScanMsg(
          `Done: scanned=${stats.scanned}, saved=${stats.saved}, skipped=${stats.skipped}`
        );
      } catch {}
      setScanning(false);
      loadGoodDevs();
      loadScanHistory();
      es.close();
    });

    es.onerror = (err) => {
      console.error("EventSource error", err);
      setScanMsg("Connection closed or error");
      setScanning(false);
      es.close();
    };
  };

  // ====== Lifecycle ======
  useEffect(() => {
    loadTokens();
    loadGoodDevs();
    loadScanHistory();
    loadWallets();
    loadEvents();
    const interval = setInterval(loadNextFetch, 1000);
    return () => clearInterval(interval);
  }, []);

  // ====== Render ======
  return (
    <div style={{ padding: "20px" }}>
      <h1>Pump.fun Monitor</h1>

      {/* Tabs */}
      <div style={{ marginBottom: "20px" }}>
        <button className={activeTab === "migrates" ? "active" : ""} onClick={() => setActiveTab("migrates")}>
          Migrări
        </button>
        <button className={activeTab === "goodDevs" ? "active" : ""} onClick={() => setActiveTab("goodDevs")}>
          Good Devs
        </button>
        <button className={activeTab === "monitoring" ? "active" : ""} onClick={() => setActiveTab("monitoring")}>
          Monitoring
        </button>
      </div>

      <p>⏳ Next fetch in: <b>{nextFetch}</b></p>
      <p>🕒 Last updated: <b>{lastUpdated}</b></p>

      {/* ===== MIGRATES TAB ===== */}
      {activeTab === "migrates" && (
        <div>
          <h2>Migrated Tokens</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Mint</th><th>Creator</th><th>Migrate Time</th></tr></thead>
              <tbody>
                {tokens.map((t, i) => (
                  <tr key={i}><td>{t.mint}</td><td>{t.creator || "?"}</td><td>{t.migrateTime}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== GOOD DEVS TAB ===== */}
      {activeTab === "goodDevs" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <button onClick={() => scanGoodDevs(false)} disabled={scanning}>Scan new</button>
            <span style={{ color: "#a8a8a8" }}>{scanMsg}</span>
          </div>
          <h2>Good Devs (Saved)</h2>
          <table>
            <thead><tr><th>Creator</th><th>Migrated</th><th>Checked At</th><th>Pool</th><th>Action</th></tr></thead>
            <tbody>
              {goodDevs.map((d, i) => (
                <tr key={i}>
                  <td>{d.creator}</td>
                  <td>{d.migrated}</td>
                  <td>{new Date(d.checkedAt).toLocaleString()}</td>
                  <td>{d.pool ? <a href={`https://axiom.trade/meme/${d.pool}`} target="_blank" rel="noreferrer">{d.pool}</a> : "—"}</td>
                  <td><button style={{ background: "red", color: "white" }} onClick={() => deleteGoodDev(d.creator)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== MONITORING TAB ===== */}
      {activeTab === "monitoring" && (
        <div>
          <h2>Wallet Monitoring</h2>

          {/* Add wallet */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Adaugă wallet..."
              value={newWallet}
              onChange={(e) => setNewWallet(e.target.value)}
              style={{ flex: 1, padding: 8 }}
            />
            <button onClick={addWallet}>Add</button>
            <button onClick={loadWallets}>Refresh</button>
          </div>

          {/* Wallet list */}
          <table>
            <thead><tr><th>Wallet</th><th>Added</th><th>Action</th></tr></thead>
            <tbody>
              {wallets.length > 0 ? wallets.map((w, i) => (
                <tr key={i}>
                  <td>{w.wallet}</td>
                  <td>{w.insertedAt ? new Date(w.insertedAt).toLocaleString() : "—"}</td>
                  <td><button style={{ background: "red", color: "white" }} onClick={() => deleteWallet(w.wallet)}>Delete</button></td>
                </tr>
              )) : (
                <tr><td colSpan="3">{loadingWallets ? "Loading..." : "No wallets added"}</td></tr>
              )}
            </tbody>
          </table>

          {/* Events */}
          <h3 style={{ marginTop: 25 }}>Last Events</h3>
          <div className="table-scroll">
            <table className="scan-results">
              <thead><tr><th>Wallet</th><th>Mint</th><th>Pool</th><th>Tx</th><th>Time</th></tr></thead>
              <tbody>
                {events.length > 0 ? events.map((e, i) => (
                  <tr key={i}>
                    <td>{e.wallet}</td>
                    <td>{e.mint}</td>
                    <td>{e.pool}</td>
                    <td><a href={`https://explorer.solana.com/tx/${e.txSig}`} target="_blank" rel="noreferrer">view</a></td>
                    <td>{new Date(e.time).toLocaleString()}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="5">No events logged yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
