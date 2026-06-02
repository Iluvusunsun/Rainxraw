const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'rainx-changeme';

// ─── DATABASE ────────────────────────────────────────────────────
const DB_DIR = process.env.DB_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'rainx.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lang TEXT DEFAULT 'plaintext',
    content TEXT NOT NULL,
    visibility TEXT DEFAULT 'public',
    expire TEXT DEFAULT 'never',
    expire_at INTEGER,
    views INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

// ─── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

function checkExpired(paste) {
  if (!paste) return null;
  if (paste.expire === 'never') return paste;
  if (paste.expire_at && Date.now() > paste.expire_at) {
    db.prepare('DELETE FROM pastes WHERE id = ?').run(paste.id);
    return null;
  }
  return paste;
}
function expireMs(e) {
  return { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }[e] || null;
}
function requireKey(req, res, next) {
  const key = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (key !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}
function optionalKey(req) {
  return (req.headers['authorization'] || '').replace('Bearer ', '').trim();
}

// ─── API ─────────────────────────────────────────────────────────
app.get('/api/raw/:id', (req, res) => {
  const paste = checkExpired(db.prepare('SELECT * FROM pastes WHERE id = ?').get(req.params.id));
  if (!paste) return res.status(404).send('Not found');
  if (paste.visibility === 'private' && optionalKey(req) !== API_KEY)
    return res.status(403).send('Private — API key required');
  db.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').run(paste.id);
  res.type('text/plain').send(paste.content);
});

app.get('/api/paste/:id', (req, res) => {
  const paste = checkExpired(db.prepare('SELECT * FROM pastes WHERE id = ?').get(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Not found' });
  if (paste.visibility === 'private' && optionalKey(req) !== API_KEY)
    return res.status(403).json({ error: 'Private — API key required' });
  const { content, ...meta } = paste;
  res.json({ ...meta, raw_url: `/api/raw/${paste.id}` });
});

app.post('/api/paste', (req, res) => {
  const { name = 'untitled', lang = 'plaintext', content, visibility = 'public', expire = 'never' } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  const id = nanoid(8);
  const created_at = Date.now();
  const ms = expireMs(expire);
  db.prepare(`INSERT INTO pastes (id,name,lang,content,visibility,expire,expire_at,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, name, lang, content, visibility, expire, ms ? created_at + ms : null, created_at);
  res.status(201).json({ id, url: `/p/${id}`, raw_url: `/api/raw/${id}` });
});

app.get('/api/list', requireKey, (req, res) => {
  const pastes = db.prepare('SELECT id,name,lang,visibility,expire,views,created_at FROM pastes ORDER BY created_at DESC').all();
  res.json({ total: pastes.length, pastes });
});

app.delete('/api/paste/:id', requireKey, (req, res) => {
  const r = db.prepare('DELETE FROM pastes WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ─── FRONTEND (embedded) ──────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rainx — Raw Storage</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0f;--surface:#111118;--border:#1e1e2e;--border2:#2e2e4e;--accent:#7c3aed;--accent2:#06b6d4;--glow:rgba(124,58,237,0.3);--text:#e2e2f0;--muted:#5a5a7a;--danger:#ef4444;--ok:#22c55e;--code:#0d0d16}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh}
body::after{content:'';position:fixed;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);z-index:100}

header{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:56px;border-bottom:1px solid var(--border);background:rgba(10,10,15,.9);backdrop-filter:blur(12px);position:sticky;top:0;z-index:50;gap:10px;flex-wrap:wrap}
.logo{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:3px;background:linear-gradient(135deg,#fff,var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;flex-shrink:0}
.logo span{background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.key-wrap{display:flex;align-items:center;gap:6px;flex:1;max-width:320px}
.key-input{background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--muted);font-family:'Space Mono',monospace;font-size:10px;padding:5px 10px;width:100%;outline:none}
.key-input:focus{border-color:var(--accent);color:var(--text)}
.badge{font-family:'Space Mono',monospace;font-size:9px;padding:3px 8px;border-radius:2px;border:1px solid var(--border2);color:var(--muted);letter-spacing:1px;white-space:nowrap;flex-shrink:0}

.container{max-width:900px;margin:0 auto;padding:24px 16px}
.tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:24px}
.tab{font-family:'Space Mono',monospace;font-size:10px;letter-spacing:1px;padding:10px 16px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);transition:all .2s;text-transform:uppercase;background:none;border-top:none;border-left:none;border-right:none}
.tab:hover{color:var(--text)}.tab.active{color:var(--accent2);border-bottom-color:var(--accent2)}
.panel{display:none}.panel.active{display:block}

.form-group{margin-bottom:16px}
label{display:block;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:1px;color:var(--muted);margin-bottom:6px;text-transform:uppercase}
input[type=text],select,textarea{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;padding:10px 12px;outline:none;transition:border-color .2s}
input[type=text]:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--glow)}
textarea{font-family:'Space Mono',monospace;font-size:12px;line-height:1.7;resize:vertical;min-height:200px;background:var(--code)}
select{cursor:pointer}select option{background:var(--surface)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:480px){.row{grid-template-columns:1fr}}

.btn{font-family:'Space Mono',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:10px 20px;border-radius:3px;border:none;cursor:pointer;transition:all .2s}
.btn-primary{background:var(--accent);color:#fff;box-shadow:0 0 20px var(--glow)}
.btn-primary:hover{background:#6d28d9;transform:translateY(-1px)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-ghost:hover{color:var(--text);border-color:var(--border2)}
.btn-outline{background:transparent;color:var(--accent2);border:1px solid var(--accent2)}
.btn-outline:hover{background:rgba(6,182,212,.1)}

.result-box{display:none;margin-top:20px;background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.result-box.show{display:block}
.result-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);background:rgba(124,58,237,.05)}
.result-title{font-family:'Space Mono',monospace;font-size:10px;color:var(--ok);letter-spacing:1px}
.result-url{font-family:'Space Mono',monospace;font-size:11px;padding:12px 14px;color:var(--accent2);word-break:break-all;cursor:pointer}
.result-url:hover{text-decoration:underline}
.result-sub{padding:0 14px 12px;font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);word-break:break-all}

.stats-bar{display:flex;gap:20px;margin-bottom:20px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;flex-wrap:wrap}
.stat{display:flex;flex-direction:column;gap:2px}
.stat-val{font-family:'Space Mono',monospace;font-size:18px;color:var(--accent2)}
.stat-label{font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);letter-spacing:1px}

.paste-list{display:flex;flex-direction:column;gap:8px}
.paste-item{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;transition:border-color .2s;cursor:pointer}
.paste-item:hover{border-color:var(--border2)}
.paste-info{flex:1;min-width:0}
.paste-name{font-size:13px;font-weight:500;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.paste-meta{font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}
.paste-actions{display:flex;gap:6px;flex-shrink:0}
.icon-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:5px 8px;border-radius:3px;cursor:pointer;font-size:10px;font-family:'Space Mono',monospace;transition:all .2s;white-space:nowrap}
.icon-btn:hover{border-color:var(--border2);color:var(--text)}
.icon-btn.del:hover{border-color:var(--danger);color:var(--danger)}

.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);z-index:200;align-items:center;justify-content:center;padding:16px}
.modal-overlay.show{display:flex}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:8px;width:100%;max-width:800px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);gap:8px}
.modal-title{font-family:'Space Mono',monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.modal-actions{display:flex;gap:6px;flex-shrink:0}
.modal-body{position:relative;flex:1;overflow:auto}
.code-block{font-family:'Space Mono',monospace;font-size:12px;line-height:1.7;padding:16px;color:#a8b4d8;white-space:pre-wrap;word-break:break-word;background:var(--code);min-height:150px;transition:filter .3s}
.code-block.guarded{filter:blur(8px);user-select:none}

.guard-overlay{position:absolute;inset:0;background:rgba(10,10,15,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10;opacity:0;pointer-events:none;transition:opacity .3s;backdrop-filter:blur(4px);cursor:pointer}
.guard-overlay.active{opacity:1;pointer-events:all}
.guard-ring{position:absolute;border-radius:50%;border:1px solid rgba(124,58,237,.2);animation:ring 3s linear infinite}
.guard-ring:nth-child(1){width:160px;height:160px}
.guard-ring:nth-child(2){width:230px;height:230px;border-color:rgba(6,182,212,.15);animation-duration:4s;animation-direction:reverse}
.guard-ring:nth-child(3){width:300px;height:300px;border-color:rgba(124,58,237,.08);animation-duration:6s}
@keyframes ring{from{transform:rotate(0deg);opacity:.6}50%{opacity:.2;transform:rotate(180deg) scale(1.05)}to{transform:rotate(360deg);opacity:.6}}
.guard-text{font-family:'Bebas Neue',sans-serif;font-size:clamp(32px,8vw,64px);letter-spacing:6px;text-align:center;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:pulse 2s ease-in-out infinite;position:relative;z-index:1}
.guard-sub{margin-top:8px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:3px;color:var(--muted);text-transform:uppercase;position:relative;z-index:1}
@keyframes pulse{0%,100%{opacity:.8;transform:scale(1)}50%{opacity:1;transform:scale(1.02)}}

.api-section{background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:16px;overflow:hidden}
.api-head{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
.method{font-family:'Space Mono',monospace;font-size:10px;padding:2px 8px;border-radius:2px;font-weight:700;letter-spacing:1px}
.GET{background:rgba(34,197,94,.15);color:var(--ok)}.POST{background:rgba(124,58,237,.15);color:#a78bfa}.DELETE{background:rgba(239,68,68,.15);color:var(--danger)}
.endpoint{font-family:'Space Mono',monospace;font-size:11px}
.api-body{padding:14px 16px}
.api-desc{font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6}
.code-ex{background:var(--code);border:1px solid var(--border);border-radius:4px;padding:10px 12px;font-family:'Space Mono',monospace;font-size:10px;color:#a8b4d8;overflow-x:auto;white-space:pre;line-height:1.6}

.empty{text-align:center;padding:48px 20px;color:var(--muted);font-family:'Space Mono',monospace;font-size:11px;letter-spacing:1px}
.empty-icon{font-size:28px;margin-bottom:10px;opacity:.4}
.loading{opacity:.4;font-family:'Space Mono',monospace;font-size:11px;text-align:center;padding:40px;letter-spacing:2px}
.close-btn{background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:4px;transition:color .2s;flex-shrink:0}
.close-btn:hover{color:var(--text)}
.toast{position:fixed;bottom:24px;right:16px;background:var(--surface);border:1px solid var(--accent);border-radius:4px;padding:10px 16px;font-family:'Space Mono',monospace;font-size:10px;color:var(--accent2);letter-spacing:1px;z-index:9999;transform:translateY(80px);opacity:0;transition:all .3s cubic-bezier(.34,1.56,.64,1)}
.toast.show{transform:translateY(0);opacity:1}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
</style>
</head>
<body>

<header>
  <div class="logo">RAIN<span>X</span></div>
  <div class="key-wrap">
    <span class="badge">KEY</span>
    <input class="key-input" type="password" id="api-key-input" placeholder="your-api-key">
  </div>
  <span class="badge">RAW STORAGE</span>
</header>

<div class="container">
  <div class="tabs">
    <button class="tab active" onclick="switchTab('new')">+ NEW</button>
    <button class="tab" onclick="switchTab('list')">PASTES</button>
    <button class="tab" onclick="switchTab('api')">API</button>
  </div>

  <!-- NEW -->
  <div class="panel active" id="panel-new">
    <div class="row">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="paste-name" placeholder="script.lua">
      </div>
      <div class="form-group">
        <label>Language</label>
        <select id="paste-lang">
          <option value="plaintext">Plaintext</option>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="lua">Lua</option>
          <option value="bash">Bash</option>
          <option value="json">JSON</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="cpp">C++</option>
          <option value="php">PHP</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="form-group">
        <label>Expire</label>
        <select id="paste-expire">
          <option value="never">Never</option>
          <option value="1h">1 Hour</option>
          <option value="24h">24 Hours</option>
          <option value="7d">7 Days</option>
          <option value="30d">30 Days</option>
        </select>
      </div>
      <div class="form-group">
        <label>Visibility</label>
        <select id="paste-vis">
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Content</label>
      <textarea id="paste-code" placeholder="-- paste code here..."></textarea>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" id="create-btn" onclick="createPaste()">STORE</button>
      <button class="btn btn-ghost" onclick="clearForm()">CLEAR</button>
    </div>
    <div class="result-box" id="result-box">
      <div class="result-header">
        <span class="result-title">✓ STORED</span>
        <button class="btn btn-outline" onclick="copyUrl()" style="font-size:9px;padding:4px 12px">COPY URL</button>
      </div>
      <div class="result-url" id="result-url" onclick="copyUrl()"></div>
      <div class="result-sub" id="result-raw"></div>
    </div>
  </div>

  <!-- LIST -->
  <div class="panel" id="panel-list">
    <div class="stats-bar">
      <div class="stat"><span class="stat-val" id="s-total">—</span><span class="stat-label">TOTAL</span></div>
      <div class="stat"><span class="stat-val" id="s-pub">—</span><span class="stat-label">PUBLIC</span></div>
      <div class="stat"><span class="stat-val" id="s-prv">—</span><span class="stat-label">PRIVATE</span></div>
    </div>
    <div class="paste-list" id="paste-list"><div class="loading">LOADING...</div></div>
  </div>

  <!-- API -->
  <div class="panel" id="panel-api">
    <div class="api-section">
      <div class="api-head"><span class="method GET">GET</span><span class="endpoint">/api/raw/:id</span></div>
      <div class="api-body">
        <p class="api-desc">ดึง raw content — ใช้ใน loadstring() ได้เลย</p>
        <div class="code-ex">curl https://yourapp.up.railway.app/api/raw/abc12345

-- Lua:
loadstring(game:HttpGet(
  "https://yourapp.up.railway.app/api/raw/abc12345"
))()</div>
      </div>
    </div>
    <div class="api-section">
      <div class="api-head"><span class="method GET">GET</span><span class="endpoint">/api/paste/:id</span></div>
      <div class="api-body">
        <p class="api-desc">ดึง metadata (JSON)</p>
        <div class="code-ex">curl https://yourapp.up.railway.app/api/paste/abc12345</div>
      </div>
    </div>
    <div class="api-section">
      <div class="api-head"><span class="method POST">POST</span><span class="endpoint">/api/paste</span></div>
      <div class="api-body">
        <p class="api-desc">สร้าง paste ใหม่ (ต้องใช้ API Key)</p>
        <div class="code-ex">curl -X POST https://yourapp.up.railway.app/api/paste \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"x.lua","lang":"lua","content":"..."}'</div>
      </div>
    </div>
    <div class="api-section">
      <div class="api-head"><span class="method GET">GET</span><span class="endpoint">/api/list</span></div>
      <div class="api-body">
        <p class="api-desc">รายการทั้งหมด (ต้องใช้ API Key)</p>
        <div class="code-ex">curl https://yourapp.up.railway.app/api/list \\
  -H "Authorization: Bearer YOUR_KEY"</div>
      </div>
    </div>
    <div class="api-section">
      <div class="api-head"><span class="method DELETE">DELETE</span><span class="endpoint">/api/paste/:id</span></div>
      <div class="api-body">
        <p class="api-desc">ลบ paste</p>
        <div class="code-ex">curl -X DELETE https://yourapp.up.railway.app/api/paste/abc12345 \\
  -H "Authorization: Bearer YOUR_KEY"</div>
      </div>
    </div>
  </div>
</div>

<!-- MODAL -->
<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="modal-title">—</span>
      <div class="modal-actions">
        <button class="icon-btn" onclick="copyCode()">⎘</button>
        <button class="icon-btn" onclick="toggleGuard()" id="guard-btn">👁</button>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="guard-overlay active" id="guard-overlay" onclick="revealCode()">
        <div class="guard-ring"></div>
        <div class="guard-ring"></div>
        <div class="guard-ring"></div>
        <div class="guard-text">Rainx Guards</div>
        <div class="guard-sub">TAP TO REVEAL</div>
      </div>
      <pre class="code-block guarded" id="modal-code"></pre>
    </div>
    <div style="padding:8px 14px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center">
      <span class="badge" id="modal-lang">—</span>
      <span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted)" id="modal-meta">—</span>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let guardActive = true;

const $ = id => document.getElementById(id);
const key = () => $('api-key-input').value.trim();
const base = () => window.location.origin;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function switchTab(n) {
  document.querySelectorAll('.tab').forEach((t,i) =>
    t.classList.toggle('active', ['new','list','api'][i] === n));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('panel-' + n).classList.add('active');
  if (n === 'list') loadList();
}

async function createPaste() {
  if (!key()) { toast('⚠ กรอก API Key ก่อน'); return; }
  const content = $('paste-code').value;
  if (!content.trim()) { toast('⚠ กรอก content ก่อน'); return; }
  const btn = $('create-btn');
  btn.disabled = true; btn.textContent = 'STORING...';
  try {
    const r = await fetch('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key() },
      body: JSON.stringify({
        name: $('paste-name').value.trim() || 'untitled',
        lang: $('paste-lang').value,
        content,
        expire: $('paste-expire').value,
        visibility: $('paste-vis').value
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    $('result-box').classList.add('show');
    $('result-url').textContent = base() + d.url;
    $('result-raw').textContent = 'Raw: ' + base() + d.raw_url;
    toast('✓ STORED');
  } catch(e) { toast('✗ ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'STORE'; }
}

function clearForm() {
  $('paste-name').value = ''; $('paste-code').value = '';
  $('result-box').classList.remove('show');
}
function copyUrl() {
  navigator.clipboard.writeText($('result-url').textContent).then(() => toast('✓ COPIED'));
}

async function loadList() {
  if (!key()) {
    $('paste-list').innerHTML = '<div class="empty"><div class="empty-icon">🔑</div>กรอก API Key ก่อน</div>';
    return;
  }
  $('paste-list').innerHTML = '<div class="loading">LOADING...</div>';
  try {
    const r = await fetch('/api/list', { headers: { 'Authorization': 'Bearer ' + key() } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $('s-total').textContent = d.total;
    $('s-pub').textContent = d.pastes.filter(p => p.visibility==='public').length;
    $('s-prv').textContent = d.pastes.filter(p => p.visibility==='private').length;
    if (!d.pastes.length) {
      $('paste-list').innerHTML = '<div class="empty"><div class="empty-icon">📭</div>NO PASTES YET</div>';
      return;
    }
    $('paste-list').innerHTML = d.pastes.map(p => \`
      <div class="paste-item" onclick="openPaste('\${p.id}')">
        <div class="paste-info">
          <div class="paste-name">\${p.name}</div>
          <div class="paste-meta">
            <span>\${p.lang}</span>
            <span>👁 \${p.views}</span>
            <span>\${p.visibility==='private'?'🔒':'🌐'}</span>
            <span>\${p.id}</span>
          </div>
        </div>
        <div class="paste-actions" onclick="event.stopPropagation()">
          <button class="icon-btn" onclick="copyRaw('\${p.id}')">RAW</button>
          <button class="icon-btn del" onclick="delPaste('\${p.id}')">✕</button>
        </div>
      </div>
    \`).join('');
  } catch(e) {
    $('paste-list').innerHTML = \`<div class="empty"><div class="empty-icon">⚠</div>\${e.message}</div>\`;
  }
}

async function delPaste(id) {
  if (!confirm('ลบ paste นี้?')) return;
  await fetch('/api/paste/'+id, { method:'DELETE', headers:{'Authorization':'Bearer '+key()} });
  toast('✓ DELETED'); loadList();
}

function copyRaw(id) {
  navigator.clipboard.writeText(base()+'/api/raw/'+id).then(() => toast('✓ RAW COPIED'));
}

async function openPaste(id) {
  guardActive = true;
  $('guard-overlay').classList.add('active');
  $('modal-code').classList.add('guarded');
  $('guard-btn').textContent = '👁';
  $('modal-title').textContent = 'Loading...';
  $('modal-code').textContent = '';
  $('modal-overlay').classList.add('show');
  try {
    const h = key() ? {'Authorization':'Bearer '+key()} : {};
    const [mr, rr] = await Promise.all([
      fetch('/api/paste/'+id, {headers:h}),
      fetch('/api/raw/'+id, {headers:h})
    ]);
    const meta = await mr.json();
    const code = await rr.text();
    $('modal-title').textContent = meta.name || id;
    $('modal-code').textContent = code;
    $('modal-lang').textContent = meta.lang || '—';
    $('modal-meta').textContent = \`\${id} · 👁 \${meta.views} · \${meta.visibility}\`;
  } catch(e) { $('modal-code').textContent = 'Error: '+e.message; }
}

function revealCode() {
  guardActive = false;
  $('guard-overlay').classList.remove('active');
  $('modal-code').classList.remove('guarded');
  $('guard-btn').textContent = '🛡';
}
function toggleGuard() {
  if (guardActive) revealCode();
  else {
    guardActive = true;
    $('guard-overlay').classList.add('active');
    $('modal-code').classList.add('guarded');
    $('guard-btn').textContent = '👁';
  }
}
function closeModal() { $('modal-overlay').classList.remove('show'); }
function copyCode() {
  navigator.clipboard.writeText($('modal-code').textContent).then(() => toast('✓ COPIED'));
}
$('modal-overlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeModal(); });
</script>
</body>
</html>`;

app.get('*', (req, res) => res.send(HTML));

app.listen(PORT, () => {
  console.log(`🟣 Rainx on http://localhost:${PORT}`);
  console.log(`🔑 API_KEY = ${API_KEY}`);
});
