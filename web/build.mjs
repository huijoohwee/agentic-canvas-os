// Offline, zero-dependency static build for the agentic-canvas-os Cloudflare
// frontend. Assembles `web/dist` from Node built-ins only — nothing to
// transpile or bundle, so `npm install` and `npm run web:build` both work
// OFFLINE with zero network or Cloudflare calls.
//
// It (1) copies the knowgrph static canvas shell, and (2) injects the MCP
// command grammar overlay UI at the bottom of index.html.
// The UI now queries the agentic-canvas-os worker (`/api/invoke`) instead
// of statically compiling the dictionary.
//
// SECRET SAFETY: never a model key or auth signing secret.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const WEB = path.join(REPO, "web");
const DIST = path.join(WEB, "dist");

function buildGrammarOverlay() {
  const css = `
/* MCP Command Grammar Overlay Styles (Knowgrph-Themed) */
.kg-cmd-overlay {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 10000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 32px;
}
.kg-cmd-dialog {
  width: 100%;
  max-width: 640px;
  background: rgba(17, 24, 39, 0.98);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--kg-border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column-reverse;
}
.kg-cmd-input {
  width: 100%;
  padding: 16px 20px;
  font-size: 16px;
  background: transparent;
  border: 0;
  border-top: 1px solid var(--kg-border);
  color: var(--kg-text-primary);
  outline: none;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
}
.kg-cmd-input::placeholder {
  color: var(--kg-text-tertiary);
}
.kg-cmd-results {
  max-height: 320px;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column-reverse;
  gap: 4px;
}
.kg-cmd-item {
  padding: 14px 16px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 120ms ease;
}
.kg-cmd-item:hover,
.kg-cmd-item[aria-selected="true"] {
  background: var(--kg-panel-action-bg-hover);
}
.kg-cmd-item-title {
  font-weight: 700;
  color: var(--kg-canvas-accent);
  font-size: 15px;
}
.kg-cmd-item-desc {
  font-size: 12px;
  color: var(--kg-text-secondary);
}
.kg-hud-chip {
  border: 1px solid var(--kg-border);
  background: var(--kg-panel-bg);
  color: var(--kg-text);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: default;
  min-width: 32px;
  min-height: 32px;
  line-height: 1.2;
  display: flex;
  align-items: center;
}
.kg-hud-chip strong {
  font-weight: 700;
  color: var(--kg-canvas-accent);
}
`;

  const js = `
// MCP Command Grammar Integration (Knowgrph Canvas)
let debounceTimer = null;
let sessionToken = null;
let abortController = null;

function buildOverlayHtml() {
  return \`
    <div class="kg-cmd-overlay" id="kgCmdOverlay" hidden>
      <div class="kg-cmd-dialog">
        <input type="text" id="kgCmdInput" class="kg-cmd-input" placeholder="Type /, @, or # to invoke MCP commands..." autocomplete="off" spellcheck="false" />
        <div id="kgCmdResults" class="kg-cmd-results"></div>
      </div>
    </div>
  \`;
}

async function getSessionToken() {
  if (sessionToken) return sessionToken;
  try {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "canvas-guest" })
    });
    if (res.ok) {
      const data = await res.json();
      sessionToken = data.token;
      return sessionToken;
    }
  } catch (e) {
    console.error("Failed to fetch session token", e);
  }
  return null;
}

async function fetchResults(query) {
  const q = (query || "").trim();
  if (!q || (!q.startsWith("/") && !q.startsWith("@") && !q.startsWith("#"))) {
    return null;
  }
  
  const token = await getSessionToken();
  if (!token) return { error: "Failed to authenticate session" };

  if (abortController) abortController.abort();
  abortController = new AbortController();

  try {
    const res = await fetch("/api/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + token
      },
      body: JSON.stringify({ query: q }),
      signal: abortController.signal
    });
    
    if (!res.ok) {
      return { error: "API error: " + res.status };
    }
    
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') return { aborted: true };
    return { error: e.message };
  }
}

function showOverlay() {
  const overlay = document.getElementById("kgCmdOverlay");
  const input = document.getElementById("kgCmdInput");
  if (!overlay || !input) return;
  overlay.hidden = false;
  input.value = "";
  input.focus();
  renderEmpty();
  
  // Pre-warm the session token
  getSessionToken();
}

function hideOverlay() {
  const overlay = document.getElementById("kgCmdOverlay");
  const input = document.getElementById("kgCmdInput");
  if (!overlay || !input) return;
  overlay.hidden = true;
  input.blur();
}

function renderEmpty() {
  const container = document.getElementById("kgCmdResults");
  if (!container) return;
  container.innerHTML = '<div class="kg-cmd-item-desc" style="padding:14px;color:var(--kg-text-tertiary);">Type /, @, or # to search MCP command grammar...</div>';
}

function renderLoading() {
  const container = document.getElementById("kgCmdResults");
  if (!container) return;
  container.innerHTML = '<div class="kg-cmd-item-desc" style="padding:14px;color:var(--kg-text-tertiary);">Searching MCP...</div>';
}

function renderError(msg) {
  const container = document.getElementById("kgCmdResults");
  if (!container) return;
  container.innerHTML = \`<div class="kg-cmd-item-desc" style="padding:14px;color:var(--kg-text-secondary);"><span style="color:#ff4444">Error:</span> \${msg}</div>\`;
}

function renderResults(data) {
  const container = document.getElementById("kgCmdResults");
  if (!container) return;
  
  if (data && data.aborted) return;
  if (data && data.error) {
    renderError(data.error);
    return;
  }
  
  const items = (data && data.catalog) || [];
  if (!items.length) {
    renderError("No matches found.");
    return;
  }
  
  container.innerHTML = items.map(item => \`
    <div class="kg-cmd-item">
      <div class="kg-cmd-item-title">\${item.token}</div>
      <div class="kg-cmd-item-desc">\${item.summary || item.intent || ""}</div>
    </div>
  \`).join("");
}

function initGrammar() {
  // Inject overlay
  const overlayDiv = document.createElement('div');
  overlayDiv.innerHTML = buildOverlayHtml();
  document.body.appendChild(overlayDiv.firstElementChild);

  // Add HUD hint to knowgrph's existing HUD
  const hud = document.getElementById('kg-hud');
  if (hud) {
    const chip = document.createElement('div');
    chip.className = 'kg-hud-chip';
    chip.innerHTML = '<strong>Cmd+K</strong> or type /@#';
    hud.insertBefore(chip, hud.firstChild);
  }

  // Event listeners
  const overlay = document.getElementById('kgCmdOverlay');
  const input = document.getElementById('kgCmdInput');
  if (overlay) {
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) hideOverlay();
    });
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideOverlay();
        e.stopPropagation();
      }
    });
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q || (!q.startsWith("/") && !q.startsWith("@") && !q.startsWith("#"))) {
        renderEmpty();
        return;
      }
      renderLoading();
      debounceTimer = setTimeout(async () => {
        const data = await fetchResults(q);
        renderResults(data);
      }, 250);
    });
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (document.getElementById('kgCmdOverlay')?.hidden) {
        showOverlay();
      } else {
        hideOverlay();
      }
      return;
    }
    // Auto-open when typing /, @, # (and not in any input already)
    if ((e.key === '/' || e.key === '@' || e.key === '#')) {
      const active = document.activeElement;
      const isTyping = active && (
        active.tagName === 'INPUT' || 
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable
      );
      if (!isTyping) {
        showOverlay();
        if (input) {
          input.value = e.key;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        e.preventDefault();
      }
    }
  });
}

// Initialize after knowgrph's canvas loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGrammar);
} else {
  initGrammar();
}
`;
  return { css, js };
}

function main() {
  // 1. Clean dist and copy index.html
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 2. Load knowgrph index.html
  const originalHtml = fs.readFileSync(path.join(WEB, "index.html"), "utf8");

  // 3. Compile grammar overlay
  const { css, js } = buildGrammarOverlay();

  // 4. Inject into index.html
  const injectedHtml = originalHtml.replace(
    "</head>",
    `<style>${css}</style></head>`
  ).replace(
    "</body>",
    `<script>${js}</script></body>`
  );

  fs.writeFileSync(path.join(DIST, "index.html"), injectedHtml, "utf8");

  process.stdout.write(
    `agentic-canvas-os web build → ${path.relative(REPO, DIST)}\n` +
      `  Knowgrph canvas + MCP command grammar overlay ready!\n` +
      `  Artifacts: index.html (standalone canvas + remote grammar resolution)\n`,
  );
}

main();
