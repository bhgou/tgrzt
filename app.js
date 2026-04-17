const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.("#0d1024");
tg?.setBackgroundColor?.("#0d1024");

const state = {
  activeView: "home",
  artistReturnView: "home",
  loading: true,
  pending: false,
  supportChatOpen: false,
  supportLoaded: false,
  supportLoading: false,
  supportMessages: [],
  supportDraft: "",
  showRegisterForm: false,
  me: null,
  selectedArtist: null,
  featuredTracks: [],
  latestTracks: [],
  topArtists: [],
  platformStats: null,
  inviteCode: null,
  botUsername: "",
  pendingInviteCode: null,
  topInviters: [],
  searchQuery: "",
  searchResults: {
    artists: [],
    tracks: [],
  },
  capabilities: {
    ffmpegReady: false,
    botConfigured: false,
  },
  activeTrack: null,
  activeTrackPending: false,
};

// Extract invite code from Telegram start_param or URL ?invite=
(function extractInviteCode() {
  try {
    const tgParam = tg?.initDataUnsafe?.start_param;
    if (tgParam) {
      state.pendingInviteCode = String(tgParam).trim();
      return;
    }
  } catch (_e) {}
  try {
    const url = new URL(window.location.href);
    const fromQuery =
      url.searchParams.get("invite") || url.searchParams.get("startapp");
    if (fromQuery) {
      state.pendingInviteCode = String(fromQuery).trim();
    }
  } catch (_e) {}
})();

const elements = {
  app: document.querySelector("#app"),
  supportBackdrop: document.querySelector("#support-backdrop"),
  supportDrawer: document.querySelector("#support-drawer"),
  supportToggle: document.querySelector("#support-toggle"),
  toast: document.querySelector("#toast"),
  topbarMeta: document.querySelector("#topbar-meta"),
  navButtons: [...document.querySelectorAll(".nav-btn")],
  trackModal: document.querySelector("#track-modal"),
  trackModalBackdrop: document.querySelector("#track-modal-backdrop"),
};

let toastTimer = null;
let searchTimer = null;
const recentTrackPlays = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
  }).format(new Date(dateString));
}

function formatDateTime(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

function formatRating(value) {
  return Number(value || 0).toFixed(1);
}

function formatFollowers(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function pluralizeRu(n, one, few, many) {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const mod10 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function getViewLabel(view) {
  if (view === "search") {
    return "поиск";
  }

  if (view === "profile") {
    return "кабинет";
  }

  if (view === "upload") {
    return "загрузку";
  }

  return "главную";
}

function getAvatarInitials(name) {
  return String(name || "DS")
    .trim()
    .slice(0, 2)
    .toUpperCase();
}

function getRoleLabel(role) {
  if (role === "artist") {
    return "Артист";
  }

  if (role === "listener") {
    return "Слушатель";
  }

  return "Гость";
}

function getRoleModeLabel(role) {
  if (role === "artist") {
    return "Artist mode";
  }

  if (role === "listener") {
    return "Listener mode";
  }

  return "Guest mode";
}

function getRoleDescription(role) {
  if (role === "artist") {
    return "Публикация релизов, сбор оценок, комментариев и подписчиков.";
  }

  if (role === "listener") {
    return "Прослушивание демок, лайки, комментарии и поиск новых артистов.";
  }

  return "Профиль ещё не завершён.";
}

function isArtist(user) {
  return user?.role === "artist";
}

function isListener(user) {
  return user?.role === "listener";
}

function canSwitchToListener(user) {
  return !(user?.role === "artist" && Number(user?.tracksCount) > 0);
}

function coverGradient(seed) {
  const palettes = [
    "linear-gradient(135deg, rgba(124,92,255,0.92), rgba(196,167,255,0.88))",
    "linear-gradient(135deg, rgba(155,109,255,0.9), rgba(89,209,255,0.78))",
    "linear-gradient(135deg, rgba(109,82,255,0.9), rgba(255,125,214,0.72))",
    "linear-gradient(135deg, rgba(198,167,255,0.9), rgba(92,74,226,0.82))",
  ];

  return palettes[Number(seed || 0) % palettes.length];
}

function showToast(message, isError = false) {
  if (!message) {
    return;
  }

  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  elements.toast.classList.toggle("is-error", isError);

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    elements.toast.classList.remove("is-error");
  }, 3200);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const initData = tg?.initData || "";

  if (initData) {
    headers.set("X-Telegram-Init-Data", initData);
  }

  let body = options.body;

  if (body && !(body instanceof FormData) && typeof body === "object") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Запрос завершился с ошибкой.");
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

  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  state.searchResults = state.searchQuery.trim()
    ? state.searchResults
    : { artists: [], tracks: [] };

  state.loading = false;
  render();
  mountInviteMarquee();

  // Auto-claim pending invite after bootstrap loaded
  if (state.pendingInviteCode && state.me?.isRegistered) {
    const code = state.pendingInviteCode;
    state.pendingInviteCode = null;
    try {
      const result = await api("/api/invite/claim", {
        method: "POST",
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
      });
      if (result.ok) {
        showToast("Invite активирован! Автор поднимется в стене инвайтеров.");
      }
    } catch (error) {
      console.warn("[invite] claim failed:", error.message);
    }
  }
}

async function runSearch(query, options = {}) {
  state.searchQuery = query;

  if (!query.trim()) {
    state.searchResults = {
      artists: [],
      tracks: [],
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

    if (options.rememberReturnView !== false && state.activeView !== "artist") {
      state.artistReturnView = state.activeView;
    }

    state.selectedArtist = profile;
    state.activeView = "artist";
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
    const response = await api("/api/support/messages");
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

function renderAvatar(entity, className = "avatar") {
  if (entity?.avatarUrl) {
    return `<span class="${className}"><img src="${entity.avatarUrl}" alt="${escapeHtml(entity.displayName || entity.nickname || "Avatar")}" /></span>`;
  }

  return `<span class="${className}">${escapeHtml(getAvatarInitials(entity?.displayName || entity?.nickname || entity?.username))}</span>`;
}

function renderRoleTag(role) {
  const safeRole = role === "artist" || role === "listener" ? role : "guest";
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
            <span class="muted">@${escapeHtml(artist.nickname || artist.username || "artist")}</span>
          </span>
        </span>
      </button>
      <div class="badge-row">
        ${renderRoleTag("artist")}
        <span class="pill">${formatFollowers(artist.tracksCount)} треков</span>
        <span class="pill">${formatFollowers(artist.followersCount)} подписчиков</span>
      </div>
      <p class="muted">${escapeHtml(artist.bio || "Пока без описания, но профиль уже открыт для подписок.")}</p>
      <div class="cta-row">
        <button class="btn-secondary" data-action="open-artist" data-artist-id="${artist.id}">
          Смотреть треки
        </button>
        <button
          class="btn-ghost"
          data-action="toggle-follow"
          data-artist-id="${artist.id}"
          ${artist.id === state.me?.id ? "disabled" : ""}
        >
          ${artist.id === state.me?.id ? "Это твой профиль" : artist.isFollowing ? "Подписка активна" : "Подписаться"}
        </button>
      </div>
    </article>
  `;
}

function renderComment(comment) {
  return `
    <div class="comment-item">
      <span class="comment-author">${escapeHtml(comment.user.displayName)}</span>
      <span class="comment-date muted">${formatDate(comment.createdAt)}</span>
      <p class="comment-text">${escapeHtml(comment.body)}</p>
    </div>
  `;
}

function renderTrackCard(track) {
  const canDeleteTrack = Boolean(state.me?.isAdmin || track.isOwnTrack);
  const deleteLabel =
    state.me?.isAdmin && !track.isOwnTrack
      ? "Удалить как админ"
      : "Удалить трек";
  const ratingOptions = Array.from({ length: 10 }, (_, index) => index + 1)
    .map(
      (score) =>
        `<option value="${score}" ${Number(track.userRating) === score ? "selected" : ""}>${score}</option>`,
    )
    .join("");

  return `
    <article class="track-card">
      <div class="track-head">
        <div>
          <p class="eyebrow">${formatDate(track.createdAt) || "Свежий релиз"}</p>
          <h4>${escapeHtml(track.title)}</h4>
          <span class="pill pill-genre">${escapeHtml(track.genre || "Demo tape")}</span>
        </div>
        <span class="rating-pill">${formatRating(track.averageRating)} / 10</span>
      </div>

      <div class="artist-row">
        <button class="artist-link artist-link-inline" data-action="open-artist" data-artist-id="${track.artist.id}">
          ${renderAvatar(track.artist, "avatar avatar-sm")}
          <span class="meta-col">
            <strong>${escapeHtml(track.artist.displayName)}</strong>
            <span class="muted">@${escapeHtml(track.artist.nickname || track.artist.username || "artist")}</span>
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
          ${track.isOwnTrack ? "disabled" : ""}
        >
          ${track.isOwnTrack ? "Это твой релиз" : track.isFollowingArtist ? "Подписан" : "Подписаться"}
        </button>
      </div>

      <div class="badge-row">
        ${renderRoleTag("artist")}
        <span class="pill">${track.ratingsCount} оценок</span>
        <span class="pill">${track.likesCount} лайков</span>
        <span class="pill">${track.commentsCount} комментариев</span>
        <span class="pill pill-repost">🔁 ${track.repostsCount || 0}</span>
      </div>

      <p class="track-description">${escapeHtml(track.description || "Автор ждёт честный фидбек по демке.")}</p>

      <audio controls src="${track.mp3Url}" data-track-id="${track.id}"></audio>

      <div class="stats-row">
        <span class="pill">${formatFollowers(track.playsCount)} прослушиваний</span>
        <button
          class="btn-ghost"
          data-action="toggle-like"
          data-track-id="${track.id}"
          ${track.isOwnTrack ? "disabled" : ""}
        >
          ${track.isLiked ? "Убрать лайк" : "Лайкнуть"}
        </button>
        <button
          class="btn-ghost btn-repost"
          data-action="repost-track"
          data-track-id="${track.id}"
          data-track-title="${escapeHtml(track.title)}"
          data-artist-name="${escapeHtml(track.artist.displayName)}"
          ${track.isOwnTrack ? "disabled" : ""}
        >
          ${track.isReposted ? "🔁 Репостнуто (+1)" : "🔁 Репост для голоса"}
        </button>
        <a class="btn-ghost" href="${track.wavUrl}" download>Скачать WAV</a>
        ${
          canDeleteTrack
            ? `
              <button class="btn-danger" data-action="delete-track" data-track-id="${track.id}">
                ${deleteLabel}
              </button>
            `
            : ""
        }
      </div>

      <form class="inline-form" data-form="rating" data-track-id="${track.id}">
        <div class="field">
          <label>Поставь оценку по 10-балльной шкале</label>
          <select name="score" ${track.isOwnTrack ? "disabled" : ""}>
            ${ratingOptions}
          </select>
        </div>
        <button class="btn-secondary" ${track.isOwnTrack ? "disabled" : ""}>
          ${track.userRating ? "Обновить оценку" : "Оценить трек"}
        </button>
      </form>

      <details class="comments-toggle">
        <summary>Комментарии (${track.commentsCount})</summary>
        <div class="comment-list">
          ${track.comments.length ? track.comments.map(renderComment).join("") : '<p class="muted" style="margin:8px 0 0">Пока без комментариев</p>'}
        </div>
      </details>

      <form class="inline-form" data-form="comment" data-track-id="${track.id}">
        <div class="field">
          <textarea name="body" placeholder="Оставь фидбек по треку..." maxlength="280"></textarea>
        </div>
        <button class="btn">Отправить</button>
      </form>
    </article>
  `;
}

function renderSupportBubble(message) {
  const author = message.senderType === "user" ? "Вы" : "Поддержка";

  return `
    <div class="support-bubble ${message.senderType}">
      <strong>${escapeHtml(author)}</strong>
      <p>${escapeHtml(message.body)}</p>
      <small class="muted">${escapeHtml(formatDateTime(message.createdAt))}</small>
    </div>
  `;
}

function renderSupportDrawer() {
  if (!elements.supportDrawer || !elements.supportBackdrop) {
    return;
  }

  const supportMessages = state.supportMessages.length
    ? state.supportMessages
    : [
        {
          id: "welcome",
          senderType: "support",
          body: "Поддержка на связи. Напиши сюда вопрос по ролям, загрузке WAV, Mini App, подпискам или модерации.",
          createdAt: "",
        },
      ];

  if (elements.supportToggle) {
    elements.supportToggle.setAttribute(
      "aria-label",
      state.supportChatOpen ? "Закрыть чат поддержки" : "Открыть чат поддержки",
    );
    elements.supportToggle.classList.toggle("is-open", state.supportChatOpen);
    elements.supportToggle.disabled = state.pending || state.supportLoading;
  }
  elements.supportBackdrop.classList.toggle(
    "is-visible",
    state.supportChatOpen,
  );
  elements.supportDrawer.classList.toggle("is-open", state.supportChatOpen);
  elements.supportDrawer.setAttribute(
    "aria-hidden",
    state.supportChatOpen ? "false" : "true",
  );
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
          : supportMessages.map(renderSupportBubble).join("")
      }
    </div>

    <form class="support-form" data-form="support">
      <div class="field">
        <label for="support-message-input">Сообщение в поддержку</label>
        <textarea id="support-message-input" name="body" maxlength="500" placeholder="Например: у меня не открывается Mini App или не загружается WAV.">${escapeHtml(state.supportDraft)}</textarea>
      </div>
      <button class="btn" ${state.supportLoading ? "disabled" : ""}>Отправить в поддержку</button>
    </form>
  `;
}

// =================== TRACK MODAL ===================
function findTrackInState(trackId) {
  const id = Number(trackId);
  const pools = [
    state.latestTracks,
    state.featuredTracks,
    state.me?.ownTracks || [],
    state.me?.likedTracks || [],
    state.searchResults?.tracks || [],
    state.selectedArtist?.tracks || [],
  ];
  for (const pool of pools) {
    const found = pool.find((t) => Number(t.id) === id);
    if (found) return found;
  }
  return null;
}

async function openTrackModal(trackId) {
  const track = findTrackInState(trackId);
  if (!track) {
    showToast("Трек не найден.", true);
    return;
  }
  state.activeTrack = track;
  renderTrackModal();
}

function closeTrackModal() {
  state.activeTrack = null;
  renderTrackModal();
}

function renderTrackModal() {
  if (!elements.trackModal || !elements.trackModalBackdrop) return;

  const track = state.activeTrack;
  const open = Boolean(track);

  elements.trackModalBackdrop.classList.toggle("is-visible", open);
  elements.trackModal.classList.toggle("is-open", open);
  elements.trackModal.setAttribute("aria-hidden", open ? "false" : "true");

  if (!open) {
    elements.trackModal.innerHTML = "";
    document.body.classList.remove("track-modal-locked");
    return;
  }

  document.body.classList.add("track-modal-locked");

  const myRating = Number(track.myRating || 0);
  const canRate = !track.isOwnTrack && state.me?.isRegistered;
  const canLike = !track.isOwnTrack && state.me?.isRegistered;
  const canComment = state.me?.isRegistered;
  const canDelete = Boolean(state.me?.isAdmin || track.isOwnTrack);

  const ratingButtons = Array.from({ length: 10 }, (_, i) => {
    const score = i + 1;
    const active = myRating === score;
    return `
      <button
        type="button"
        class="rate-btn ${active ? "is-active" : ""}"
        data-action="rate-track-modal"
        data-track-id="${track.id}"
        data-score="${score}"
        ${canRate ? "" : "disabled"}
      >${score}</button>
    `;
  }).join("");

  const comments = (track.comments || []).slice(0, 30);

  elements.trackModal.innerHTML = `
    <div class="track-modal-head">
      <div>
        <p class="eyebrow">Трек</p>
        <h3>${escapeHtml(track.title)}</h3>
        <span class="muted">@${escapeHtml(track.artist.nickname || track.artist.username || "artist")} · ${escapeHtml(track.genre || "Релиз")}</span>
      </div>
      <button class="support-close" type="button" data-action="track-modal-close" aria-label="Закрыть">✕</button>
    </div>

    <div class="track-modal-stats">
      <div class="modal-stat">
        <strong>${formatFollowers(track.playsCount)}</strong>
        <span class="muted">прослушиваний</span>
      </div>
      <div class="modal-stat">
        <strong>${formatRating(track.averageRating)} / 10</strong>
        <span class="muted">оценка</span>
      </div>
      <div class="modal-stat">
        <strong>${formatFollowers(track.likesCount)}</strong>
        <span class="muted">лайков</span>
      </div>
    </div>

    <audio
      class="track-modal-audio"
      controls
      controlsList="nodownload noplaybackrate noremoteplayback"
      disablepictureinpicture
      src="${track.mp3Url}"
      data-track-id="${track.id}"
    ></audio>

    <div class="track-modal-actions">
      <button
        class="btn ${track.isLiked ? "btn-secondary" : ""}"
        data-action="toggle-like"
        data-track-id="${track.id}"
        ${canLike ? "" : "disabled"}
      >
        ${track.isLiked ? "♥ Лайкнуто" : "♡ Лайк"}
      </button>
      ${
        canDelete
          ? `<button class="btn-danger" data-action="delete-track" data-track-id="${track.id}">Удалить</button>`
          : ""
      }
    </div>

    <div class="track-modal-section">
      <p class="eyebrow">Оценка трека</p>
      ${
        canRate
          ? `<p class="muted">Поставь оценку от 1 до 10. Можно поменять в любой момент.</p>`
          : `<p class="muted">${track.isOwnTrack ? "Свой трек оценивать нельзя." : "Зайди под своим аккаунтом, чтобы оценить."}</p>`
      }
      <div class="rate-row">
        ${ratingButtons}
      </div>
    </div>

    <div class="track-modal-section">
      <p class="eyebrow">Комментарии</p>
      ${
        canComment
          ? `
            <form class="comment-form" data-form="comment-modal" data-track-id="${track.id}">
              <textarea name="body" maxlength="500" placeholder="Что думаешь о треке?"></textarea>
              <button class="btn" type="submit">Отправить</button>
            </form>
          `
          : `<p class="muted">Зайди под своим аккаунтом, чтобы оставить комментарий.</p>`
      }
      <div class="comment-list">
        ${
          comments.length
            ? comments
                .map(
                  (c) => `
                    <div class="comment-item">
                      <strong>${escapeHtml(c.user?.nickname || c.user?.firstName || "Слушатель")}</strong>
                      <span>${escapeHtml(c.body)}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state"><span class="muted">Пока нет комментариев — будь первым.</span></div>`
        }
      </div>
    </div>
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
          ? `<div class="track-grid">${tracks.map(renderTrackCard).join("")}</div>`
          : `<div class="empty-state"><strong>${escapeHtml(emptyMessage)}</strong><span class="muted">Когда артисты начнут грузить демки, они появятся здесь.</span></div>`
      }
    </section>
  `;
}

function renderCompactTrackCard(track, options = {}) {
  const showArtist = Boolean(options.showArtist);
  const simple = Boolean(options.simple);
  const canLike = !track.isOwnTrack;
  const canDeleteTrack = Boolean(state.me?.isAdmin || track.isOwnTrack);

  if (simple) {
    return `
      <article class="compact-track-card compact-track-card--simple">
        <button class="compact-track-meta" type="button" data-action="open-track" data-track-id="${track.id}">
          <span class="meta-col">
            <strong>${escapeHtml(track.title)}</strong>
            ${
              showArtist
                ? `<span class="muted">@${escapeHtml(track.artist.nickname || track.artist.username || "artist")}</span>`
                : `<span class="muted">${escapeHtml(track.genre || "Релиз")}</span>`
            }
          </span>
          <span class="compact-track-open-hint" aria-hidden="true">Открыть →</span>
        </button>
        <audio
          controls
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablepictureinpicture
          preload="none"
          src="${track.mp3Url}"
          data-track-id="${track.id}"
        ></audio>
      </article>
    `;
  }

  return `
    <article class="compact-track-card">
      <div class="compact-track-main">
        <div class="compact-track-head">
          <div class="meta-col">
            <strong>${escapeHtml(track.title)}</strong>
            ${
              showArtist
                ? `<span class="muted">@${escapeHtml(track.artist.nickname || track.artist.username || "artist")}</span>`
                : `<span class="muted">${escapeHtml(track.genre || "Релиз")}</span>`
            }
          </div>
          <span class="pill">${formatFollowers(track.playsCount)} прослушиваний</span>
        </div>
        <div class="badge-row">
          <span class="pill">${formatRating(track.averageRating)} / 10</span>
          <span class="pill">${formatFollowers(track.likesCount)} лайков</span>
          <span class="pill">${formatFollowers(track.commentsCount)} комм.</span>
        </div>
        <audio
          controls
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablepictureinpicture
          src="${track.mp3Url}"
          data-track-id="${track.id}"
        ></audio>
        ${
          canLike || canDeleteTrack
            ? `
              <div class="compact-track-actions">
                ${
                  canLike
                    ? `
                      <button class="btn-ghost" data-action="toggle-like" data-track-id="${track.id}">
                        ${track.isLiked ? "Убрать лайк" : "Лайк"}
                      </button>
                    `
                    : ""
                }
                ${
                  canDeleteTrack
                    ? `
                      <button class="btn-ghost" data-action="delete-track" data-track-id="${track.id}">
                        Удалить
                      </button>
                    `
                    : ""
                }
              </div>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderCompactTracksSection(title, tracks, emptyMessage, options = {}) {
  return `
    <section class="panel compact-section">
      <div class="section-head compact-section-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      ${
        tracks.length
          ? `<div class="compact-track-list">${tracks.map((track) => renderCompactTrackCard(track, options)).join("")}</div>`
          : `<div class="empty-state"><strong>${escapeHtml(emptyMessage)}</strong></div>`
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
          ? `<div class="artist-grid">${artists.map(renderArtistCard).join("")}</div>`
          : `<div class="empty-state"><strong>Пока нет артистов</strong><span class="muted">Регистрация артистов появится здесь автоматически.</span></div>`
      }
    </section>
  `;
}

function renderTopArtistCard(artist, index) {
  const audioBlock = artist.topTrackMp3Url
    ? `<audio class="artist-top-audio" src="${artist.topTrackMp3Url}" preload="none"></audio>
       <button class="play-overlay" type="button" data-action="toggle-artist-top-track" data-artist-id="${artist.id}" aria-label="Слушать топ-трек">▶</button>`
    : "";

  return `
    <article class="top-artist-card top-artist-card--stacked" data-action="open-artist" data-artist-id="${artist.id}" role="button" tabindex="0">
      <div class="top-artist-cover">
        <span class="top-rank">#${index + 1}</span>
        <div class="artist-avatar-play artist-avatar-play--cover">
          ${renderAvatar(artist, "avatar avatar-cover")}
          ${audioBlock}
        </div>
      </div>
      <div class="top-artist-body">
        <div class="meta-col">
          <strong>${escapeHtml(artist.displayName)}</strong>
          <span class="muted">@${escapeHtml(artist.nickname || artist.username || "artist")}</span>
        </div>
        <div class="top-artist-plays">
          <span class="top-artist-plays-num">${formatFollowers(artist.monthlyPlaysCount)}</span>
          <span class="top-artist-plays-label">прослушиваний за месяц</span>
        </div>
      </div>
    </article>
  `;
}

function renderTopArtistsSection(artists) {
  return `
    <section class="panel top-artists-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Top artists by month</p>
          <h3>Топ артистов месяца</h3>
        </div>
      </div>
      ${
        artists.length
          ? `<div class="top-artist-rail">${artists.map(renderTopArtistCard).join("")}</div>`
          : '<div class="empty-state"><strong>Пока нет артистов</strong><span class="muted">Когда появятся артисты, топ-5 будет здесь.</span></div>'
      }
    </section>
  `;
}

function renderArtistListCard(artist, index) {
  return `
    <article class="artist-list-card">
      <button class="artist-link artist-link-inline" data-action="open-artist" data-artist-id="${artist.id}">
        <span class="list-rank">${index + 6}</span>
        ${renderAvatar(artist, "avatar avatar-sm")}
        <span class="meta-col">
          <strong>${escapeHtml(artist.displayName)}</strong>
          <span class="muted">@${escapeHtml(artist.nickname || artist.username || "artist")}</span>
        </span>
      </button>
      <div class="spacer"></div>
      <span class="pill">${formatFollowers(artist.monthlyPlaysCount)} / мес</span>
      <button class="btn-ghost" data-action="open-artist" data-artist-id="${artist.id}">Открыть</button>
    </article>
  `;
}

function renderArtistRowsSection(artists) {
  if (!artists.length) {
    return "";
  }

  return `
    <section class="panel compact-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Popular artists</p>
          <h3>Популярные артисты</h3>
        </div>
      </div>
      <div class="artist-list">${artists.map(renderArtistListCard).join("")}</div>
    </section>
  `;
}

function renderRoleOptions(name, selectedRole, options = {}) {
  const listenerDisabled = Boolean(options.listenerDisabled);

  return `
    <div class="role-grid">
      <label class="role-option">
        <input type="radio" name="${escapeHtml(name)}" value="artist" ${selectedRole === "artist" ? "checked" : ""} />
        <span class="role-card">
          <small>Artist mode</small>
          <strong>Артист</strong>
          <span>Загружай WAV, собирай оценки и строй аудиторию. Роль закрепится после регистрации.</span>
        </span>
      </label>
      <label class="role-option ${listenerDisabled ? "is-disabled" : ""}">
        <input
          type="radio"
          name="${escapeHtml(name)}"
          value="listener"
          ${selectedRole === "listener" ? "checked" : ""}
          ${listenerDisabled ? "disabled" : ""}
        />
        <span class="role-card">
          <small>Listener mode</small>
          <strong>Слушатель</strong>
          <span>Оценивай демки, лайкай треки и подписывайся на артистов. Загрузка треков будет недоступна.</span>
        </span>
      </label>
    </div>
  `;
}

function renderRoleChoiceWarning() {
  return `
    <div class="role-warning">
      <strong>Важное предупреждение</strong>
      <span>
        Уважаемый посетитель нашей платформы, если вы выберете роль «Слушатель»,
        потом вы не сможете переключиться на роль «Артист». Делайте выбор внимательно и с умом.
        Приятного прослушивания!
      </span>
    </div>
  `;
}

function renderRoleLockedNotice(user) {
  return `
    <div class="role-lock-card">
      <div>
        <p class="eyebrow">Role locked</p>
        <strong>Роль выбрана: ${escapeHtml(getRoleLabel(user.role))}</strong>
      </div>
      <span class="muted">
        Роль фиксируется после регистрации. Если выбран слушатель, загрузка демок и треков остаётся закрытой.
      </span>
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

const NEWS_ITEMS = [
  {
    icon: "🎉",
    title: "Стена инвайтеров",
    body: "Пригласи друзей — твой аватар появится в бегущей ленте слева.",
  },
  {
    icon: "🔁",
    title: "Голосование репостом",
    body: "Поделись треком в Telegram — добавится +1 к голосу артиста.",
  },
  {
    icon: "📊",
    title: "Итог недели в канале",
    body: "Каждое воскресенье 18:00 UTC — топ-3 треков и выбор редакции.",
  },
];

function renderNewsSection() {
  return `
    <section class="panel news-panel">
      <div class="section-head section-head--compact">
        <div>
          <p class="eyebrow">What's new</p>
          <h3>Что нового</h3>
        </div>
      </div>
      <div class="news-rail">
        ${NEWS_ITEMS.map(
          (item) => `
            <article class="news-card">
              <span class="news-icon">${item.icon}</span>
              <div class="news-text">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="muted">${escapeHtml(item.body)}</span>
              </div>
            </article>
          `,
        ).join("")}
      </div>
    </section>
  `;
}

function renderHomeView() {
  const topArtists = state.topArtists.slice(0, 5);
  const popularArtists = state.topArtists.slice(5);
  const latestSection = state.latestTracks.length
    ? renderCompactTracksSection(
        "Недавние релизы",
        state.latestTracks,
        "Пока нет свежих треков",
        { showArtist: true, simple: true },
      )
    : "";

  return `
    ${renderNewsSection()}
    ${renderTopArtistsSection(topArtists)}
    ${latestSection}
    ${renderArtistRowsSection(popularArtists)}
  `;
}

function renderSearchView() {
  const hasQuery = Boolean(state.searchQuery.trim());

  return `
    <section class="panel search-minimal">
      <div class="field">
        <input
          id="search-input"
          name="search"
          type="search"
          placeholder="Поиск артиста"
          value="${escapeHtml(state.searchQuery)}"
        />
      </div>
    </section>
    ${
      !hasQuery
        ? ""
        : state.searchResults.artists.length
          ? `
            <section class="panel compact-section">
              <div class="artist-list search-result-list">${state.searchResults.artists.map(renderArtistListCard).join("")}</div>
            </section>
          `
          : `
            <section class="panel compact-section">
              <div class="empty-state"><strong>Ничего не найдено</strong></div>
            </section>
          `
    }
  `;
}

function renderUploadView() {
  if (!isArtist(state.me)) {
    const description = isListener(state.me)
      ? "Сейчас твой профиль в режиме слушателя. Загрузка релизов доступна только артистам."
      : "Сначала зайди в кабинет и выбери роль. Загрузка треков открывается только для артистов.";

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
          ? ""
          : `<div class="status-banner">Сейчас на сервере не найден ffmpeg. Форма готова, но конвертация WAV в MP3 не сработает, пока ffmpeg не будет установлен.</div>`
      }

      <form class="form-grid" data-form="upload">
        <div class="field">
          <label>Название трека</label>
          <input name="title" placeholder="Например: Night Demo 01" maxlength="80" required />
        </div>

        <div class="upload-zone">
          <strong>Выбери аудиофайл</strong>
          <span class="muted">WAV или MP3 — сервер сам подготовит версию для прослушивания.</span>
          <input name="track" type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" required />
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

  const playsCount = Number(artist.playsCount || 0);
  const tracksArr = profile.tracks || [];
  const tracksCount = tracksArr.length;
  const tracksLabel = pluralizeRu(tracksCount, "трек", "трека", "треков");

  return `
    <section class="panel artist-profile-panel">
      <div class="artist-row">
        ${renderAvatar(artist, "avatar avatar-lg")}
        <div class="profile-head">
          <h2>${escapeHtml(artist.displayName)}</h2>
          <p class="muted">@${escapeHtml(artist.nickname || artist.username || "artist")}</p>
        </div>
      </div>

      ${artist.bio ? `<p class="track-description">${escapeHtml(artist.bio)}</p>` : ""}

      <div class="profile-stats artist-profile-stats--duo">
        <div class="stat-tile">
          <strong>${formatFollowers(playsCount)}</strong>
          <span class="muted">${pluralizeRu(playsCount, "прослушивание", "прослушивания", "прослушиваний")}</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(artist.followersCount)}</strong>
          <span class="muted">подписчиков</span>
        </div>
      </div>

      ${
        artist.id === state.me?.id
          ? ""
          : `
            <div class="cta-row artist-profile-actions">
              <button class="btn" data-action="toggle-follow" data-artist-id="${artist.id}">
                ${artist.isFollowing ? "Вы подписаны" : "Подписаться"}
              </button>
            </div>
          `
      }
    </section>

    ${renderCompactTracksSection(
      `${tracksCount} ${tracksLabel}`,
      tracksArr,
      "У этого артиста пока нет опубликованных релизов",
      { showArtist: false, simple: true }
    )}
  `;
}

function renderRegisterForm(selectedRole = "artist") {
  return `
    <form class="form-grid" data-form="register">
      <div class="field">
        <label>Выбери роль</label>
        ${renderRoleOptions("role", selectedRole)}
        ${renderRoleChoiceWarning()}
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
        ${state.showRegisterForm ? renderRegisterForm("artist") : ""}
      </section>
    `;
  }

  return `
    <section class="panel profile-summary-panel">
      <div class="artist-row">
        ${renderAvatar(state.me, "avatar avatar-lg")}
        <div class="profile-head">
          <h2>${escapeHtml(state.me.displayName)}</h2>
          <p class="muted">@${escapeHtml(state.me.nickname || state.me.username || "profile")}</p>
        </div>
        <div class="spacer"></div>
        <button class="btn-ghost" data-action="logout">Выйти</button>
      </div>

      ${state.me.bio ? `<p class="track-description">${escapeHtml(state.me.bio)}</p>` : ""}

      <div class="profile-stats clean-profile-stats">
        <div class="stat-tile">
          <strong>${formatFollowers(state.me.followersCount)}</strong>
          <span class="muted">подписчиков</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(state.me.tracksCount)}</strong>
          <span class="muted">релизов</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(state.me.followingCount)}</strong>
          <span class="muted">подписок</span>
        </div>
        <div class="stat-tile">
          <strong>${formatFollowers(state.me.likedTracksCount)}</strong>
          <span class="muted">лайкнутых треков</span>
        </div>
      </div>
    </section>

    ${renderInvitePanel()}

    ${state.me.isAdmin ? renderAdminPanel() : ""}

    ${
      isArtist(state.me)
        ? renderCompactTracksSection(
            "Релизы",
            state.me.ownTracks,
            "Ты ещё не загрузил ни одного релиза",
            { showArtist: false },
          )
        : ""
    }

    ${renderCompactTracksSection("Лайкнутые треки", state.me.likedTracks, "Ты пока не лайкнул ни одного трека", { showArtist: true })}
  `;
}

function buildInviteLink() {
  const code = state.inviteCode;
  if (!code) return "";
  if (state.botUsername) {
    return `https://t.me/${state.botUsername}/app?startapp=${code}`;
  }
  return `${window.location.origin}/?invite=${code}`;
}

function renderInvitePanel() {
  if (!state.me?.isRegistered || !state.inviteCode) return "";
  const link = buildInviteLink();
  return `
    <section class="panel invite-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Wall of inviters</p>
          <h3>Приглашай — попади на стену признания</h3>
        </div>
      </div>
      <p class="muted">За каждого друга по твоей ссылке твой аватар появляется в бегущей ленте слева — её видит каждый, кто открыл Demo Stage. Чем больше инвайтов, тем выше ты в ленте.</p>
      <div class="invite-link-box">
        <code class="invite-link">${escapeHtml(link)}</code>
        <button class="btn-secondary" data-action="copy-invite" data-invite-link="${escapeHtml(link)}">Скопировать</button>
        <button class="btn" data-action="share-invite" data-invite-link="${escapeHtml(link)}">Поделиться</button>
      </div>
      <div class="badge-row">
        <span class="pill">Твой код: ${escapeHtml(state.inviteCode)}</span>
      </div>
    </section>
  `;
}

// =================== INVITE MARQUEE ===================
let _lastMarqueeKey = "";
function mountInviteMarquee() {
  const inviters = Array.isArray(state.topInviters) ? state.topInviters : [];
  let host = document.getElementById("invite-marquee-host");

  // ничего нет — снимаем
  if (!inviters.length) {
    if (host) host.remove();
    _lastMarqueeKey = "";
    document.body.classList.remove("has-invite-marquee");
    return;
  }

  // ключ для memo: id+count, чтобы при тех же данных не пересоздавать
  const key = inviters.map((i) => `${i.id}:${i.inviteCount}`).join("|");
  if (host && key === _lastMarqueeKey) return;
  _lastMarqueeKey = key;

  // дублируем список 2 раза для бесшовного цикла
  const items = [...inviters, ...inviters].map(renderInviterChip).join("");

  // длительность анимации зависит от количества (чтобы скорость была одинаковой)
  const duration = Math.max(20, inviters.length * 4);

  if (!host) {
    host = document.createElement("aside");
    host.id = "invite-marquee-host";
    host.className = "invite-marquee";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
    document.body.classList.add("has-invite-marquee");
  }

  host.innerHTML = `
    <div class="invite-marquee-track" style="--marquee-duration:${duration}s">
      ${items}
    </div>
  `;
}

function renderInviterChip(inv) {
  const initial = (inv.displayName || inv.nickname || "?")
    .trim()
    .charAt(0)
    .toUpperCase();
  const safeName = escapeHtml(inv.displayName || inv.nickname || "Demo Artist");
  const avatarInner = inv.avatarUrl
    ? `<img src="${escapeHtml(inv.avatarUrl)}" alt="${safeName}" loading="lazy">`
    : `<span class="invite-marquee-initial">${escapeHtml(initial)}</span>`;
  return `
    <div class="invite-marquee-item" title="${safeName} · +${inv.inviteCount}">
      <div class="invite-marquee-avatar">
        ${avatarInner}
        <span class="invite-marquee-badge">+${inv.inviteCount}</span>
      </div>
      <span class="invite-marquee-name">${safeName}</span>
    </div>
  `;
}

function renderAdminPanel() {
  return `
    <section class="panel admin-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Admin tools</p>
          <h3>Еженедельный итог</h3>
        </div>
      </div>
      <p class="muted">Публикация топ-3 треков, общих прослушиваний и выбора редакции в канал (CHANNEL_ID из .env). Автоматически пушится каждое воскресенье 18:00 UTC, можно вручную.</p>
      <div class="cta-row">
        <button class="btn" data-action="post-weekly-summary">Отправить итог недели сейчас</button>
      </div>
    </section>
  `;
}

function renderLikedView() {
  if (!state.me?.isRegistered) {
    return `
      <section class="panel auth-card stack">
        <div>
          <p class="eyebrow">Favourites</p>
          <h3>Избранные треки</h3>
          <p class="muted">Войди в аккаунт, чтобы видеть лайкнутые треки.</p>
        </div>
        <div class="cta-row">
          <button class="btn" data-action="login">Войти</button>
        </div>
      </section>
    `;
  }

  const liked = state.me.likedTracks || [];
  return `
    <section class="panel liked-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Favourites</p>
          <h3>Избранные треки</h3>
        </div>
        <span class="pill">${liked.length}</span>
      </div>
      ${
        liked.length
          ? `<div class="compact-track-list">${liked.map((t) => renderCompactTrackCard(t, { showArtist: true, simple: true })).join("")}</div>`
          : `<div class="empty-state"><strong>Пока пусто</strong><span class="muted">Лайкни трек — он появится здесь.</span></div>`
      }
    </section>
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

function renderNavAvatar() {
  const btn = document.querySelector("#nav-profile-btn");
  if (!btn) return;
  const me = state.me;
  if (me?.avatarUrl) {
    btn.innerHTML = `<span class="nav-avatar"><img src="${escapeHtml(me.avatarUrl)}" alt="" /></span>`;
  } else if (me?.displayName) {
    btn.innerHTML = `<span class="nav-avatar nav-avatar--initials">${escapeHtml(getAvatarInitials(me.displayName))}</span>`;
  } else {
    btn.innerHTML = `<span class="nav-icon nav-profile" aria-hidden="true"></span>`;
  }
}

function renderTopbar() {
  elements.topbarMeta.innerHTML = "";

  const titleEl = document.querySelector("#topbar-title");
  if (!titleEl) return;

  let title = "";
  switch (state.activeView) {
    case "home":    title = "Главная"; break;
    case "search":  title = "Поиск"; break;
    case "upload":  title = "Загрузка"; break;
    case "liked":   title = "Избранное"; break;
    case "profile": title = "Личный кабинет"; break;
    case "artist": {
      const a = state.selectedArtist?.artist;
      title = a
        ? `Профиль ${escapeHtml(a.nickname || a.username || "артиста")}`
        : "Профиль артиста";
      break;
    }
    default: title = "";
  }
  titleEl.textContent = title;
}

function render() {
  renderTopbar();
  renderNavAvatar();

  if (isListener(state.me) && state.activeView === "upload") {
    state.activeView = "profile";
  }

  elements.navButtons.forEach((button) => {
    const isSupportButton = button.dataset.action === "support-toggle";

    button.hidden = button.dataset.view === "upload" && isListener(state.me);
    button.classList.toggle(
      "is-active",
      isSupportButton
        ? state.supportChatOpen
        : button.dataset.view === state.activeView,
    );
    button.disabled = state.pending;
  });

  if (elements.navButtons[0]?.parentElement) {
    const bottomNav = elements.navButtons[0].parentElement;
    const uploadButton = elements.navButtons.find((button) =>
      button.classList.contains("nav-upload-fab"),
    );
    const hasUploadFab = Boolean(uploadButton && !uploadButton.hidden);

    bottomNav.classList.toggle("has-upload-fab", hasUploadFab);
  }

  if (state.loading) {
    renderSupportDrawer();
    elements.app.innerHTML = renderLoadingView();
    return;
  }

  switch (state.activeView) {
    case "search":
      elements.app.innerHTML = renderSearchView();
      break;
    case "upload":
      elements.app.innerHTML = renderUploadView();
      break;
    case "liked":
      elements.app.innerHTML = renderLikedView();
      break;
    case "profile":
      elements.app.innerHTML = renderProfileView();
      break;
    case "artist":
      elements.app.innerHTML = renderArtistProfileView();
      break;
    case "home":
    default:
      elements.app.innerHTML = renderHomeView();
      break;
  }

  renderSupportDrawer();
}

async function refreshAfterMutation(message) {
  const currentArtistId =
    state.activeView === "artist" ? state.selectedArtist?.artist?.id : null;
  await loadBootstrap({ silent: true });

  if (state.activeView === "search" && state.searchQuery.trim()) {
    await runSearch(state.searchQuery, { silent: true });
  }

  if (currentArtistId) {
    await openArtistProfile(currentArtistId, {
      silent: true,
      rememberReturnView: false,
    });
  }

  if (message) {
    showToast(message);
  }
}

document.addEventListener("click", async (event) => {
  const navButton = event.target.closest("[data-view]");

  if (navButton && navButton.classList.contains("nav-btn")) {
    state.activeView = navButton.dataset.view;
    render();
    return;
  }

  if (event.target.closest("#support-toggle")) {
    if (state.supportChatOpen) {
      closeSupportChat();
    } else {
      await openSupportChat();
    }
    return;
  }

  if (event.target.closest("#support-backdrop")) {
    closeSupportChat();
    return;
  }

  if (event.target.closest("#track-modal-backdrop")) {
    closeTrackModal();
    return;
  }

  const actionTarget = event.target.closest("[data-action]");

  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;

  if (action === "jump-view") {
    state.activeView = actionTarget.dataset.view;
    render();
    return;
  }

  if (action === "show-register") {
    state.showRegisterForm = true;
    render();
    return;
  }

  if (action === "open-artist") {
    await openArtistProfile(actionTarget.dataset.artistId);
    return;
  }

  if (action === "back-artist") {
    state.activeView = state.artistReturnView || "home";
    render();
    return;
  }

  if (action === "open-track") {
    await openTrackModal(actionTarget.dataset.trackId);
    return;
  }

  if (action === "track-modal-close") {
    closeTrackModal();
    return;
  }

  if (action === "hide-register") {
    state.showRegisterForm = false;
    render();
    return;
  }

  if (action === "support-close") {
    closeSupportChat();
    return;
  }

  if (action === "support-toggle") {
    if (state.supportChatOpen) {
      closeSupportChat();
    } else {
      await openSupportChat();
    }
    return;
  }

  if (action === "support-prompt") {
    state.supportDraft = actionTarget.dataset.message || "";
    renderSupportDrawer();
    const textarea = document.querySelector("#support-message-input");
    textarea?.focus();
    textarea?.setSelectionRange?.(textarea.value.length, textarea.value.length);
    return;
  }

  if (action === "login") {
    await withPending(async () => {
      const response = await api("/api/session/login", { method: "POST" });
      showToast(response.message);
    });
    return;
  }

  if (action === "toggle-like") {
    const trackId = actionTarget.dataset.trackId;
    const modalTrackId = state.activeTrack ? Number(state.activeTrack.id) : null;
    await withPending(async () => {
      await api(`/api/tracks/${trackId}/like`, { method: "POST" });
      await refreshAfterMutation("Лайк обновлён.");
      if (modalTrackId === Number(trackId)) {
        state.activeTrack = findTrackInState(trackId) || state.activeTrack;
        renderTrackModal();
      }
    });
    return;
  }

  if (action === "toggle-follow") {
    const artistId = actionTarget.dataset.artistId;
    await withPending(async () => {
      await api(`/api/artists/${artistId}/follow`, { method: "POST" });
      await refreshAfterMutation("Подписка обновлена.");
    });
    return;
  }

  if (action === "toggle-artist-top-track") {
    event.stopPropagation();
    const wrapper = actionTarget.closest(".artist-avatar-play");
    const audio = wrapper?.querySelector(".artist-top-audio");
    if (!audio) return;
    if (audio.paused) {
      // Pause all other artist top audios
      document.querySelectorAll(".artist-top-audio").forEach((a) => {
        if (a !== audio) {
          a.pause();
          a.closest(".artist-avatar-play")?.classList.remove("is-playing");
          const btn = a
            .closest(".artist-avatar-play")
            ?.querySelector(".play-overlay");
          if (btn) btn.textContent = "▶";
        }
      });
      audio.play();
      wrapper.classList.add("is-playing");
      actionTarget.textContent = "⏸";
    } else {
      audio.pause();
      wrapper.classList.remove("is-playing");
      actionTarget.textContent = "▶";
    }
    return;
  }

  if (action === "delete-track") {
    const trackId = actionTarget.dataset.trackId;
    const confirmed = window.confirm(
      "Удалить этот трек? Лайки, оценки и комментарии к нему тоже будут удалены.",
    );

    if (!confirmed) {
      return;
    }

    await withPending(async () => {
      await api(`/api/tracks/${trackId}`, { method: "DELETE" });
      if (state.activeTrack && Number(state.activeTrack.id) === Number(trackId)) {
        closeTrackModal();
      }
      await refreshAfterMutation("Трек удалён.");
    });
    return;
  }

  if (action === "rate-track-modal") {
    const trackId = actionTarget.dataset.trackId;
    const score = Number(actionTarget.dataset.score);
    await withPending(async () => {
      await api(`/api/tracks/${trackId}/rate`, {
        method: "POST",
        body: { score },
      });
      await refreshAfterMutation("Оценка сохранена.");
      state.activeTrack = findTrackInState(trackId) || state.activeTrack;
      renderTrackModal();
    });
    return;
  }

  if (action === "repost-track") {
    const trackId = actionTarget.dataset.trackId;
    const trackTitle = actionTarget.dataset.trackTitle || "трек";
    const artistName = actionTarget.dataset.artistName || "";
    await withPending(async () => {
      const result = await api(`/api/tracks/${trackId}/repost`, {
        method: "POST",
      });
      const botUsername = state.botUsername || "";
      const shareUrl = botUsername
        ? `https://t.me/${botUsername}/app?startapp=track_${trackId}`
        : `${window.location.origin}/?track=${trackId}`;
      const shareText = `🎧 «${trackTitle}» — ${artistName}. Слушай на Demo Stage!`;
      const tgShareLink = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(tgShareLink);
      } else {
        window.open(tgShareLink, "_blank");
      }
      await refreshAfterMutation(
        result?.alreadyReposted
          ? "Уже репостнуто."
          : "Репост засчитан: +1 голос артисту.",
      );
    });
    return;
  }

  if (action === "copy-invite") {
    const link = actionTarget.dataset.inviteLink || buildInviteLink();
    try {
      await navigator.clipboard.writeText(link);
      showToast("Ссылка скопирована.");
    } catch (_e) {
      window.prompt("Скопируй ссылку:", link);
    }
    return;
  }

  if (action === "share-invite") {
    const link = actionTarget.dataset.inviteLink || buildInviteLink();
    const shareText = "Залетай в Demo Stage — мини-апп для демок и треков.";
    const tgShareLink = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(tgShareLink);
    } else {
      window.open(tgShareLink, "_blank");
    }
    return;
  }

  if (action === "post-weekly-summary") {
    const confirmed = window.confirm("Отправить итог недели в канал сейчас?");
    if (!confirmed) return;
    await withPending(async () => {
      const result = await api("/api/admin/weekly-summary", { method: "POST" });
      if (result?.posted?.ok === false) {
        showToast("Ошибка отправки: " + (result.posted.error || "неизвестно"));
      } else {
        showToast("Итог недели отправлен в канал.");
      }
    });
    return;
  }

  if (action === "logout") {
    await withPending(async () => {
      const response = await api("/api/session/logout", { method: "POST" });
      showToast(response.message);

      if (response.closeMiniApp && tg?.close) {
        setTimeout(() => tg.close(), 250);
        return;
      }

      window.location.reload();
    });
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;

  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formType = form.dataset.form;

  if (!formType) {
    return;
  }

  event.preventDefault();

  if (formType === "register") {
    await withPending(async () => {
      const data = new FormData(form);
      const role = String(data.get("role") || "artist");
      await api("/api/register", {
        method: "POST",
        body: data,
      });
      state.showRegisterForm = false;
      state.activeView = "profile";
      await refreshAfterMutation(
        role === "artist"
          ? "Артист-профиль создан."
          : "Профиль слушателя создан.",
      );
    });
    return;
  }

  if (formType === "profile") {
    await withPending(async () => {
      const data = new FormData(form);
      await api("/api/profile", {
        method: "POST",
        body: data,
      });
      await refreshAfterMutation("Профиль обновлён.");
    });
    return;
  }

  if (formType === "upload") {
    await withPending(async () => {
      const data = new FormData(form);
      await api("/api/tracks", {
        method: "POST",
        body: data,
      });
      form.reset();
      state.activeView = "profile";
      await refreshAfterMutation("Трек опубликован.");
    });
    return;
  }

  if (formType === "support") {
    const body = trimSupportMessage(new FormData(form).get("body"));

    if (!body) {
      showToast("Напиши вопрос для поддержки.", true);
      return;
    }

    state.supportLoading = true;
    render();

    try {
      const response = await api("/api/support/messages", {
        method: "POST",
        body: { body },
      });
      state.supportMessages = response.messages || [];
      state.supportLoaded = true;
      state.supportDraft = "";
      showToast("Сообщение отправлено в поддержку.");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      state.supportLoading = false;
      render();
    }
    return;
  }

  if (formType === "rating") {
    const trackId = form.dataset.trackId;
    const score = Number(new FormData(form).get("score"));

    await withPending(async () => {
      await api(`/api/tracks/${trackId}/rate`, {
        method: "POST",
        body: { score },
      });
      await refreshAfterMutation("Оценка сохранена.");
    });
    return;
  }

  if (formType === "comment") {
    const trackId = form.dataset.trackId;
    const body = trimComment(new FormData(form).get("body"));

    if (!body) {
      showToast("Напиши комментарий чуть подробнее.", true);
      return;
    }

    await withPending(async () => {
      await api(`/api/tracks/${trackId}/comments`, {
        method: "POST",
        body: { body },
      });
      form.reset();
      await refreshAfterMutation("Комментарий добавлен.");
    });
    return;
  }

  if (formType === "comment-modal") {
    const trackId = form.dataset.trackId;
    const body = trimComment(new FormData(form).get("body"));

    if (!body) {
      showToast("Напиши комментарий чуть подробнее.", true);
      return;
    }

    await withPending(async () => {
      await api(`/api/tracks/${trackId}/comments`, {
        method: "POST",
        body: { body },
      });
      form.reset();
      await refreshAfterMutation("Комментарий добавлен.");
      state.activeTrack = findTrackInState(trackId) || state.activeTrack;
      renderTrackModal();
    });
    return;
  }
});

function trimComment(value) {
  return String(value || "")
    .trim()
    .slice(0, 280);
}

function trimSupportMessage(value) {
  return String(value || "")
    .trim()
    .slice(0, 500);
}

document.addEventListener("input", (event) => {
  const target = event.target;

  if (target instanceof HTMLInputElement && target.id === "search-input") {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void runSearch(target.value);
    }, 260);
  }

  if (
    target instanceof HTMLTextAreaElement &&
    target.id === "support-message-input"
  ) {
    state.supportDraft = target.value.slice(0, 500);
  }
});

document.addEventListener(
  "play",
  (event) => {
    const target = event.target;

    if (!(target instanceof HTMLAudioElement)) {
      return;
    }

    const trackId = Number(target.dataset.trackId);

    if (!trackId) {
      return;
    }

    const previousPlayAt = recentTrackPlays.get(trackId) || 0;
    const now = Date.now();

    if (now - previousPlayAt < 30_000) {
      return;
    }

    recentTrackPlays.set(trackId, now);
    void api(`/api/tracks/${trackId}/play`, { method: "POST" }).catch(() => {});
  },
  true,
);

loadBootstrap().catch((error) => {
  state.loading = false;
  render();
  showToast(error.message, true);
});
