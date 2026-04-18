import { escapeHtml, formatDate, formatDateTime, formatFollowers, pluralizeRu } from './ui-utils.js';

export function renderAvatar(entity, className = "avatar") {
  if (entity?.avatarUrl) {
    return `<span class="${className}"><img src="${entity.avatarUrl}" alt="${escapeHtml(entity.displayName || entity.nickname || "Avatar")}" /></span>`;
  }
  const initials = String(entity?.displayName || entity?.nickname || entity?.username || "DS").trim().slice(0, 2).toUpperCase();
  return `<span class="${className}">${escapeHtml(initials)}</span>`;
}

export function renderRoleTag(role) {
  const safeRole = role === "artist" || role === "listener" ? role : "guest";
  const label = role === "artist" ? "Артист" : role === "listener" ? "Слушатель" : "Гость";
  return `<span class="role-tag ${safeRole}">${escapeHtml(label)}</span>`;
}

export function renderTrackCard(track, state) {
  const canDeleteTrack = Boolean(state.me?.isAdmin || track.isOwnTrack);
  const deleteLabel = state.me?.isAdmin && !track.isOwnTrack ? "Удалить как админ" : "Удалить трек";
  const ratingOptions = Array.from({ length: 10 }, (_, index) => index + 1)
    .map(score => `<option value="${score}" ${Number(track.userRating) === score ? "selected" : ""}>${score}</option>`)
    .join("");

  const miniCoverHtml = track.coverUrl ? `<div class="mini-square-cover"><img src="${track.coverUrl}" alt="" /></div>` : "";

  return `
    <article class="track-card">
      <div class="track-head">
        ${miniCoverHtml}
        <div style="flex:1; min-width:0;">
          <p class="eyebrow">${formatDate(track.createdAt) || "Свежий релиз"}</p>
          <h4 style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin:0;">${escapeHtml(track.title)}</h4>
          <span class="pill pill-genre">${escapeHtml(track.genre || "Demo tape")}</span>
        </div>
        <span class="rating-pill">${Number(track.averageRating || 0).toFixed(1)} / 10</span>
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
        <button class="btn-ghost" data-action="open-artist" data-artist-id="${track.artist.id}">Треки артиста</button>
        <button class="btn-ghost" data-action="toggle-follow" data-artist-id="${track.artist.id}" ${track.isOwnTrack ? "disabled" : ""}>
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
        <button class="btn-ghost" data-action="toggle-like" data-track-id="${track.id}" ${track.isOwnTrack ? "disabled" : ""}>
          ${track.isLiked ? "Убрать лайк" : "Лайкнуть"}
        </button>
        <button class="btn-ghost btn-repost" data-action="repost-track" data-track-id="${track.id}" data-track-title="${escapeHtml(track.title)}" data-artist-name="${escapeHtml(track.artist.displayName)}" ${track.isOwnTrack ? "disabled" : ""}>
          ${track.isReposted ? "🔁 Репостнуто (+1)" : "🔁 Репост для голоса"}
        </button>
        <a class="btn-ghost" href="${track.wavUrl}" download>Скачать WAV</a>
        ${canDeleteTrack ? `<button class="btn-danger" data-action="delete-track" data-track-id="${track.id}">${deleteLabel}</button>` : ""}
      </div>

      <form class="inline-form" data-form="rating" data-track-id="${track.id}">
        <div class="field">
          <label>Поставь оценку по 10-балльной шкале</label>
          <select name="score" ${track.isOwnTrack ? "disabled" : ""}>${ratingOptions}</select>
        </div>
        <button class="btn-secondary" ${track.isOwnTrack ? "disabled" : ""}>${track.userRating ? "Обновить оценку" : "Оценить трек"}</button>
      </form>

      <details class="comments-toggle">
        <summary>Комментарии (${track.commentsCount})</summary>
        <div class="comment-list">
          ${(track.comments || []).length ? track.comments.map(c => `
            <div class="comment-item">
              <span class="comment-author">${escapeHtml(c.user.displayName)}</span>
              <span class="comment-date muted">${formatDate(c.createdAt)}</span>
              <p class="comment-text">${escapeHtml(c.body)}</p>
            </div>
          `).join("") : '<p class="muted" style="margin:8px 0 0">Пока без комментариев</p>'}
        </div>
      </details>

      <form class="inline-form" data-form="comment" data-track-id="${track.id}">
        <div class="field"><textarea name="body" placeholder="Оставь фидбек по треку..." maxlength="280"></textarea></div>
        <button class="btn">Отправить</button>
      </form>
    </article>
  `;
}

export function renderNewsSection(news) {
  if (!news?.length) return "";
  return `
    <section class="panel compact-panel">
      <div class="section-head">
        <div><p class="eyebrow">Announcements</p><h3>Новости</h3></div>
        <button class="btn-ghost" data-action="jump-view" data-view="news">Все новости</button>
      </div>
      <div class="news-list" style="margin-top: 12px;">
        ${news.slice(0, 2).map(n => `
          <div class="news-card">
            <h4>${escapeHtml(n.title)}</h4>
            <div class="news-meta">${formatDate(n.createdAt)}</div>
            <div class="news-body">${escapeHtml(n.body.length > 100 ? n.body.slice(0, 100) + '...' : n.body)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
