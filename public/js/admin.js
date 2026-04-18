import { api } from './api.js';

const state = {
  adminTab: 'users',
  users: [],
  tracks: [],
  battles: [],
  news: [],
  me: null,
  loading: false,
  pending: false
};

const elements = {
  app: document.getElementById('admin-app'),
  userInfo: document.getElementById('admin-user-info')
};

// --- HELPERS ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU');
}

function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'is-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- DATA LOADING ---
async function loadBootstrap() {
  state.loading = true;
  render();
  try {
    const data = await api('/api/bootstrap');
    state.me = data.me;
    state.news = data.news || [];
    if (!state.me.isAdmin) {
      window.location.href = '/';
      return;
    }
    await loadTabContent();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function loadTabContent() {
  try {
    if (state.adminTab === 'users') {
      const data = await api('/api/admin/users');
      state.users = data.users;
    } else if (state.adminTab === 'tracks') {
      const data = await api('/api/admin/tracks');
      state.tracks = data.tracks;
    }
    // Battles and news are partially in bootstrap or need separate calls
  } catch (err) {
    showToast(err.message, true);
  }
}

// --- ACTIONS ---
async function toggleBan(userId, currentlyBanned) {
  try {
    state.pending = true; render();
    await api(`/api/admin/users/${userId}/ban`, {
      method: 'POST',
      body: { isBanned: !currentlyBanned }
    });
    showToast(currentlyBanned ? 'Разбанен' : 'Забанен');
    await loadTabContent();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

async function deleteTrack(trackId) {
  if (!confirm('Удалить трек навсегда?')) return;
  try {
    state.pending = true; render();
    await api(`/api/admin/tracks/${trackId}`, { method: 'DELETE' });
    showToast('Удалено');
    await loadTabContent();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

async function addNews(title, body) {
  try {
    state.pending = true; render();
    await api('/api/admin/news', { method: 'POST', body: { title, body } });
    showToast('Добавлено');
    await loadBootstrap();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

async function deleteNews(id) {
  if (!confirm('Удалить новость?')) return;
  try {
    state.pending = true; render();
    await api(`/api/admin/news/${id}`, { method: 'DELETE' });
    showToast('Удалено');
    await loadBootstrap();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

async function triggerBattles() {
  try {
    state.pending = true; render();
    const res = await api('/api/admin/battles/trigger', { method: 'POST' });
    showToast(`Готово. Создано: ${res.createdCount}`);
    await loadBootstrap();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

// --- RENDERING ---
function render() {
  if (state.loading) {
    elements.app.innerHTML = '<div class="loading">Загрузка...</div>';
    return;
  }

  elements.userInfo.innerHTML = `
    <span>${state.me ? escapeHtml(state.me.displayName) : ''}</span>
    <button class="btn-ghost" onclick="window.location.href='/'">На сайт</button>
  `;

  elements.app.innerHTML = `
    <div class="admin-container">
      <nav class="admin-nav">
        <button class="nav-item ${state.adminTab === 'users' ? 'is-active' : ''}" data-tab="users">Пользователи</button>
        <button class="nav-item ${state.adminTab === 'tracks' ? 'is-active' : ''}" data-tab="tracks">Треки</button>
        <button class="nav-item ${state.adminTab === 'battles' ? 'is-active' : ''}" data-tab="battles">Баттлы</button>
        <button class="nav-item ${state.adminTab === 'news' ? 'is-active' : ''}" data-tab="news">Новости</button>
      </nav>

      <div class="admin-content">
        ${renderTabContent()}
      </div>
    </div>
  `;
}

function renderTabContent() {
  switch (state.adminTab) {
    case 'users':
      return `
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Ник</th>
              <th>Роль</th>
              <th>Бан</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            ${state.users.map(u => `
              <tr>
                <td>${u.id}</td>
                <td>${escapeHtml(u.nickname)}</td>
                <td>${u.role}</td>
                <td>${u.isBanned ? '🔴' : '🟢'}</td>
                <td>
                  <button class="btn-sm" data-action="toggle-ban" data-id="${u.id}" data-banned="${u.isBanned}">
                    ${u.isBanned ? 'Разбанить' : 'Забанить'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    case 'tracks':
      return `
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Автор</th>
              <th>ELO</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            ${state.tracks.map(t => `
              <tr>
                <td>${t.id}</td>
                <td>${escapeHtml(t.title)}</td>
                <td>${escapeHtml(t.artist.nickname)}</td>
                <td>${t.elo}</td>
                <td>
                  <button class="btn-sm btn-danger" data-action="delete-track" data-id="${t.id}">Удалить</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    case 'battles':
      return `
        <div class="admin-actions-row">
          <button class="btn" data-action="trigger-battles">Обновить баттлы (авто)</button>
        </div>
        <h3>Создать баттл вручную</h3>
        <form id="create-battle-form" class="admin-form">
          <input name="genre" placeholder="Жанр" required />
          <input name="trackAId" placeholder="ID трека A" required />
          <input name="trackBId" placeholder="ID трека B" required />
          <input name="hours" type="number" value="24" required />
          <button type="submit" class="btn">Создать</button>
        </form>
      `;
    case 'news':
      return `
        <h3>Добавить новость</h3>
        <form id="add-news-form" class="admin-form">
          <input name="title" placeholder="Заголовок" required />
          <textarea name="body" placeholder="Текст новости" required></textarea>
          <button type="submit" class="btn">Опубликовать</button>
        </form>
        <hr/>
        <div class="admin-news-list">
          ${state.news.map(n => `
            <div class="admin-news-item">
              <strong>${escapeHtml(n.title)}</strong>
              <p>${escapeHtml(n.body)}</p>
              <button class="btn-sm btn-danger" data-action="delete-news" data-id="${n.id}">Удалить</button>
            </div>
          `).join('')}
        </div>
      `;
    default: return '';
  }
}

// --- EVENTS ---
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    state.adminTab = tabBtn.dataset.tab;
    loadTabContent().then(render);
    return;
  }

  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn) return;

  const action = actionBtn.dataset.action;
  const id = actionBtn.dataset.id;

  if (action === 'toggle-ban') toggleBan(id, actionBtn.dataset.banned === 'true');
  if (action === 'delete-track') deleteTrack(id);
  if (action === 'delete-news') deleteNews(id);
  if (action === 'trigger-battles') triggerBattles();
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  if (form.id === 'add-news-form') {
    await addNews(formData.get('title'), formData.get('body'));
    form.reset();
  }

  if (form.id === 'create-battle-form') {
    try {
      await api('/api/admin/battles/create', {
        method: 'POST',
        body: {
          genre: formData.get('genre'),
          trackAId: formData.get('trackAId'),
          trackBId: formData.get('trackBId'),
          hours: formData.get('hours')
        }
      });
      showToast('Баттл создан');
      form.reset();
    } catch (err) {
      showToast(err.message, true);
    }
  }
});

// INIT
loadBootstrap();
