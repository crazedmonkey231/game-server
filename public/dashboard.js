/* global dashboard script */
const BASE = window.location.origin;

// ── Auth state ────────────────────────────────────────────────────────────────

let currentProfile = null;

function loadAuthState() {
  try {
    const saved = localStorage.getItem('dashboard_profile');
    if (saved) currentProfile = JSON.parse(saved);
  } catch (e) {
    currentProfile = null;
  }
}

function saveAuthState() {
  if (currentProfile) {
    localStorage.setItem('dashboard_profile', JSON.stringify(currentProfile));
  } else {
    localStorage.removeItem('dashboard_profile');
  }
}

function updateAuthUI() {
  const loggedIn = currentProfile !== null;
  document.body.classList.toggle('logged-in', loggedIn);

  const authStatus = document.getElementById('auth-status');
  if (authStatus) {
    authStatus.textContent = loggedIn ? `Logged in as ${currentProfile.name}` : 'Not logged in';
    authStatus.className = loggedIn ? 'auth-status auth-status-on' : 'auth-status auth-status-off';
  }

  const loginStatus = document.getElementById('login-status');
  if (loginStatus) {
    if (loggedIn) {
      loginStatus.textContent = `✔ Logged in as ${currentProfile.name}`;
      loginStatus.style.display = 'block';
    } else {
      loginStatus.style.display = 'none';
    }
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.style.display = loggedIn ? 'none' : 'flex';

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.style.display = loggedIn ? 'block' : 'none';

  // Re-render dynamic tables so button states reflect current auth
  fetchActiveEvents();
  fetchGames();
}

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

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(`tab-${btn.dataset.tab}`);
      if (target) target.classList.add('active');
      if (btn.dataset.tab === 'leaderboard') fetchLeaderboard();
      if (btn.dataset.tab === 'games') fetchGames();
    });
  });
}

// ── Server Statistics ─────────────────────────────────────────────────────────

async function fetchStats() {
  try {
    const [stats, summary] = await Promise.all([
      apiFetch('/api/globalStats'),
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

async function fetchActiveEvents() {
  try {
    const tbody = document.getElementById('active-events-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const data = await apiFetch('/api/gameManager/games');
    const select = document.getElementById('event-game-id');
    if (select) {
      const current = select.value;
      select.innerHTML = '';
      data.games.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g.gameId;
        opt.textContent = g.gameId;
        select.appendChild(opt);
      });
      if (current) select.value = current;
    }
    const results = await Promise.all(
      data.games.map((game) =>
        apiFetch(`/api/eventManager/getEvents/${game.gameId}`).then((d) => ({ gameId: game.gameId, events: d.events || [] }))
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
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.game = gameId;
        removeBtn.dataset.type = ev.type;
        removeBtn.disabled = !currentProfile;
        if (!currentProfile) removeBtn.title = 'Login required';
        const tdGame = document.createElement('td');
        tdGame.textContent = gameId;
        const tdType = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'badge badge-info';
        badge.textContent = ev.type;
        tdType.appendChild(badge);
        const tdExpiry = document.createElement('td');
        tdExpiry.textContent = expiresIn;
        const tdAction = document.createElement('td');
        tdAction.appendChild(removeBtn);
        tr.appendChild(tdGame);
        tr.appendChild(tdType);
        tr.appendChild(tdExpiry);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
      }
    }
    if (!hasAny) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No active events</td></tr>';
    }

    // Attach remove handlers
    tbody.querySelectorAll('.btn-remove').forEach((btn) => {
      btn.addEventListener('click', () => removeEvent(btn.dataset.game, btn.dataset.type));
    });
  } catch (e) {
    console.error('Failed to fetch active events', e);
  }
}

async function removeEvent(gameId, type) {
  try {
    await apiFetch(`/api/eventManager/removeEvent/${encodeURIComponent(gameId)}/${encodeURIComponent(type)}`, {
      method: 'DELETE',
    });
    fetchActiveEvents();
    showBanner(`Removed event "${type}" from ${gameId}.`, 'success');
  } catch (err) {
    showBanner(`Failed to remove event: ${err.message}`, 'error');
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

// ── Leaderboard ───────────────────────────────────────────────────────────────

async function fetchLeaderboard() {
  const select = document.getElementById('lb-game-id');
  const tbody = document.getElementById('leaderboard-body');
  if (!select || !tbody) return;
  tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/gameManager/games');
    const gameId = select.value || (data.games[0] && data.games[0].gameId);
    if (!gameId) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No games available</td></tr>';
      return;
    }
    data.games.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.gameId;
      opt.textContent = g.gameId;
      if (!select.querySelector(`option[value="${g.gameId}"]`)) {
        select.appendChild(opt);
      }
    });
    const entries = await apiFetch(`/api/leaderboard/${encodeURIComponent(gameId)}`);
    tbody.innerHTML = '';
    if (!Array.isArray(entries) || entries.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No entries yet.</td></tr>';
      return;
    }
    entries.forEach((entry, i) => {
      const rank = i + 1;
      const rankClass = rank <= 3 ? ` rank-${rank}` : '';
      const date = new Date(entry.timestamp).toLocaleDateString();
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="rank-cell${rankClass}">${rank}</td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${entry.score.toLocaleString()}</td>
        <td>${date}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Failed to load leaderboard.</td></tr>';
    console.error('Failed to fetch leaderboard', e);
  }
}

// ── Games ─────────────────────────────────────────────────────────────────────

async function fetchGames() {
  try {
    const data = await apiFetch('/api/gameManager/games');
    const tbody = document.getElementById('games-list-body');
    const typeSelect = document.getElementById('new-game-type');

    if (typeSelect) {
      const currentType = typeSelect.value;
      typeSelect.innerHTML = '';
      (data.availableTypes || []).forEach((type) => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        typeSelect.appendChild(opt);
      });
      if (currentType) typeSelect.value = currentType;
    }

    if (!tbody) return;
    tbody.innerHTML = '';
    const gameList = data.games || [];
    if (gameList.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No games registered</td></tr>';
      return;
    }
    for (const game of gameList) {
      const tr = document.createElement('tr');

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.dataset.gameId = game.gameId;
      if (!currentProfile) {
        removeBtn.disabled = true;
        removeBtn.title = 'Login required';
      } else if (game.playerCount > 0) {
        removeBtn.disabled = true;
        removeBtn.title = 'Cannot remove: players are active';
      }

      const roomsBtn = document.createElement('button');
      roomsBtn.className = 'btn-rooms';
      roomsBtn.textContent = 'Rooms';
      roomsBtn.dataset.gameId = game.gameId;

      const tdId = document.createElement('td');
      tdId.textContent = game.gameId;
      const tdType = document.createElement('td');
      tdType.textContent = game.gameType;
      const tdName = document.createElement('td');
      tdName.textContent = game.name;
      const tdCount = document.createElement('td');
      tdCount.textContent = game.playerCount;
      const tdPlayTime = document.createElement('td');
      tdPlayTime.textContent = formatPlaytime(game.playTime);
      const tdRooms = document.createElement('td');
      tdRooms.appendChild(roomsBtn);
      const tdAction = document.createElement('td');
      tdAction.appendChild(removeBtn);

      tr.appendChild(tdId);
      tr.appendChild(tdType);
      tr.appendChild(tdName);
      tr.appendChild(tdCount);
      tr.appendChild(tdPlayTime);
      tr.appendChild(tdRooms);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.btn-remove').forEach((btn) => {
      btn.addEventListener('click', () => removeGame(btn.dataset.gameId));
    });

    tbody.querySelectorAll('.btn-rooms').forEach((btn) => {
      btn.addEventListener('click', () => fetchGameRooms(btn.dataset.gameId));
    });
  } catch (e) {
    console.error('Failed to fetch games', e);
  }
}

async function removeGame(gameId) {
  try {
    await apiFetch(`/api/gameManager/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
    const card = document.getElementById('game-rooms-card');
    if (card && card.dataset.gameId === gameId) card.style.display = 'none';
    fetchGames();
    showBanner(`Game "${gameId}" removed.`, 'success');
  } catch (err) {
    showBanner(`Failed to remove game: ${err.message}`, 'error');
  }
}

async function addGame(e) {
  e.preventDefault();
  const gameId = document.getElementById('new-game-id').value.trim();
  const gameType = document.getElementById('new-game-type').value;
  if (!gameId || !gameType) {
    showBanner('Game ID and Game Type are required.', 'error');
    return;
  }
  try {
    await apiFetch('/api/gameManager/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, gameType }),
    });
    document.getElementById('add-game-form').reset();
    fetchGames();
    showBanner(`Game "${gameId}" registered.`, 'success');
  } catch (err) {
    showBanner(`Failed to add game: ${err.message}`, 'error');
  }
}

// ── Game Rooms drill-down ──────────────────────────────────────────────────────

async function fetchGameRooms(gameId) {
  const card = document.getElementById('game-rooms-card');
  const title = document.getElementById('game-rooms-title');
  const body = document.getElementById('game-rooms-body');
  if (!card || !body) return;

  card.style.display = 'block';
  card.dataset.gameId = gameId;
  if (title) title.textContent = `Rooms — ${escapeHtml(gameId)}`;
  body.innerHTML = '<p class="rooms-loading">Loading rooms…</p>';

  // Scroll the card into view
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const data = await apiFetch(`/api/gameManager/${encodeURIComponent(gameId)}/rooms`);
    renderGameRooms(body, data.rooms || []);
  } catch (e) {
    body.innerHTML = '<p class="rooms-error">Failed to load rooms.</p>';
    console.error('Failed to fetch game rooms', e);
  }
}

function renderGameRooms(container, rooms) {
  if (rooms.length === 0) {
    container.innerHTML = '<p class="rooms-empty">No rooms found for this game.</p>';
    return;
  }

  container.innerHTML = '';
  for (const room of rooms) {
    const section = document.createElement('div');
    section.className = 'room-section';

    // Room header
    const header = document.createElement('div');
    header.className = 'room-header';
    header.innerHTML = `
      <span class="room-id">${escapeHtml(room.roomId)}</span>
      ${room.started ? '<span class="badge badge-success">Started</span>' : '<span class="badge badge-muted">Lobby</span>'}
      ${room.paused ? '<span class="badge badge-warning">Paused</span>' : ''}
      <span class="room-meta">${room.playerCount} player${room.playerCount !== 1 ? 's' : ''} · ${room.thingCount} thing${room.thingCount !== 1 ? 's' : ''}</span>
    `;
    section.appendChild(header);

    // Players table
    const playersWrap = document.createElement('div');
    playersWrap.className = 'room-sub-section';
    const playersLabel = document.createElement('div');
    playersLabel.className = 'room-sub-label';
    playersLabel.textContent = 'Players';
    playersWrap.appendChild(playersLabel);

    if (room.players.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rooms-empty';
      empty.textContent = 'No players in this room.';
      playersWrap.appendChild(empty);
    } else {
      const tbl = document.createElement('table');
      tbl.innerHTML = `
        <thead><tr><th>ID</th><th>Name</th><th>Score</th><th>Health</th><th>Type</th></tr></thead>
      `;
      const tbody = document.createElement('tbody');
      for (const p of room.players) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="id-cell">${escapeHtml(p.id)}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.score}</td>
          <td>${p.health}</td>
          <td>${p.isAi ? '<span class="badge badge-muted">AI</span>' : '<span class="badge badge-info">Human</span>'}</td>
        `;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      playersWrap.appendChild(tbl);
    }
    section.appendChild(playersWrap);

    // Things table
    const thingsWrap = document.createElement('div');
    thingsWrap.className = 'room-sub-section';
    const thingsLabel = document.createElement('div');
    thingsLabel.className = 'room-sub-label';
    thingsLabel.textContent = 'Things';
    thingsWrap.appendChild(thingsLabel);

    if (room.things.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rooms-empty';
      empty.textContent = 'No things in this room.';
      thingsWrap.appendChild(empty);
    } else {
      const tbl = document.createElement('table');
      tbl.innerHTML = `
        <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Health</th></tr></thead>
      `;
      const tbody = document.createElement('tbody');
      for (const t of room.things) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="id-cell">${escapeHtml(t.id)}</td>
          <td>${escapeHtml(t.name)}</td>
          <td>${escapeHtml(t.type)}</td>
          <td>${t.health !== undefined ? t.health : '—'}</td>
        `;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      thingsWrap.appendChild(tbl);
    }
    section.appendChild(thingsWrap);

    container.appendChild(section);
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
      currentProfile = data.profile;
      saveAuthState();
      updateAuthUI();
      showBanner('Login successful!', 'success');
      document.getElementById('login-form').reset();
    } else {
      showBanner(`Login failed: ${data.message}`, 'error');
    }
  } catch (err) {
    showBanner(`Login error: ${err.message}`, 'error');
  }
}

function logout() {
  currentProfile = null;
  saveAuthState();
  updateAuthUI();
  showBanner('Logged out.', 'success');
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
  // Refresh leaderboard only when its tab is visible
  const lbPanel = document.getElementById('tab-leaderboard');
  if (lbPanel && lbPanel.classList.contains('active')) fetchLeaderboard();
  // Refresh rooms drill-down if currently visible
  const roomsCard = document.getElementById('game-rooms-card');
  if (roomsCard && roomsCard.style.display !== 'none' && roomsCard.dataset.gameId) {
    fetchGameRooms(roomsCard.dataset.gameId);
  }
  const el = document.getElementById('refresh-status');
  if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

document.addEventListener('DOMContentLoaded', () => {
  loadAuthState();
  initTabs();
  updateAuthUI();
  refreshAll();
  setInterval(refreshAll, 5000);

  const triggerForm = document.getElementById('trigger-event-form');
  if (triggerForm) triggerForm.addEventListener('submit', triggerEvent);

  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', login);

  const addGameForm = document.getElementById('add-game-form');
  if (addGameForm) addGameForm.addEventListener('submit', addGame);

  const lbSelect = document.getElementById('lb-game-id');
  if (lbSelect) lbSelect.addEventListener('change', fetchLeaderboard);

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  const closeRoomsBtn = document.getElementById('close-rooms-btn');
  if (closeRoomsBtn) {
    closeRoomsBtn.addEventListener('click', () => {
      const card = document.getElementById('game-rooms-card');
      if (card) {
        card.style.display = 'none';
        delete card.dataset.gameId;
      }
    });
  }
});

