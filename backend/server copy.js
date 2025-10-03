// backend/server.js
import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import express from "express";
import cors from "cors";

// -------------------- Config --------------------
const BITQUERY_API_KEY = "ory_at_dOUgc919s2lrvw-0DCAOisBO1bVtJqHzvbTPk9cpH10.WNFhXWQ7F95DuHT19psMP--f-PhEHVusDIbFT-iWZKU";
const BITQUERY_ENDPOINT = "https://streaming.bitquery.io/eap";
const MONGO_URI = "mongodb+srv://PumpBot:WZZTZdwnzRuontvu@thepillz.e3ck3os.mongodb.net/pumpfun?retryWrites=true&w=majority";

// 🔑 Cookie Axiom (trebuie să pui unul valid)
const COOKIE = "ph_phc_7bPgugSDujyCK9a1776BMM9UMGTNl2bUxGyg2UJuykr_posthog=%7B%22distinct_id%22%3A%220194cdf9-e3d1-7818-9482-3ead9a1829af%22%2C%22%24sesid%22%3A%5B1738623526661%2C%220194cdf9-e3d0-757b-a4a5-28095f8c5c93%22%2C1738622493648%5D%2C%22%24epp%22%3Atrue%2C%22%24initial_person_info%22%3A%7B%22r%22%3A%22%24direct%22%2C%22u%22%3A%22https%3A%2F%2Faxiom.trade%2F%40professor%22%7D%7D; auth-refresh-token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWZyZXNoVG9rZW5JZCI6IjhjNjA2YjdmLTkwZWEtNGE5Zi1iNDQyLTZiZWM5MWMwN2EyZCIsImlhdCI6MTc1NzM1MjQ3OH0.7EwcaWqh1Q3Tq4Cyu3n0EW-zU5Du1fOOrFd_2_RAbw8; auth-access-token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdXRoZW50aWNhdGVkVXNlcklkIjoiYjI4OTljMjAtNjRmMC00MzZlLTgxZmYtNTE4N2NhMzQ1MjU5IiwiaWF0IjoxNzU5NDMyNDAxLCJleHAiOjE3NTk0MzMzNjF9.G2ZdmxlA1Wtk2ZqBPAvHx8PjZCmaArKb306zfb8k2s0";

const client = new MongoClient(MONGO_URI);
const app = express();
app.use(cors());
app.use(express.json());

let nextFetchTime = null;

// -------------------- Helpers Bitquery --------------------
async function runQuery(query) {
  const res = await fetch(BITQUERY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BITQUERY_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.errors) {
      console.error("❌ Bitquery error:", JSON.stringify(data.errors, null, 2));
      return null;
    }
    return data.data;
  } catch (e) {
    console.error("❌ Nu am putut parsa răspunsul Bitquery:", text);
    return null;
  }
}

async function getCreatorByMint(mint) {
  const query = `
    query Creator {
      Solana {
        Instructions(
          where: {
            Instruction: {
              Program: { Name: { is: "pump" }, Method: { is: "create" } }
              Accounts: { includes: { Address: { is: "${mint}" } } }
            }
          }
          limit: { count: 1 }
        ) {
          Block { Time }
          Transaction { Signature Signer }
        }
      }
    }
  `;
  const data = await runQuery(query);
  const instr = data?.Solana?.Instructions?.[0];
  if (!instr) return null;
  return {
    mint,
    signer: instr.Transaction.Signer,
    createSig: instr.Transaction.Signature,
    createTime: instr.Block.Time,
  };
}

// -------------------- Helpers Axiom --------------------
async function getDevTokens(dev) {
  const url = `https://api6.axiom.trade/dev-tokens-v2?devAddress=${dev}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "accept": "application/json, text/plain, */*",
      "cookie": COOKIE,
      "origin": "https://axiom.trade",
      "referer": "https://axiom.trade/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getLatestMintForCreator(db, creator) {
  const col = db.collection("migrated_tokens");
  const token = await col.find({ creator }).sort({ migrateTime: -1 }).limit(1).next();
  return token ? token.mint : null;
}

// -------------------- Migrates Checker --------------------
async function checkMigrates(col) {
  const query = `
    query LastMigrates {
      Solana {
        Instructions(
          where: {
            Instruction: { Program: { Name: { is: "pump" }, Method: { is: "migrate" } } }
          }
          orderBy: { descending: Block_Time }
          limit: { count: 100 }
        ) {
          Block { Time }
          Transaction { Signature }
          Instruction { Accounts { Address } }
        }
      }
    }
  `;

  const data = await runQuery(query);
  if (!data) return;

  const migrates = data.Solana?.Instructions || [];
  let added = 0;

  for (let mig of migrates) {
    const migrateSig = mig.Transaction.Signature;
    const migrateTime = mig.Block.Time;
    const mint = mig.Instruction.Accounts?.[2]?.Address;
    if (!mint) continue;

    const exists = await col.findOne({ mint });
    if (exists) continue;

    console.log("\n🚀 Token NOU MIGRATED");
    console.log("🕒", migrateTime);
    console.log("🔗", `https://explorer.solana.com/tx/${migrateSig}`);
    console.log("💊 Mint:", mint);

    let record = {
      mint,
      migrateSig,
      migrateTime,
      insertedAt: new Date(),
    };

    const creatorInfo = await getCreatorByMint(mint);
    if (creatorInfo) {
      record.creator = creatorInfo.signer;
      record.createSig = creatorInfo.createSig;
      record.createTime = creatorInfo.createTime;
      console.log("👤 Creator:", creatorInfo.signer);
    }

    await col.insertOne(record);
    console.log("✅ Salvat în MongoDB");
    added++;
  }

  console.log(`📊 Runda completă → ${added} tokenuri noi adăugate.`);
}

// -------------------- Timer --------------------
function startTimer(intervalMs) {
  nextFetchTime = Date.now() + intervalMs;
  setInterval(() => {
    if (!nextFetchTime) return;
    const diff = nextFetchTime - Date.now();
    if (diff <= 0) return;
    const min = Math.floor(diff / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    process.stdout.write(`\r⏳ Următorul fetch în: ${min}m ${sec}s   `);
  }, 1000);
}

// -------------------- Main --------------------
async function main() {
  await client.connect();
  console.log("✅ Conectat la MongoDB Atlas!");
  const db = client.db("pumpfun");
  const col = db.collection("migrated_tokens");
  const goodCol = db.collection("good_devs");

  await col.createIndex({ mint: 1 }, { unique: true });
  await goodCol.createIndex({ creator: 1 }, { unique: true });

  console.log("🔴 Monitorizez migrates la fiecare 15 minute...");
  await checkMigrates(col);

  const interval = 15 * 60 * 1000;
  setInterval(async () => {
    await checkMigrates(col);
    nextFetchTime = Date.now() + interval;
  }, interval);

  startTimer(interval);

  // -------------------- API endpoints --------------------
  app.get("/", (req, res) => res.send("✅ Backend rulează!"));

  app.get("/migrated-tokens", async (req, res) => {
    const tokens = await col.find().sort({ migrateTime: -1 }).limit(500).toArray();
    res.json(tokens);
  });

  app.get("/next-fetch", (req, res) => {
    if (!nextFetchTime) return res.json({ nextFetch: null });
    const diff = nextFetchTime - Date.now();
    const min = Math.floor(diff / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    res.json({ nextFetch: `${min}m ${sec}s` });
  });

  app.get("/good-devs", async (req, res) => {
    const devs = await goodCol.find().sort({ migrated: -1 }).toArray();
    res.json(devs);
  });

// backend/server.js (doar fragment modificat pentru clarity)

// Endpoint SSE: /scan-good-devs-stream?force=true|false
app.get("/scan-good-devs-stream", async (req, res) => {
  const force = req.query.force === "true";
  // headers SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  const creators = (await col.distinct("creator")).filter(c => c && c !== "?");
  let scanned = 0, saved = 0, skipped = 0;

  const send = (event, payload) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      console.error("SSE write error:", e.message);
    }
  };

  send("started", { total: creators.length, force });

  for (const dev of creators) {
    if (res.writableEnded) break;

    // dacă a mai fost scanat deja și nu e force => îl ignorăm complet
    if (!force) {
      const already = await db.collection("scan_results").findOne({ creator: dev, scanned: true });
      if (already) {
        skipped++;
        continue; // ⚡ nu mai trimitem nimic în frontend
      }
    }

    send("scanning", { creator: dev });

    try {
      const data = await getDevTokens(dev);
      const tokens = data?.tokens || [];
      const migrated = tokens.filter(t => t.migrated).length;
      const nonMigrated = tokens.filter(t => !t.migrated).length;

      const record = {
        creator: dev,
        migrated,
        nonMigrated,
        latestMint: migrated > 0 && nonMigrated === 0 ? await getLatestMintForCreator(db, dev) : null,
        checkedAt: new Date(),
        scanned: true,
        isLive: true
      };

      await db.collection("scan_results").updateOne({ creator: dev }, { $set: record }, { upsert: true });

      if (migrated > 0 && nonMigrated === 0) {
        await goodCol.updateOne({ creator: dev }, { $set: record }, { upsert: true });
        saved++;
        send("found", record);
      } else {
        send("not_found", record);
      }
    } catch (err) {
      console.error(`⚠️ Eroare pentru ${dev}: ${err.message}`);
      send("error", { creator: dev, message: err.message });
    }

    scanned++;
    await new Promise(r => setTimeout(r, 3000));
  }

  send("done", { scanned, saved, skipped });
  res.end();
});


// 🔹 Endpoint nou pentru toate rezultatele istorice
app.get("/scan-results", async (req, res) => {
  const results = await client.db("pumpfun").collection("scan_results")
    .find()
    .sort({ checkedAt: -1 })
    .limit(200)
    .toArray();

  res.json(results);
});

// backend/server.js – la final, lângă celelalte endpointuri

// 🔹 Endpoint pentru ultimele rezultate live (doar ce s-a scanat în runda curentă)
app.get("/scan-results-live", async (req, res) => {
  try {
    const results = await client.db("pumpfun").collection("scan_results")
      .find({ isLive: true })        // filtrăm doar rezultatele live
      .sort({ checkedAt: -1 })
      .toArray();

    res.json(results);

    // după ce le trimitem, resetăm flag-ul ca să nu apară în următorul call
    await client.db("pumpfun").collection("scan_results").updateMany(
      { isLive: true },
      { $set: { isLive: false } }
    );

  } catch (err) {
    console.error("❌ /scan-results-live:", err);
    res.status(500).json({ error: "Eroare la scan-results-live" });
  }
});


  
  
  

  app.listen(5000, () => console.log("🚀 Backend pornit pe http://localhost:5000"));
}

main().catch(console.error);
