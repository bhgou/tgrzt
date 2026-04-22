import { adminApi as api } from './api-admin.js';

const ADMIN_TOKEN_KEY = 'adminToken';

const state = {
  adminTab: 'users',
  users: [],
  tracks: [],
  battles: [],
  news: [],
  banners: [],
  me: null,
  loading: false,
  pending: false,
  isLoggedIn: Boolean(localStorage.getItem(ADMIN_TOKEN_KEY))
};

const elements = {
  app: document.getElementById('admin-app'),
  userInfo: document.getElementById('admin-user-info'),
  loginScreen: document.getElementById('login-screen'),
  adminHeader: document.getElementById('admin-header'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  tokenInput: document.getElementById('token-input'),
  toastContainer: document.getElementById('toast-container')
};

function showLogin() {
  elements.loginScreen.style.display = 'flex';
  elements.adminHeader.style.display = 'none';
}

function showApp() {
  elements.loginScreen.style.display = 'none';
  elements.adminHeader.style.display = 'block';
}

function handleLogout() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  state.isLoggedIn = false;
  state.me = null;
  showLogin();
}

elements.loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = elements.tokenInput.value.trim();
  if (!token) return;

  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  elements.loginError.textContent = '';

  try {
    await loadBootstrap();
    showApp();
  } catch (err) {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    elements.loginError.textContent = err.message || 'Ошибка входа';
  }
});

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

async function loadBootstrap() {
  state.loading = true;
  render();
  try {
    const data = await api('/api/admin/bootstrap?v=' + Date.now());
    state.me = data.me;
    state.news = data.news || [];
    if (!state.me?.isAdmin) {
      throw new Error('У вас нет прав администратора');
    }
    await loadTabContent();
  } catch (err) {
    showToast(err.message, true);
    if (err.message.includes('нет прав') || err.message.includes('401') || err.message.includes('403')) {
      handleLogout();
    }
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
    } else if (state.adminTab === 'banners') {
      const data = await api('/api/admin/banners');
      state.banners = data.banners || [];
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

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

async function addBanner(banner) {
  try {
    state.pending = true; render();
    await api('/api/admin/banners', { method: 'POST', body: banner });
    showToast('Баннер добавлен');
    await loadTabContent();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

async function toggleBanner(bannerId, isActive) {
  try {
    state.pending = true; render();
    await api(`/api/admin/banners/${bannerId}`, { method: 'PATCH', body: { is_active: !isActive } });
    showToast(isActive ? 'Баннер скрыт' : 'Баннер показан');
    await loadTabContent();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.pending = false; render();
  }
}

async function deleteBanner(id) {
  if (!confirm('Удалить баннер?')) return;
  try {
    state.pending = true; render();
    await api(`/api/admin/banners/${id}`, { method: 'DELETE' });
    showToast('Удалено');
    await loadTabContent();
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

function render() {
  if (state.loading) {
    elements.app.innerHTML = '<div class="loading">Загрузка...</div>';
    return;
  }

  elements.userInfo.innerHTML = `
    <span>${state.me ? escapeHtml(state.me.displayName) : ''}</span>
    <button class="btn-ghost" onclick="window.location.href='/'">На сайт</button>
    <button class="btn-ghost" id="logout-btn">Выйти</button>
  `;

  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  elements.app.innerHTML = `
    <div class="admin-container">
      <nav class="admin-nav">
        <button class="nav-item ${state.adminTab === 'users' ? 'is-active' : ''}" data-tab="users">
          <span class="nav-icon">👥</span> Пользователи
        </button>
        <button class="nav-item ${state.adminTab === 'tracks' ? 'is-active' : ''}" data-tab="tracks">
          <span class="nav-icon">🎵</span> Треки
        </button>
        <button class="nav-item ${state.adminTab === 'battles' ? 'is-active' : ''}" data-tab="battles">
          <span class="nav-icon">⚔️</span> Баттлы
        </button>
        <button class="nav-item ${state.adminTab === 'news' ? 'is-active' : ''}" data-tab="news">
          <span class="nav-icon">📰</span> Новости
        </button>
        <button class="nav-item ${state.adminTab === 'banners' ? 'is-active' : ''}" data-tab="banners">
          <span class="nav-icon">🎨</span> Баннеры
        </button>
      </nav>

      <div class="admin-content">
        ${renderTabContent()}
      </div>
    </div>
  `;

  bindTabEvents();
}

function bindTabEvents() {
  const form = document.getElementById('add-news-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addNews(form.title.value, form.body.value);
    form.reset();
  });

  const bannerForm = document.getElementById('add-banner-form');
  bannerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addBanner({
      title: bannerForm.title.value,
      body: bannerForm.body.value,
      link: bannerForm.link.value,
      link_text: bannerForm.link_text.value,
      image_url: bannerForm.image_url.value,
      bg_color: bannerForm.bg_color.value || '#1a1f3a',
      text_color: bannerForm.text_color.value || '#f7f3ea',
      is_active: true
    });
    bannerForm.reset();
  });

  const battleForm = document.getElementById('create-battle-form');
  battleForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/battles/create', {
        method: 'POST',
        body: {
          genre: battleForm.genre.value,
          trackAId: battleForm.trackAId.value,
          trackBId: battleForm.trackBId.value,
          hours: battleForm.hours.value
        }
      });
      showToast('Баттл создан');
      battleForm.reset();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function renderTabContent() {
  switch (state.adminTab) {
    case 'users':
      return `
        <div class="admin-section">
          <div class="admin-section-header">
            <h2>👥 Пользователи</h2>
            <span class="count-badge">${state.users.length}</span>
          </div>
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Никнейм</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              ${state.users.map(u => `
                <tr class="${u.isBanned ? 'is-banned' : ''}">
                  <td><code>${u.id}</code></td>
                  <td><strong>@${escapeHtml(u.nickname || u.username || '—')}</strong></td>
                  <td><span class="role-badge role-${u.role}">${u.role}</span></td>
                  <td>${u.isBanned ? '<span class="status-badge status-banned">🔴 Забанен</span>' : '<span class="status-badge status-active">🟢 Активен</span>'}</td>
                  <td>
                    <button class="btn-sm ${u.isBanned ? 'btn-success' : 'btn-danger'}" data-action="toggle-ban" data-id="${u.id}" data-banned="${u.isBanned}">
                      ${u.isBanned ? '✓ Разбанить' : '✕ Забанить'}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    case 'tracks':
      return `
        <div class="admin-section">
          <div class="admin-section-header">
            <h2>���� Треки</h2>
            <span class="count-badge">${state.tracks.length}</span>
          </div>
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
                  <td><code>${t.id}</code></td>
                  <td><strong>${escapeHtml(t.title)}</strong></td>
                  <td>@${escapeHtml(t.artist?.nickname || '—')}</td>
                  <td><span class="elo-badge">${t.elo}</span></td>
                  <td>
                    <button class="btn-sm btn-danger" data-action="delete-track" data-id="${t.id}">🗑️ Удалить</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    case 'battles':
      return `
        <div class="admin-section">
          <div class="admin-section-header">
            <h2>⚔️ Управление баттлами</h2>
          </div>
          <div class="action-cards">
            <button class="action-card" data-action="trigger-battles">
              <span class="action-icon">🔄</span>
              <div class="action-text">
                <strong>Автообновление</strong>
                <small>Создать новые ежедневные баттлы</small>
              </div>
            </button>
          </div>
          
          <div class="form-section">
            <h3>Создать баттл вручную</h3>
            <form id="create-battle-form" class="admin-form">
              <div class="form-row">
                <div class="form-group">
                  <label>Жанр</label>
                  <input name="genre" placeholder="Hip-Hop" required />
                </div>
                <div class="form-group">
                  <label>Часы</label>
                  <input name="hours" type="number" value="24" required />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>ID трека A</label>
                  <input name="trackAId" placeholder="1" required />
                </div>
                <div class="form-group">
                  <label>ID трека B</label>
                  <input name="trackBId" placeholder="2" required />
                </div>
              </div>
              <button type="submit" class="btn btn-primary">Создать баттл</button>
            </form>
          </div>
        </div>
      `;
    case 'news':
      return `
        <div class="admin-section">
          <div class="admin-section-header">
            <h2>📰 Новости</h2>
            <span class="count-badge">${state.news.length}</span>
          </div>
          
          <div class="form-section">
            <h3>➕ Добавить новость</h3>
            <form id="add-news-form" class="admin-form">
              <div class="form-group">
                <label>Заголовок</label>
                <input name="title" placeholder="Заголовок новости" required />
              </div>
              <div class="form-group">
                <label>Текст</label>
                <textarea name="body" placeholder="Текст новости..." rows="4" required></textarea>
              </div>
              <button type="submit" class="btn btn-primary">Опубликовать</button>
            </form>
          </div>
          
          <div class="cards-grid">
            ${state.news.map(n => `
              <div class="news-card-admin">
                <div class="news-card-header">
                  <span class="news-date">${formatDateTime(n.createdAt)}</span>
                  <button class="btn-delete" data-action="delete-news" data-id="${n.id}">✕</button>
                </div>
                <h4>${escapeHtml(n.title)}</h4>
                <p>${escapeHtml(n.body)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    case 'banners':
      return `
        <div class="admin-section">
          <div class="admin-section-header">
            <h2>🎨 Баннеры</h2>
            <span class="count-badge">${state.banners.length}</span>
          </div>
          
          <div class="form-section">
            <h3>➕ Добавить баннер</h3>
            <form id="add-banner-form" class="admin-form admin-form-grid">
              <div class="form-group">
                <label>Заголовок</label>
                <input name="title" placeholder="Заголовок баннера" required />
              </div>
              <div class="form-group">
                <label>Текст</label>
                <input name="body" placeholder="Описание баннера" required />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Ссылка</label>
                  <input name="link" placeholder="https://..." />
                </div>
                <div class="form-group">
                  <label>Текст кнопки</label>
                  <input name="link_text" placeholder="Подробнее" />
                </div>
              </div>
              <div class="form-group">
                <label>URL картинки</label>
                <input name="image_url" placeholder="https://..." />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Цвет фона</label>
                  <div class="color-input">
                    <input name="bg_color" type="color" value="#1a1f3a" />
                    <span>${state.banners.bg_color || '#1a1f3a'}</span>
                  </div>
                </div>
                <div class="form-group">
                  <label>Цвет текста</label>
                  <div class="color-input">
                    <input name="text_color" type="color" value="#f7f3ea" />
                    <span>${state.banners.text_color || '#f7f3ea'}</span>
                  </div>
                </div>
              </div>
              <button type="submit" class="btn btn-primary">Создать баннер</button>
            </form>
          </div>
          
          <div class="banners-grid">
            ${state.banners.map(b => `
              <div class="banner-preview" style="background: ${b.bg_color}; color: ${b.text_color};">
                <div class="banner-content">
                  ${b.image_url ? `<img src="${escapeHtml(b.image_url)}" alt="" class="banner-image" />` : ''}
                  <div class="banner-text">
                    <h4>${escapeHtml(b.title)}</h4>
                    <p>${escapeHtml(b.body)}</p>
                    ${b.link ? `<a href="${escapeHtml(b.link)}" target="_blank" class="banner-link" style="color: ${b.text_color}; border-color: ${b.text_color};">${escapeHtml(b.link_text || 'Перейти')}</a>` : ''}
                  </div>
                </div>
                <div class="banner-actions">
                  <span class="banner-status ${b.is_active ? 'is-active' : ''}">${b.is_active ? '🟢 Активен' : '⚫ Скрыт'}</span>
                  <button class="btn-sm ${b.is_active ? 'btn-warning' : 'btn-success'}" data-action="toggle-banner" data-id="${b.id}" data-active="${b.is_active}">
                    ${b.is_active ? 'Скрыть' : 'Показать'}
                  </button>
                  <button class="btn-sm btn-danger" data-action="delete-banner" data-id="${b.id}">🗑️</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    default: return '';
  }
}

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
  if (action === 'delete-banner') deleteBanner(id);
  if (action === 'toggle-banner') toggleBanner(id, actionBtn.dataset.active === 'true');
  if (action === 'trigger-battles') triggerBattles();
});

if (state.isLoggedIn) {
  showApp();
  loadBootstrap();
} else {
  showLogin();
  render();
}