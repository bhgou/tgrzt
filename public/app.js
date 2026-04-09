const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.('#081420');
tg?.setBackgroundColor?.('#081420');

const state = {
  activeView: 'home',
  artistReturnView: 'home',
  loading: true,
  pending: false,
  supportChatOpen: false,
  supportLoaded: false,
  supportLoading: false,
  supportMessages: [],
  supportDraft: '',
  showRegisterForm: false,
  me: null,
  selectedArtist: null,
  featuredTracks: [],
  latestTracks: [],
  topArtists: [],
  platformStats: null,
  searchQuery: '',
  searchResults: {
    artists: [],
    tracks: [],
  },
  capabilities: {
    ffmpegReady: false,
    botConfigured: false,
  },
};

const elements = {
  app: document.querySelector('#app'),
  supportBackdrop: document.querySelector('#support-backdrop'),
  supportDrawer: document.querySelector('#support-drawer'),
  supportToggle: document.querySelector('#support-toggle'),
  toast: document.querySelector('#toast'),
  topbarMeta: document.querySelector('#topbar-meta'),
  navButtons: [...document.querySelectorAll('.nav-btn')],
};

let toastTimer = null;
let searchTimer = null;

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
  }).format(new Date(dateString));
}

function formatDateTime(dateString) {
  if (!dateString) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString));
}

function formatRating(value) {
  return Number(value || 0).toFixed(1);
}

function formatFollowers(value) {
  return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
}

function getViewLabel(view) {
  if (view === 'search') {
    return 'поиск';
  }

  if (view === 'profile') {
    return 'кабинет';
  }

  if (view === 'upload') {
    return 'загрузку';
  }

  return 'главную';
}

function getAvatarInitials(name) {
  return String(name || 'DS')
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

function getRoleModeLabel(role) {
  if (role === 'artist') {
    return 'Artist mode';
  }

  if (role === 'listener') {
    return 'Listener mode';
  }

  return 'Guest mode';
}

function getRoleDescription(role) {
  if (role === 'artist') {
    return 'Публикация релизов, сбор оценок, комментариев и подписчиков.';
  }

  if (role === 'listener') {
    return 'Прослушивание демок, лайки, комментарии и поиск новых артистов.';
  }

  return 'Профиль ещё не завершён.';
}

function isArtist(user) {
  return user?.role === 'artist';
}

function isListener(user) {
  return user?.role === 'listener';
}

function canSwitchToListener(user) {
  return !(user?.role === 'artist' && Number(user?.tracksCount) > 0);
}

function coverGradient(seed) {
  const palettes = [
    'linear-gradient(135deg, rgba(255,138,91,0.9), rgba(255,209,102,0.88))',
    'linear-gradient(135deg, rgba(32,201,151,0.88), rgba(115,214,255,0.9))',
    'linear-gradient(135deg, rgba(255,120,120,0.88), rgba(255,138,91,0.9))',
    'linear-gradient(135deg, rgba(255,209,102,0.88), rgba(32,201,151,0.9))',
  ];

  return palettes[Number(seed || 0) % palettes.length];
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

async function withPending(task, successMessage) {
  state.pending = true;
  render();

  try {
    const result = await task();

    if (successMessage) {
      showToast(successMessage);
    }

    return result;
  } catch (error) {
    showToast(error.message, true);
    throw error;
  } finally {
    state.pending = false;
    render();
  }
}

async function loadBootstrap(options = {}) {
  if (!options.silent) {
    state.loading = true;
    render();
  }

  const data = await api('/api/bootstrap');
  Object.assign(state, data);

  if (!state.searchQuery.trim()) {
    state.searchResults = {
      artists: state.topArtists,
      tracks: state.latestTracks.slice(0, 8),
    };
  }

  state.loading = false;
  render();
}

async function runSearch(query, options = {}) {
  state.searchQuery = query;

  if (!query.trim()) {
    state.searchResults = {
      artists: state.topArtists,
      tracks: state.latestTracks.slice(0, 8),
    };
    render();
    return;
  }

  if (!options.silent) {
    state.pending = true;
    render();
  }

  try {
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
    state.searchResults = results;
    render();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.pending = false;
    render();
  }
}

async function openArtistProfile(artistId, options = {}) {
  if (!options.silent) {
    state.pending = true;
    render();
  }

  try {
    const profile = await api(`/api/artists/${artistId}`);

    if (options.rememberReturnView !== false && state.activeView !== 'artist') {
      state.artistReturnView = state.activeView;
    }

    state.selectedArtist = profile;
    state.activeView = 'artist';
    render();
    return profile;
  } catch (error) {
    showToast(error.message, true);
    return null;
  } finally {
    state.pending = false;
    render();
  }
}

async function loadSupportMessages(options = {}) {
  if (!options.silent) {
    state.supportLoading = true;
    render();
  }

  try {
    const response = await api('/api/support/messages');
    state.supportMessages = response.messages || [];
    state.supportLoaded = true;
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.supportLoading = false;
    render();
  }
}

async function openSupportChat() {
  state.supportChatOpen = true;
  render();

  if (!state.supportLoaded) {
    await loadSupportMessages();
  }
}

function closeSupportChat() {
  state.supportChatOpen = false;
  render();
}

function renderAvatar(entity, className = 'avatar') {
  if (entity?.avatarUrl) {
    return `<span class="${className}"><img src="${entity.avatarUrl}" alt="${escapeHtml(entity.displayName || entity.nickname || 'Avatar')}" /></span>`;
  }

  return `<span class="${className}">${escapeHtml(getAvatarInitials(entity?.displayName || entity?.nickname || entity?.username))}</span>`;
}

function renderRoleTag(role) {
  const safeRole = role === 'artist' || role === 'listener' ? role : 'guest';
  return `<span class="role-tag ${safeRole}">${escapeHtml(getRoleLabel(safeRole))}</span>`;
}

function renderStatsTiles(stats) {
  return `
    <div class="hero-stats">
      <div class="stat-tile">
        <strong>${formatFollowers(stats?.tracksCount)}</strong>
        <span class="muted">треков уже в каталоге</span>
      </div>
      <div class="stat-tile">
        <strong>${formatFollowers(stats?.artistsCount)}</strong>
        <span class="muted">артистов в комьюнити</span>
      </div>
      <div class="stat-tile">
        <strong>${formatFollowers(stats?.listenersCount)}</strong>
        <span class="muted">слушателей следят за релизами</span>
      </div>
      <div class="stat-tile">
        <strong>${formatFollowers(stats?.ratingsCount)}</strong>
        <span class="muted">оценок уже поставлено</span>
      </div>
    </div>
  `;
}

function renderArtistCard(artist) {
  return `
    <article class="artist-card">
      <button class="artist-link" data-action="open-artist" data-artist-id="${artist.id}">
        <span class="artist-card-top">
          ${renderAvatar(artist)}
          <span class="meta-col">
            <strong>${escapeHtml(artist.displayName)}</strong>
            <span class="muted">@${escapeHtml(artist.nickname || artist.username || 'artist')}</span>
          </span>
        </span>
      </button>
      <div class="badge-row">
        ${renderRoleTag('artist')}
        <span class="pill">${formatFollowers(artist.tracksCount)} треков</span>
        <span class="pill">${formatFollowers(artist.followersCount)} подписчиков</span>
      </div>
      <p class="muted">${escapeHtml(artist.bio || 'Пока без описания, но профиль уже открыт для подписок.')}</p>
      <div class="cta-row">
        <button class="btn-secondary" data-action="open-artist" data-artist-id="${artist.id}">
          Смотреть треки
        </button>
        <button
          class="btn-ghost"
          data-action="toggle-follow"
          data-artist-id="${artist.id}"
          ${artist.id === state.me?.id ? 'disabled' : ''}
        >
          ${artist.id === state.me?.id ? 'Это твой профиль' : artist.isFollowing ? 'Подписка активна' : 'Подписаться'}
        </button>
      </div>
    </article>
  `;
}

function renderComment(comment) {
  return `
    <div class="comment">
      <div class="comment-head">
        ${renderAvatar(comment.user, 'avatar avatar-sm')}
        <div class="meta-col">
          <strong>${escapeHtml(comment.user.displayName)}</strong>
          <span class="muted">${formatDate(comment.createdAt)}</span>
        </div>
      </div>
      <p>${escapeHtml(comment.body)}</p>
    </div>
  `;
}

function renderTrackCard(track) {
  const canDeleteTrack = Boolean(state.me?.isAdmin || track.isOwnTrack);
  const deleteLabel = state.me?.isAdmin && !track.isOwnTrack ? 'Удалить как админ' : 'Удалить трек';
  const ratingOptions = Array.from({ length: 10 }, (_, index) => index + 1)
    .map((score) => `<option value="${score}" ${Number(track.userRating) === score ? 'selected' : ''}>${score}</option>`)
    .join('');

  return `
    <article class="track-card">
      <div class="cover-art" style="background: ${coverGradient(track.id)};">
        <span class="cover-badge">${escapeHtml(track.genre || 'Demo tape')}</span>
      </div>

      <div class="track-head">
        <div>
          <p class="eyebrow">${formatDate(track.createdAt) || 'Свежий релиз'}</p>
          <h4>${escapeHtml(track.title)}</h4>
        </div>
        <span class="rating-pill">${formatRating(track.averageRating)} / 10</span>
      </div>

      <div class="artist-row">
        <button class="artist-link artist-link-inline" data-action="open-artist" data-artist-id="${track.artist.id}">
          ${renderAvatar(track.artist, 'avatar avatar-sm')}
          <span class="meta-col">
            <strong>${escapeHtml(track.artist.displayName)}</strong>
            <span class="muted">@${escapeHtml(track.artist.nickname || track.artist.username || 'artist')}</span>
          </span>
        </button>
        <div class="spacer"></div>
        <button class="btn-ghost" data-action="open-artist" data-artist-id="${track.artist.id}">
          Треки артиста
        </button>
        <button
          class="btn-ghost"
          data-action="toggle-follow"
          data-artist-id="${track.artist.id}"
          ${track.isOwnTrack ? 'disabled' : ''}
        >
          ${track.isOwnTrack ? 'Это твой релиз' : track.isFollowingArtist ? 'Подписан' : 'Подписаться'}
        </button>
      </div>

      <div class="badge-row">
        ${renderRoleTag('artist')}
        <span class="pill">${track.ratingsCount} оценок</span>
        <span class="pill">${track.likesCount} лайков</span>
        <span class="pill">${track.commentsCount} комментариев</span>
      </div>

      <p class="track-description">${escapeHtml(track.description || 'Автор ждёт честный фидбек по демке.')}</p>

      <audio controls src="${track.mp3Url}"></audio>

      <div class="stats-row">
        <button
          class="btn-ghost"
          data-action="toggle-like"
          data-track-id="${track.id}"
          ${track.isOwnTrack ? 'disabled' : ''}
        >
          ${track.isLiked ? 'Убрать лайк' : 'Лайкнуть'}
        </button>
        <a class="btn-ghost" href="${track.wavUrl}" download>Скачать WAV</a>
        ${
          canDeleteTrack
            ? `
              <button class="btn-danger" data-action="delete-track" data-track-id="${track.id}">
                ${deleteLabel}
              </button>
            `
            : ''
        }
      </div>

      <form class="inline-form" data-form="rating" data-track-id="${track.id}">
        <div class="field">
          <label>Поставь оценку по 10-балльной шкале</label>
          <select name="score" ${track.isOwnTrack ? 'disabled' : ''}>
            ${ratingOptions}
          </select>
        </div>
        <button class="btn-secondary" ${track.isOwnTrack ? 'disabled' : ''}>
          ${track.userRating ? 'Обновить оценку' : 'Оценить трек'}
        </button>
      </form>

      <div class="comment-list">
        ${track.comments.length ? track.comments.map(renderComment).join('') : '<div class="empty-state"><strong>Пока без комментариев</strong><span class="muted">Оставь первый фидбек по этому треку.</span></div>'}
      </div>

      <form class="inline-form" data-form="comment" data-track-id="${track.id}">
        <div class="field">
          <label>Комментарий</label>
          <textarea name="body" placeholder="Напиши, что с вокалом, аранжировкой, сведением или хитом." maxlength="280"></textarea>
        </div>
        <button class="btn">Оставить комментарий</button>
      </form>
    </article>
  `;
}

function renderSupportBubble(message) {
  const author = message.senderType === 'user' ? 'Вы' : 'Поддержка';

  return `
    <div class="support-bubble ${message.senderType}">
      <strong>${escapeHtml(author)}</strong>
      <p>${escapeHtml(message.body)}</p>
      <small class="muted">${escapeHtml(formatDateTime(message.createdAt))}</small>
    </div>
  `;
}

function renderSupportDrawer() {
  if (!elements.supportDrawer || !elements.supportBackdrop || !elements.supportToggle) {
    return;
  }

  const supportMessages = state.supportMessages.length
    ? state.supportMessages
    : [
        {
          id: 'welcome',
          senderType: 'support',
          body: 'Поддержка на связи. Напиши сюда вопрос по ролям, загрузке WAV, Mini App, подпискам или модерации.',
          createdAt: '',
        },
      ];

  elements.supportToggle.textContent = state.supportChatOpen ? 'Закрыть чат' : 'Поддержка';
  elements.supportToggle.disabled = state.pending || state.supportLoading;
  elements.supportBackdrop.classList.toggle('is-visible', state.supportChatOpen);
  elements.supportDrawer.classList.toggle('is-open', state.supportChatOpen);
  elements.supportDrawer.setAttribute('aria-hidden', state.supportChatOpen ? 'false' : 'true');
  elements.supportDrawer.innerHTML = `
    <div class="support-head">
      <div>
        <p class="eyebrow">Support chat</p>
        <h3>Чат поддержки</h3>
      </div>
      <button class="support-close" type="button" data-action="support-close">✕</button>
    </div>

    <div class="support-note">
      <strong>Если что-то не работает, напиши сюда.</strong>
      <p class="muted">Поддержка помогает с ролями, загрузкой, Mini App, подписками и жалобами на контент.</p>
    </div>

    <div class="support-feed">
      <div class="support-quick-list">
        <button class="support-chip" type="button" data-action="support-prompt" data-message="Не открывается Mini App">Mini App</button>
        <button class="support-chip" type="button" data-action="support-prompt" data-message="Не могу загрузить WAV">Загрузка WAV</button>
        <button class="support-chip" type="button" data-action="support-prompt" data-message="Как переключиться на артиста?">Смена роли</button>
      </div>
      ${
        state.supportLoading
          ? '<div class="empty-state"><strong>Загружаю чат поддержки</strong><span class="muted">Пара секунд.</span></div>'
          : supportMessages.map(renderSupportBubble).join('')
      }
    </div>

    <form class="support-form" data-form="support">
      <div class="field">
        <label for="support-message-input">Сообщение в поддержку</label>
        <textarea id="support-message-input" name="body" maxlength="500" placeholder="Например: у меня не открывается Mini App или не загружается WAV.">${escapeHtml(state.supportDraft)}</textarea>
      </div>
      <button class="btn" ${state.supportLoading ? 'disabled' : ''}>Отправить в поддержку</button>
    </form>
  `;
}

function renderTracksSection(title, subtitle, tracks, emptyMessage) {
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(subtitle)}</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      ${
        tracks.length
          ? `<div class="track-grid">${tracks.map(renderTrackCard).join('')}</div>`
          : `<div class="empty-state"><strong>${escapeHtml(emptyMessage)}</strong><span class="muted">Когда артисты начнут грузить демки, они появятся здесь.</span></div>`
      }
    </section>
  `;
}

function renderArtistsSection(title, subtitle, artists) {
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(subtitle)}</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      ${
        artists.length
          ? `<div class="artist-grid">${artists.map(renderArtistCard).join('')}</div>`
          : `<div class="empty-state"><strong>Пока нет артистов</strong><span class="muted">Регистрация артистов появится здесь автоматически.</span></div>`
      }
    </section>
  `;
}

function renderRoleOptions(name, selectedRole, options = {}) {
  const listenerDisabled = Boolean(options.listenerDisabled);

  return `
    <div class="role-grid">
      <label class="role-option">
        <input type="radio" name="${escapeHtml(name)}" value="artist" ${selectedRole === 'artist' ? 'checked' : ''} />
        <span class="role-card">
          <small>Artist mode</small>
          <strong>Артист</strong>
          <span>Загружай WAV, собирай оценки и строй свою аудиторию.</span>
        </span>
      </label>
      <label class="role-option ${listenerDisabled ? 'is-disabled' : ''}">
        <input
          type="radio"
          name="${escapeHtml(name)}"
          value="listener"
          ${selectedRole === 'listener' ? 'checked' : ''}
          ${listenerDisabled ? 'disabled' : ''}
        />
        <span class="role-card">
          <small>Listener mode</small>
          <strong>Слушатель</strong>
          <span>Оценивай демки, лайкай треки, подписывайся на артистов и находи новое звучание.</span>
        </span>
      </label>
    </div>
  `;
}

function renderProfileStats(user) {
  if (isArtist(user)) {
    return `
      <div class="profile-stats">
        <div class="stat-tile">
          <strong>${formatFollowers(user.tracksCount)}</strong>
          <span class="muted">своих релизов</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(user.followersCount)}</strong>
          <span class="muted">подписчиков</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(user.followingCount)}</strong>
          <span class="muted">подписок</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(user.likedTracksCount)}</strong>
          <span class="muted">лайков в профиле</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="profile-stats">
      <div class="stat-tile">
        <strong>${formatFollowers(user.likedTracksCount)}</strong>
        <span class="muted">лайкнутых треков</span>
      </div>
      <div class="stat-tile">
        <strong>${formatFollowers(user.followingCount)}</strong>
        <span class="muted">подписок на артистов</span>
      </div>
      <div class="stat-tile">
        <strong>${formatFollowers(state.latestTracks.length)}</strong>
        <span class="muted">свежих релизов в ленте</span>
      </div>
      <div class="stat-tile">
        <strong>${formatFollowers(state.topArtists.length)}</strong>
        <span class="muted">артистов в подборке</span>
      </div>
    </div>
  `;
}

function renderHomeView() {
  const primaryActionLabel = isArtist(state.me)
    ? 'Залить новый трек'
    : isListener(state.me)
      ? 'Переключиться в артиста'
      : 'Выбрать роль';

  return `
    <section class="panel hero">
      <div class="hero-copy">
        <p class="eyebrow">Launch your demo</p>
        <h2>Артисты публикуют демки, слушатели разгоняют им фидбек.</h2>
        <p>
          Demo Stage делит роли честно: артист загружает WAV и получает оценки по 10-балльной шкале,
          а слушатель ищет новое звучание, оставляет комментарии, ставит лайки и подписывается на авторов.
        </p>
        <div class="cta-row">
          <button class="btn" data-action="jump-view" data-view="${isArtist(state.me) ? 'upload' : 'profile'}">
            ${primaryActionLabel}
          </button>
          <button class="btn-ghost" data-action="jump-view" data-view="search">Искать артистов</button>
        </div>
      </div>
      ${renderStatsTiles(state.platformStats)}
    </section>

    ${renderTracksSection('Рейтинг сообщества', 'Top score', state.featuredTracks, 'Пока нет оценённых треков')}
    ${renderTracksSection('Свежие релизы', 'Latest drops', state.latestTracks, 'Пока нет свежих треков')}
    ${renderArtistsSection('Артисты, за которыми уже следят', 'Follow radar', state.topArtists)}
  `;
}

function renderSearchView() {
  return `
    <section class="panel stack">
      <div class="section-head">
        <div>
          <p class="eyebrow">Search system</p>
          <h3>Найди артиста или конкретный трек</h3>
        </div>
      </div>
      <div class="field">
        <label for="search-input">Поиск по артисту, никнейму, жанру или названию</label>
        <input
          id="search-input"
          name="search"
          type="search"
          placeholder="Например: drill, noah, summer tape"
          value="${escapeHtml(state.searchQuery)}"
        />
      </div>
    </section>

    ${renderArtistsSection('Найденные артисты', 'Artist matches', state.searchResults.artists)}
    ${renderTracksSection('Найденные треки', 'Track matches', state.searchResults.tracks, 'По этому запросу пока ничего не найдено')}
  `;
}

function renderUploadView() {
  if (!isArtist(state.me)) {
    const description = isListener(state.me)
      ? 'Сейчас твой профиль в режиме слушателя. В кабинете переключи роль на артиста, и после этого откроется загрузка релизов.'
      : 'Сначала зайди в кабинет и выбери роль. Загрузка треков открывается только для артистов.';

    return `
      <section class="panel auth-card">
        <p class="eyebrow">Upload locked</p>
        <h3>Загрузка доступна только артистам</h3>
        <p class="muted">${escapeHtml(description)}</p>
        <div class="cta-row">
          <button class="btn" data-action="jump-view" data-view="profile">Перейти в кабинет</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel stack">
      <div class="section-head">
        <div>
          <p class="eyebrow">Drop new demo</p>
          <h3>Загрузка нового релиза</h3>
        </div>
      </div>

      ${
        state.capabilities.ffmpegReady
          ? ''
          : `<div class="status-banner">Сейчас на сервере не найден ffmpeg. Форма готова, но конвертация WAV в MP3 не сработает, пока ffmpeg не будет установлен.</div>`
      }

      <form class="form-grid" data-form="upload">
        <div class="field">
          <label>Название трека</label>
          <input name="title" placeholder="Например: Night Demo 01" maxlength="80" required />
        </div>

        <div class="field">
          <label>Жанр</label>
          <input name="genre" placeholder="Например: melodic trap" maxlength="40" />
        </div>

        <div class="field">
          <label>Описание</label>
          <textarea
            name="description"
            placeholder="Коротко опиши настроение, референсы или то, какой фидбек ты хочешь получить."
            maxlength="500"
          ></textarea>
        </div>

        <div class="upload-zone">
          <strong>Загрузи исходник в WAV</strong>
          <span class="muted">Сервер сохранит WAV и подготовит MP3 для прослушивания другими пользователями.</span>
          <input name="track" type="file" accept=".wav,audio/wav" required />
        </div>

        <button class="btn">Опубликовать демку</button>
      </form>
    </section>
  `;
}

function renderArtistProfileView() {
  const profile = state.selectedArtist;
  const artist = profile?.artist;

  if (!artist) {
    return `
      <section class="panel auth-card">
        <p class="eyebrow">Artist not found</p>
        <h3>Профиль артиста пока недоступен</h3>
        <p class="muted">Открой поиск или главную и попробуй выбрать артиста снова.</p>
        <div class="cta-row">
          <button class="btn" data-action="jump-view" data-view="search">Перейти в поиск</button>
        </div>
      </section>
    `;
  }

  const backLabel = `Назад в ${getViewLabel(state.artistReturnView)}`;

  return `
    <section class="panel stack">
      <div class="artist-row">
        ${renderAvatar(artist, 'avatar avatar-lg')}
        <div class="profile-head">
          <p class="eyebrow">Artist profile</p>
          <h2>${escapeHtml(artist.displayName)}</h2>
          <p class="muted">@${escapeHtml(artist.nickname || artist.username || 'artist')}</p>
        </div>
      </div>

      <div class="badge-row">
        ${renderRoleTag('artist')}
        <span class="pill">${formatFollowers(artist.tracksCount)} треков</span>
        <span class="pill">${formatFollowers(artist.followersCount)} подписчиков</span>
      </div>

      <p class="track-description">${escapeHtml(artist.bio || 'Артист пока не добавил описание, но его демки и треки уже доступны для прослушивания.')}</p>

      <div class="profile-stats">
        <div class="stat-tile">
          <strong>${formatFollowers(artist.tracksCount)}</strong>
          <span class="muted">демок и треков</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(artist.followersCount)}</strong>
          <span class="muted">подписчиков</span>
        </div>
        <div class="stat-tile">
          <strong>${artist.isFollowing ? 'Вы подписаны' : 'Не подписаны'}</strong>
          <span class="muted">статус подписки</span>
        </div>
      </div>

      <div class="cta-row">
        <button class="btn-ghost" data-action="back-artist">${escapeHtml(backLabel)}</button>
        ${
          artist.id === state.me?.id
            ? '<button class="btn" data-action="jump-view" data-view="profile">Мой кабинет</button>'
            : `
              <button class="btn" data-action="toggle-follow" data-artist-id="${artist.id}">
                ${artist.isFollowing ? 'Отписаться' : 'Подписаться'}
              </button>
            `
        }
      </div>
    </section>

    ${renderTracksSection(`Демки и треки ${artist.displayName}`, 'Artist catalog', profile.tracks || [], 'У этого артиста пока нет опубликованных релизов')}
  `;
}

function renderRegisterForm(selectedRole = 'artist') {
  return `
    <form class="form-grid" data-form="register">
      <div class="field">
        <label>Выбери роль</label>
        ${renderRoleOptions('role', selectedRole)}
        <span class="role-note">Роль можно поменять позже в кабинете. Для загрузки треков нужен режим артиста.</span>
      </div>
      <div class="field">
        <label>Никнейм</label>
        <input name="nickname" maxlength="32" placeholder="Например: noah.wave" required />
      </div>
      <div class="field">
        <label>О себе</label>
        <textarea name="bio" maxlength="280" placeholder="Пара строк о стиле, вкусе, городе или том, что ты ищешь на платформе."></textarea>
      </div>
      <div class="field">
        <label>Аватарка</label>
        <input name="avatar" type="file" accept=".png,.jpg,.jpeg,.webp,image/*" />
      </div>
      <div class="cta-row">
        <button class="btn">Создать профиль</button>
        <button class="btn-ghost" type="button" data-action="hide-register">Скрыть форму</button>
      </div>
    </form>
  `;
}

function renderProfileView() {
  if (!state.me?.isRegistered) {
    return `
      <section class="panel auth-card stack">
        <div>
          <p class="eyebrow">Choose your mode</p>
          <h3>Сначала выбери, кто ты: артист или слушатель</h3>
          <p class="muted">
            После входа через Telegram можно создать профиль в одном из двух режимов.
            Артист публикует релизы, а слушатель оценивает демки, комментирует и подписывается на авторов.
          </p>
        </div>
        <div class="cta-row">
          <button class="btn-secondary" data-action="login">Войти</button>
          <button class="btn" data-action="show-register">Регистрация</button>
        </div>
        ${state.showRegisterForm ? renderRegisterForm('artist') : ''}
      </section>
    `;
  }

  const listenerBlocked = !canSwitchToListener(state.me);
  const introCopy = isArtist(state.me)
    ? 'Ты в режиме артиста: можно публиковать демки, получать лайки, комментарии и собирать подписчиков.'
    : 'Ты в режиме слушателя: можно искать артистов, лайкать треки, комментировать и в любой момент переключиться в артиста.';

  return `
    <section class="profile-grid">
      <div class="panel stack">
        <div class="artist-row">
          ${renderAvatar(state.me, 'avatar avatar-lg')}
          <div class="profile-head">
            <p class="eyebrow">${escapeHtml(getRoleModeLabel(state.me.role))}</p>
            <h2>${escapeHtml(state.me.displayName)}</h2>
            <p class="muted">@${escapeHtml(state.me.nickname || state.me.username || 'profile')}</p>
          </div>
        </div>

        <div class="badge-row">
          ${renderRoleTag(state.me.role)}
          ${state.me.isAdmin ? '<span class="role-tag admin">Админ</span>' : ''}
          <span class="pill">${escapeHtml(getRoleDescription(state.me.role))}</span>
        </div>

        <p class="track-description">${escapeHtml(state.me.bio || introCopy)}</p>
        ${renderProfileStats(state.me)}
        <div class="cta-row">
          ${state.me.isAdmin ? '<button class="btn-secondary" onclick="window.location.href=\'/admin.html\'">Открыть админ-панель</button>' : ''}
          ${state.me.isAdmin ? '<span class="pill">Можно удалять запрещённый контент</span>' : ''}
          <button class="btn-ghost" data-action="logout">Выйти из профиля</button>
        </div>
      </div>

      <section class="panel stack">
        <div class="section-head">
          <div>
            <p class="eyebrow">Edit profile</p>
            <h3>Редактирование профиля</h3>
          </div>
        </div>
        <form class="form-grid" data-form="profile">
          <div class="field">
            <label>Тип аккаунта</label>
            ${renderRoleOptions('role', state.me.role, { listenerDisabled: listenerBlocked })}
            <span class="role-note">
              ${listenerBlocked
                ? 'После публикации треков аккаунт остаётся артистическим, чтобы релизы и подписки не терялись.'
                : 'Можно переключиться между артистом и слушателем в любой момент, пока ты ещё не выпустил релизы.'}
            </span>
          </div>
          <div class="field">
            <label>Никнейм</label>
            <input name="nickname" value="${escapeHtml(state.me.nickname || '')}" maxlength="32" required />
          </div>
          <div class="field">
            <label>О себе</label>
            <textarea name="bio" maxlength="280">${escapeHtml(state.me.bio || '')}</textarea>
          </div>
          <div class="field">
            <label>Новая аватарка</label>
            <input name="avatar" type="file" accept=".png,.jpg,.jpeg,.webp,image/*" />
          </div>
          <button class="btn-secondary">Сохранить изменения</button>
        </form>
      </section>
    </section>

    ${
      isArtist(state.me)
        ? renderTracksSection('Мои треки', 'Own releases', state.me.ownTracks, 'Ты ещё не загрузил ни одного релиза')
        : `
          <section class="panel auth-card">
            <p class="eyebrow">Artist upgrade</p>
            <h3>Хочешь публиковать демки?</h3>
            <p class="muted">
              Треки и демки могут загружать только артисты. Переключи роль на артиста в форме выше,
              и после сохранения профиля раздел загрузки откроется сразу.
            </p>
          </section>
        `
    }

    ${renderTracksSection('Лайкнутые', 'Liked collection', state.me.likedTracks, 'Ты пока не лайкнул ни одного трека')}
  `;
}

function renderLoadingView() {
  return `
    <section class="loading-state">
      <div class="skeleton"></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
    </section>
  `;
}

function renderTopbar() {
  if (!state.me) {
    elements.topbarMeta.innerHTML = '';
    return;
  }

  const roleSummary = state.me.isRegistered ? getRoleLabel(state.me.role) : 'Гость / роль не выбрана';
  const adminSummary = state.me.isAdmin ? ' · админ' : '';

  elements.topbarMeta.innerHTML = `
    <div class="topbar-meta">
      <div class="user-chip">
        ${renderAvatar(state.me, 'avatar avatar-sm')}
        <div class="meta-col">
          <strong>${escapeHtml(state.me.displayName)}</strong>
          <small>${escapeHtml(roleSummary + adminSummary)}</small>
        </div>
      </div>
    </div>
  `;
}

function render() {
  renderTopbar();

  if (isListener(state.me) && state.activeView === 'upload') {
    state.activeView = 'profile';
  }

  elements.navButtons.forEach((button) => {
    button.hidden = button.dataset.view === 'upload' && isListener(state.me);
    button.classList.toggle('is-active', button.dataset.view === state.activeView);
    button.disabled = state.pending;
  });

  if (elements.navButtons[0]?.parentElement) {
    const visibleButtons = elements.navButtons.filter((button) => !button.hidden).length || 1;
    elements.navButtons[0].parentElement.style.gridTemplateColumns = `repeat(${visibleButtons}, 1fr)`;
  }

  if (state.loading) {
    renderSupportDrawer();
    elements.app.innerHTML = renderLoadingView();
    return;
  }

  switch (state.activeView) {
    case 'search':
      elements.app.innerHTML = renderSearchView();
      break;
    case 'upload':
      elements.app.innerHTML = renderUploadView();
      break;
    case 'profile':
      elements.app.innerHTML = renderProfileView();
      break;
    case 'artist':
      elements.app.innerHTML = renderArtistProfileView();
      break;
    case 'home':
    default:
      elements.app.innerHTML = renderHomeView();
      break;
  }

  renderSupportDrawer();
}

async function refreshAfterMutation(message) {
  const currentArtistId = state.activeView === 'artist' ? state.selectedArtist?.artist?.id : null;
  await loadBootstrap({ silent: true });

  if (state.activeView === 'search' && state.searchQuery.trim()) {
    await runSearch(state.searchQuery, { silent: true });
  }

  if (currentArtistId) {
    await openArtistProfile(currentArtistId, { silent: true, rememberReturnView: false });
  }

  if (message) {
    showToast(message);
  }
}

document.addEventListener('click', async (event) => {
  const navButton = event.target.closest('[data-view]');

  if (navButton && navButton.classList.contains('nav-btn')) {
    state.activeView = navButton.dataset.view;
    render();
    return;
  }

  if (event.target.closest('#support-toggle')) {
    if (state.supportChatOpen) {
      closeSupportChat();
    } else {
      await openSupportChat();
    }
    return;
  }

  if (event.target.closest('#support-backdrop')) {
    closeSupportChat();
    return;
  }

  const actionTarget = event.target.closest('[data-action]');

  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;

  if (action === 'jump-view') {
    state.activeView = actionTarget.dataset.view;
    render();
    return;
  }

  if (action === 'show-register') {
    state.showRegisterForm = true;
    render();
    return;
  }

  if (action === 'open-artist') {
    await openArtistProfile(actionTarget.dataset.artistId);
    return;
  }

  if (action === 'back-artist') {
    state.activeView = state.artistReturnView || 'home';
    render();
    return;
  }

  if (action === 'hide-register') {
    state.showRegisterForm = false;
    render();
    return;
  }

  if (action === 'support-close') {
    closeSupportChat();
    return;
  }

  if (action === 'support-prompt') {
    state.supportDraft = actionTarget.dataset.message || '';
    renderSupportDrawer();
    const textarea = document.querySelector('#support-message-input');
    textarea?.focus();
    textarea?.setSelectionRange?.(textarea.value.length, textarea.value.length);
    return;
  }

  if (action === 'login') {
    await withPending(async () => {
      const response = await api('/api/session/login', { method: 'POST' });
      showToast(response.message);
    });
    return;
  }

  if (action === 'toggle-like') {
    const trackId = actionTarget.dataset.trackId;
    await withPending(async () => {
      await api(`/api/tracks/${trackId}/like`, { method: 'POST' });
      await refreshAfterMutation('Лайк обновлён.');
    });
    return;
  }

  if (action === 'toggle-follow') {
    const artistId = actionTarget.dataset.artistId;
    await withPending(async () => {
      await api(`/api/artists/${artistId}/follow`, { method: 'POST' });
      await refreshAfterMutation('Подписка обновлена.');
    });
    return;
  }

  if (action === 'delete-track') {
    const trackId = actionTarget.dataset.trackId;
    const confirmed = window.confirm('Удалить этот трек? Лайки, оценки и комментарии к нему тоже будут удалены.');

    if (!confirmed) {
      return;
    }

    await withPending(async () => {
      await api(`/api/tracks/${trackId}`, { method: 'DELETE' });
      await refreshAfterMutation('Трек удалён.');
    });
    return;
  }

  if (action === 'logout') {
    await withPending(async () => {
      const response = await api('/api/session/logout', { method: 'POST' });
      showToast(response.message);

      if (response.closeMiniApp && tg?.close) {
        setTimeout(() => tg.close(), 250);
        return;
      }

      window.location.reload();
    });
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;

  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formType = form.dataset.form;

  if (!formType) {
    return;
  }

  event.preventDefault();

  if (formType === 'register') {
    await withPending(async () => {
      const data = new FormData(form);
      const role = String(data.get('role') || 'artist');
      await api('/api/register', {
        method: 'POST',
        body: data,
      });
      state.showRegisterForm = false;
      state.activeView = 'profile';
      await refreshAfterMutation(role === 'artist' ? 'Артист-профиль создан.' : 'Профиль слушателя создан.');
    });
    return;
  }

  if (formType === 'profile') {
    await withPending(async () => {
      const data = new FormData(form);
      await api('/api/profile', {
        method: 'POST',
        body: data,
      });
      await refreshAfterMutation('Профиль обновлён.');
    });
    return;
  }

  if (formType === 'upload') {
    await withPending(async () => {
      const data = new FormData(form);
      await api('/api/tracks', {
        method: 'POST',
        body: data,
      });
      form.reset();
      state.activeView = 'profile';
      await refreshAfterMutation('Трек опубликован.');
    });
    return;
  }

  if (formType === 'support') {
    const body = trimSupportMessage(new FormData(form).get('body'));

    if (!body) {
      showToast('Напиши вопрос для поддержки.', true);
      return;
    }

    state.supportLoading = true;
    render();

    try {
      const response = await api('/api/support/messages', {
        method: 'POST',
        body: { body },
      });
      state.supportMessages = response.messages || [];
      state.supportLoaded = true;
      state.supportDraft = '';
      showToast('Сообщение отправлено в поддержку.');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      state.supportLoading = false;
      render();
    }
    return;
  }

  if (formType === 'rating') {
    const trackId = form.dataset.trackId;
    const score = Number(new FormData(form).get('score'));

    await withPending(async () => {
      await api(`/api/tracks/${trackId}/rate`, {
        method: 'POST',
        body: { score },
      });
      await refreshAfterMutation('Оценка сохранена.');
    });
    return;
  }

  if (formType === 'comment') {
    const trackId = form.dataset.trackId;
    const body = trimComment(new FormData(form).get('body'));

    if (!body) {
      showToast('Напиши комментарий чуть подробнее.', true);
      return;
    }

    await withPending(async () => {
      await api(`/api/tracks/${trackId}/comments`, {
        method: 'POST',
        body: { body },
      });
      form.reset();
      await refreshAfterMutation('Комментарий добавлен.');
    });
  }
});

function trimComment(value) {
  return String(value || '').trim().slice(0, 280);
}

function trimSupportMessage(value) {
  return String(value || '').trim().slice(0, 500);
}

document.addEventListener('input', (event) => {
  const target = event.target;

  if (target instanceof HTMLInputElement && target.id === 'search-input') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void runSearch(target.value);
    }, 260);
  }

  if (target instanceof HTMLTextAreaElement && target.id === 'support-message-input') {
    state.supportDraft = target.value.slice(0, 500);
  }
});

loadBootstrap().catch((error) => {
  state.loading = false;
  render();
  showToast(error.message, true);
});
