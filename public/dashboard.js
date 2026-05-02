/* global dashboard script */
const BASE = window.location.origin;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatPlaytime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Server Statistics ─────────────────────────────────────────────────────────

async function fetchStats() {
  try {
    const [stats, summary] = await Promise.all([
      apiFetch('/api/profile/globalStats'),
      apiFetch('/api/gameManager/summary'),
    ]);
    setEl('stat-players', summary.totalPlayers);
    setEl('stat-active-games', summary.activeGames);
    setEl('stat-global-gold', stats.globalCredits);
    setEl('stat-global-playtime', formatPlaytime(stats.globalPlayTime));
  } catch (e) {
    console.error('Failed to fetch server stats', e);
  }
}

// ── Per-game Player Counts ────────────────────────────────────────────────────

async function fetchPlayerCounts() {
  try {
    const data = await apiFetch('/api/gameManager/playersInPerGames');
    const tbody = document.getElementById('player-counts-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const entries = Object.entries(data.playerCounts || {});
    if (entries.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="2">No games loaded</td></tr>';
      return;
    }
    for (const [gameId, count] of entries) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(gameId)}</td><td>${count}</td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error('Failed to fetch player counts', e);
  }
}

// ── Active Events ─────────────────────────────────────────────────────────────

const EVENT_GAME_IDS = ['default-game', 'creation-game'];

async function fetchActiveEvents() {
  try {
    const tbody = document.getElementById('active-events-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const results = await Promise.all(
      EVENT_GAME_IDS.map((id) =>
        apiFetch(`/api/eventManager/getEvents/${id}`).then((d) => ({ gameId: id, events: d.events || [] }))
      )
    );

    let hasAny = false;
    for (const { gameId, events } of results) {
      for (const ev of events) {
        hasAny = true;
        const expiresIn =
          ev.length > 0
            ? formatPlaytime(Math.max(0, Math.floor((ev.length - (Date.now() - ev.timestamp)) / 1000)))
            : 'Permanent';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(gameId)}</td>
          <td><span class="badge badge-info">${escapeHtml(ev.type)}</span></td>
          <td>${expiresIn}</td>`;
        tbody.appendChild(tr);
      }
    }
    if (!hasAny) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No active events</td></tr>';
    }
  } catch (e) {
    console.error('Failed to fetch active events', e);
  }
}

// ── Trigger Event Form ────────────────────────────────────────────────────────

async function triggerEvent(e) {
  e.preventDefault();
  const gameId = document.getElementById('event-game-id').value.trim();
  const type = document.getElementById('event-type').value.trim();
  const lengthHours = parseFloat(document.getElementById('event-length').value) || 0;
  const dataRaw = document.getElementById('event-data').value.trim();

  if (!gameId || !type) {
    alert('Game ID and Event Type are required.');
    return;
  }

  let data = {};
  if (dataRaw) {
    try {
      data = JSON.parse(dataRaw);
    } catch {
      alert('Event Data must be valid JSON or left empty.');
      return;
    }
  }

  try {
    await apiFetch('/api/eventManager/triggerEvent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, type, length: lengthHours * 3600 * 1000, data }),
    });
    document.getElementById('trigger-event-form').reset();
    fetchActiveEvents();
    showBanner('Event triggered!', 'success');
  } catch (err) {
    showBanner(`Failed to trigger event: ${err.message}`, 'error');
  }
}

// ── Admin Login ───────────────────────────────────────────────────────────────

async function login(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const socketId = document.getElementById('socketId').value.trim();
  if (!username || !socketId) return;
  try {
    const data = await apiFetch('/api/profile/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socketId, username }),
    });
    if (data.success) {
      showBanner('Login successful!', 'success');
      document.getElementById('login-form').reset();
    } else {
      showBanner(`Login failed: ${data.message}`, 'error');
    }
  } catch (err) {
    showBanner(`Login error: ${err.message}`, 'error');
  }
}

// ── Banner notification ───────────────────────────────────────────────────────

function showBanner(message, type) {
  const el = document.getElementById('banner');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.style.backgroundColor = type === 'success' ? '#d4edda' : '#f8d7da';
  el.style.color = type === 'success' ? '#155724' : '#721c24';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => {
    el.style.display = 'none';
  }, 4000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

function refreshAll() {
  fetchStats();
  fetchPlayerCounts();
  fetchActiveEvents();
  const el = document.getElementById('refresh-status');
  if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

document.addEventListener('DOMContentLoaded', () => {
  refreshAll();
  setInterval(refreshAll, 5000);

  const triggerForm = document.getElementById('trigger-event-form');
  if (triggerForm) triggerForm.addEventListener('submit', triggerEvent);

  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', login);
});
