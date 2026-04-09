// Admin Panel JavaScript - Telegram Mini App

const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.('#081420');
tg?.setBackgroundColor?.('#081420');

const state = {
  currentUser: null,
  users: [],
  admins: [],
  loading: false,
  searchQuery: '',
};

const elements = {
  loginPanel: document.querySelector('#login-panel'),
  adminPanel: document.querySelector('#admin-panel'),
  backBtn: document.querySelector('#back-btn'),
  logoutBtn: document.querySelector('#logout-btn'),
  usersList: document.querySelector('#users-list'),
  adminsList: document.querySelector('#admins-list'),
  userSearchInput: document.querySelector('#user-search-input'),
  addAdminForm: document.querySelector('#add-admin-form'),
  newAdminIdInput: document.querySelector('#new-admin-id'),
  linkArtistForm: document.querySelector('#link-artist-form'),
  linkTelegramIdInput: document.querySelector('#link-telegram-id'),
  linkArtistNicknameInput: document.querySelector('#link-artist-nickname'),
  adminUserInfo: document.querySelector('#admin-user-info'),
  toast: document.querySelector('#toast'),
  tabs: [...document.querySelectorAll('.admin-tab')],
  tabContents: {
    users: document.querySelector('#users-tab'),
    admins: document.querySelector('#admins-tab'),
    linkArtist: document.querySelector('#link-artist-tab'),
  },
};

let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(dateString) {
  if (!dateString) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString));
}

function getAvatarInitials(name) {
  return String(name || 'U')
    .trim()
    .slice(0, 2)
    .toUpperCase();
}

function getRoleLabel(role) {
  if (role === 'artist') {
    return 'Артист';
  }

  if (role === 'listener') {
    return 'Слушатель';
  }

  return 'Гость';
}

function showToast(message, isError = false) {
  if (!message) {
    return;
  }

  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  elements.toast.classList.toggle('is-error', isError);

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('is-visible');
    elements.toast.classList.remove('is-error');
  }, 3200);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const initData = tg?.initData || '';

  if (initData) {
    headers.set('X-Telegram-Init-Data', initData);
  }

  let body = options.body;

  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Запрос завершился с ошибкой.');
  }

  return data;
}

async function checkAdminAccess() {
  state.loading = true;
  render();

  try {
    const response = await api('/api/admin/check');
    
    if (response.isAdmin) {
      state.currentUser = response.user;
      await Promise.all([loadUsers(), loadAdmins()]);
      showAdminPanel();
      showToast('Добро пожаловать в админ-панель');
    } else {
      showToast('У вас нет прав администратора', true);
      showAccessDenied();
    }
  } catch (error) {
    showToast(error.message, true);
    showAccessDenied();
  } finally {
    state.loading = false;
    render();
  }
}

async function loadUsers() {
  try {
    const response = await api('/api/admin/users?limit=100');
    state.users = response.users || [];
    renderUsersList();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadAdmins() {
  try {
    const response = await api('/api/admin/users/admins');
    state.admins = response.admins || [];
    renderAdminsList();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function addAdminByUserId(userId) {
  try {
    await api(`/api/admin/users/${userId}/admin`, { method: 'POST' });
    showToast('Пользователь добавлен в администраторы');
    await Promise.all([loadUsers(), loadAdmins()]);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function removeAdmin(userId) {
  try {
    await api(`/api/admin/users/${userId}/admin`, { method: 'DELETE' });
    showToast('Права администратора удалены');
    await Promise.all([loadUsers(), loadAdmins()]);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function linkArtistToTelegram(telegramId, artistNickname) {
  try {
    const response = await api('/api/admin/link-artist', {
      method: 'POST',
      body: { telegramId, artistNickname },
    });
    
    showToast('Артист успешно привязан к Telegram аккаунту');
    await Promise.all([loadUsers(), loadAdmins()]);
    
    return response;
  } catch (error) {
    showToast(error.message, true);
    throw error;
  }
}

function showAdminPanel() {
  elements.loginPanel.style.display = 'none';
  elements.adminPanel.style.display = 'block';
  elements.adminUserInfo.innerHTML = `<span class="admin-user-badge">👑 ${escapeHtml(state.currentUser.displayName)}</span>`;
}

function showAccessDenied() {
  elements.loginPanel.style.display = 'block';
  elements.adminPanel.style.display = 'none';
  elements.loginPanel.innerHTML = `
    <p class="eyebrow">Access Denied</p>
    <h3>Доступ запрещён</h3>
    <p class="muted">У вас нет прав администратора для доступа к этой панели</p>
    <div class="cta-row">
      <button class="btn" onclick="window.Telegram?.WebApp?.close()">Закрыть</button>
    </div>
  `;
}

function renderAvatar(user, className = 'user-avatar') {
  if (user.avatarUrl) {
    return `<div class="${className}"><img src="${user.avatarUrl}" alt="${escapeHtml(user.displayName)}" /></div>`;
  }

  return `<div class="${className}">${escapeHtml(getAvatarInitials(user.displayName))}</div>`;
}

function renderUserCard(user) {
  const isAdmin = state.admins.some(admin => admin.id === user.id);
  const isCurrentUser = state.currentUser && state.currentUser.id === user.id;

  return `
    <div class="user-card">
      <div class="user-card-header">
        ${renderAvatar(user)}
        <div class="user-info">
          <strong>${escapeHtml(user.displayName)}</strong>
          <span class="muted">@${escapeHtml(user.username || user.nickname || 'user_' + user.telegramId)}</span>
        </div>
      </div>

      <div class="user-meta">
        <span class="user-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          ID: ${user.id}
        </span>
        <span class="user-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          TG: ${escapeHtml(user.telegramId)}
        </span>
        <span class="user-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          ${formatDate(user.createdAt)}
        </span>
      </div>

      <div class="user-actions">
        <span class="user-badge ${user.role}">${escapeHtml(getRoleLabel(user.role))}</span>
        ${isAdmin ? '<span class="user-badge admin">👑 Админ</span>' : ''}
        ${!isAdmin && !isCurrentUser ? `
          <button class="btn-ghost" onclick="makeAdmin(${user.id})" style="margin-left: auto; font-size: 0.85rem;">
            Назначить админом
          </button>
        ` : ''}
        ${isAdmin && !isCurrentUser ? `
          <button class="btn-danger" onclick="removeAdmin(${user.id})" style="margin-left: auto; font-size: 0.85rem;">
            Убрать админа
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderUsersList() {
  const filteredUsers = state.users.filter(user => {
    if (!state.searchQuery) {
      return true;
    }

    const query = state.searchQuery.toLowerCase();
    return (
      user.displayName.toLowerCase().includes(query) ||
      (user.username && user.username.toLowerCase().includes(query)) ||
      user.telegramId.includes(query) ||
      String(user.id).includes(query)
    );
  });

  if (filteredUsers.length === 0) {
    elements.usersList.innerHTML = `
      <div class="empty-state">
        <strong>${state.searchQuery ? 'Ничего не найдено' : 'Пользователей пока нет'}</strong>
        <span class="muted">${state.searchQuery ? 'Попробуйте другой запрос' : 'Когда пользователи зарегистрируются, они появятся здесь.'}</span>
      </div>
    `;
    return;
  }

  elements.usersList.innerHTML = filteredUsers.map(renderUserCard).join('');
}

function renderAdminsList() {
  if (state.admins.length === 0) {
    elements.adminsList.innerHTML = `
      <div class="empty-state">
        <strong>Администраторов пока нет</strong>
        <span class="muted">Добавьте первого администратора через форму выше.</span>
      </div>
    `;
    return;
  }

  elements.adminsList.innerHTML = state.admins.map(renderUserCard).join('');
}

function render() {
  // Обновляем состояние загрузки если нужно
}

function switchTab(tabName) {
  elements.tabs.forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.tab === tabName);
  });

  Object.entries(elements.tabContents).forEach(([name, element]) => {
    element.style.display = name === tabName ? 'block' : 'none';
  });
}

// Global functions for inline event handlers
window.makeAdmin = async function(userId) {
  await addAdminByUserId(userId);
};

window.removeAdmin = async function(userId) {
  await removeAdmin(userId);
};

// Event Listeners
elements.backBtn.addEventListener('click', () => {
  window.location.href = '/';
});

elements.logoutBtn.addEventListener('click', () => {
  tg?.close();
});

elements.userSearchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderUsersList();
});

elements.addAdminForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const telegramId = elements.newAdminIdInput.value.trim();

  if (!telegramId) {
    showToast('Введите Telegram ID пользователя', true);
    return;
  }

  // Находим пользователя по Telegram ID и добавляем как админа
  const user = state.users.find(u => u.telegramId === telegramId);
  
  if (!user) {
    showToast('Пользователь с таким Telegram ID не найден в системе', true);
    return;
  }

  await addAdminByUserId(user.id);
  elements.newAdminIdInput.value = '';
});

elements.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
  });
});

// Ripple effect for buttons
document.querySelectorAll('.btn, .btn-secondary, .btn-ghost, .btn-danger, .admin-tab').forEach(button => {
  button.addEventListener('mousemove', (e) => {
    const rect = button.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    button.style.setProperty('--x', `${x}%`);
    button.style.setProperty('--y', `${y}%`);
  });
});

// Add stagger animation to user cards on load
function animateCards() {
  const cards = document.querySelectorAll('.user-card');
  cards.forEach((card, index) => {
    card.style.animationDelay = `${index * 0.05}s`;
  });
}

// Observe DOM changes to trigger card animations
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.addedNodes.length > 0) {
      animateCards();
    }
  });
});

observer.observe(elements.usersList, { childList: true });
observer.observe(elements.adminsList, { childList: true });

elements.linkArtistForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const telegramId = elements.linkTelegramIdInput.value.trim();
  const artistNickname = elements.linkArtistNicknameInput.value.trim();

  if (!telegramId || !artistNickname) {
    showToast('Заполните все поля', true);
    return;
  }

  if (confirm(`Вы уверены, что хотите привязать артиста "${artistNickname}" к Telegram ID ${telegramId}? Старый пользователь будет удалён, а все его данные будут перенесены.`)) {
    await linkArtistToTelegram(telegramId, artistNickname);
    elements.linkTelegramIdInput.value = '';
    elements.linkArtistNicknameInput.value = '';
  }
});

// Initialize
async function init() {
  await checkAdminAccess();
}

init();
