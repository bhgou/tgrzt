import { DatabaseSync } from 'node:sqlite';
import { config, isAdminIdentity } from './config.js';
import { buildDisplayName, httpError, nowIso, trimText } from './utils.js';

const db = new DatabaseSync(config.databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    photo_url TEXT NOT NULL DEFAULT '',
    nickname TEXT UNIQUE COLLATE NOCASE,
    bio TEXT NOT NULL DEFAULT '',
    avatar_path TEXT,
    role TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('guest', 'listener', 'artist')),
    is_registered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '',
    wav_path TEXT NOT NULL,
    mp3_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, artist_id)
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'support')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tracks_owner_id ON tracks (owner_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_track_id ON comments (track_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_follows_artist_id ON follows (artist_id);
  CREATE INDEX IF NOT EXISTS idx_ratings_track_id ON ratings (track_id);
  CREATE INDEX IF NOT EXISTS idx_likes_track_id ON likes (track_id);
  CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages (user_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all();

if (!userColumns.some((column) => column.name === 'role')) {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'guest'`);
}

db.exec(`
  UPDATE users
  SET role = 'artist'
  WHERE is_registered = 1 AND (role IS NULL OR role = '' OR role = 'guest')
`);

function mapUserRecord(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    telegramId: row.telegram_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    nickname: row.nickname,
    bio: row.bio,
    avatarPath: row.avatar_path,
    role: row.role || (row.is_registered ? 'artist' : 'guest'),
    isAdmin: isAdminIdentity({ telegramId: row.telegram_id, username: row.username }),
    isRegistered: Boolean(row.is_registered),
    displayName: buildDisplayName({
      nickname: row.nickname,
      firstName: row.first_name,
      lastName: row.last_name,
      username: row.username,
    }),
    tracksCount: Number(row.tracks_count ?? 0),
    followersCount: Number(row.followers_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    likedTracksCount: Number(row.liked_tracks_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtistRecord(row) {
  return {
    id: Number(row.id),
    nickname: row.nickname,
    username: row.username,
    bio: row.bio,
    avatarPath: row.avatar_path,
    role: row.role,
    displayName: buildDisplayName({
      nickname: row.nickname,
      firstName: row.first_name,
      lastName: row.last_name,
      username: row.username,
    }),
    tracksCount: Number(row.tracks_count ?? 0),
    followersCount: Number(row.followers_count ?? 0),
    isFollowing: Boolean(row.is_following),
  };
}

function mapTrackRow(row, viewerId) {
  return {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    title: row.title,
    description: row.description,
    genre: row.genre,
    wavPath: row.wav_path,
    mp3Path: row.mp3_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    averageRating: Number(row.average_rating ?? 0),
    ratingsCount: Number(row.ratings_count ?? 0),
    likesCount: Number(row.likes_count ?? 0),
    commentsCount: Number(row.comments_count ?? 0),
    isLiked: Boolean(row.is_liked),
    userRating: Number(row.user_rating ?? 0),
    isFollowingArtist: Boolean(row.is_following_artist),
    isOwnTrack: Number(row.owner_id) === Number(viewerId),
    artist: {
      id: Number(row.owner_id),
      nickname: row.owner_nickname,
      username: row.owner_username,
      bio: row.owner_bio,
      avatarPath: row.owner_avatar_path,
      role: row.owner_role,
      displayName: buildDisplayName({
        nickname: row.owner_nickname,
        firstName: row.owner_first_name,
        lastName: row.owner_last_name,
        username: row.owner_username,
      }),
    },
    comments: [],
  };
}

function getUserSelect() {
  return `
    SELECT
      u.id,
      u.telegram_id,
      u.username,
      u.first_name,
      u.last_name,
      u.photo_url,
      u.nickname,
      u.bio,
      u.avatar_path,
      u.role,
      u.is_registered,
      u.created_at,
      u.updated_at,
      COALESCE((SELECT COUNT(*) FROM tracks t WHERE t.owner_id = u.id), 0) AS tracks_count,
      COALESCE((SELECT COUNT(*) FROM follows f WHERE f.artist_id = u.id), 0) AS followers_count,
      COALESCE((SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id), 0) AS following_count,
      COALESCE((SELECT COUNT(*) FROM likes l WHERE l.user_id = u.id), 0) AS liked_tracks_count
    FROM users u
  `;
}

function normalizeNickname(nickname) {
  const value = trimText(nickname, 32);

  if (value.length < 3) {
    throw httpError(400, 'Никнейм должен быть не короче 3 символов.');
  }

  if (!/^[\p{L}\p{N}_ .-]+$/u.test(value)) {
    throw httpError(400, 'Никнейм содержит недопустимые символы.');
  }

  return value;
}

function normalizeBio(bio) {
  return trimText(bio, 280);
}

function normalizeRole(role) {
  const value = trimText(role, 20).toLowerCase();

  if (value !== 'listener' && value !== 'artist') {
    throw httpError(400, 'Выбери роль: артист или слушатель.');
  }

  return value;
}

function normalizeTrackField(value, name, minLength, maxLength) {
  const text = trimText(value, maxLength);

  if (text.length < minLength) {
    throw httpError(400, `${name} заполнено слишком коротко.`);
  }

  return text;
}

function normalizeSupportBody(value) {
  const text = trimText(value, 500);

  if (text.length < 2) {
    throw httpError(400, 'Напиши вопрос чуть подробнее.');
  }

  return text;
}

function ensureNicknameUnique(userId, nickname) {
  const existing = db
    .prepare('SELECT id FROM users WHERE nickname = :nickname COLLATE NOCASE AND id != :userId')
    .get({ nickname, userId });

  if (existing) {
    throw httpError(409, 'Этот никнейм уже занят.');
  }
}

function getTrackRecord(trackId) {
  const row = db
    .prepare('SELECT id, owner_id, title, wav_path, mp3_path FROM tracks WHERE id = :trackId')
    .get({ trackId: Number(trackId) });

  if (!row) {
    throw httpError(404, 'Трек не найден.');
  }

  return row;
}

function mapSupportMessageRow(row) {
  return {
    id: Number(row.id),
    senderType: row.sender_type,
    body: row.body,
    createdAt: row.created_at,
  };
}

function buildSupportReply(message) {
  const text = String(message || '').toLowerCase();

  if (/(wav|mp3|загруз|демк|трек|релиз)/.test(text)) {
    return 'Загрузка демок и треков доступна только артистам. WAV сохраняется как исходник, а для прослушивания нужен ffmpeg, чтобы сервер собрал MP3.';
  }

  if (/(артист|роль|слушател|кабинет|профил)/.test(text)) {
    return 'Сменить роль можно в личном кабинете. Слушатель может оценивать, лайкать и подписываться, а артист получает право загружать релизы.';
  }

  if (/(бот|mini app|мини|ngrok|https|не откры|кнопк)/.test(text)) {
    return 'Если Mini App не открывается, проверь публичный HTTPS-адрес в APP_BASE_URL и перезапусти сервер. После изменения ссылки Telegram лучше открыть заново.';
  }

  if (/(жалоб|запрещ|контент|удал|модерац)/.test(text)) {
    return 'Запрещённый контент можно удалить через админский аккаунт. Если нужен разбор конкретного трека, укажи его название в следующем сообщении.';
  }

  return 'Сообщение получено. Поддержка посмотрит вопрос здесь же. Пока можешь уточнить, что именно не работает: загрузка, роли, поиск, подписки или Mini App.';
}

function attachCommentsToTracks(tracks) {
  if (!tracks.length) {
    return tracks;
  }

  const params = {};
  const placeholders = tracks
    .map((track, index) => {
      const key = `track${index}`;
      params[key] = track.id;
      return `:${key}`;
    })
    .join(', ');

  const rows = db
    .prepare(`
      SELECT *
      FROM (
        SELECT
          c.id,
          c.track_id,
          c.body,
          c.created_at,
          u.id AS user_id,
          u.nickname,
          u.first_name,
          u.last_name,
          u.username,
          u.avatar_path,
          ROW_NUMBER() OVER (PARTITION BY c.track_id ORDER BY c.created_at DESC) AS row_number
        FROM comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.track_id IN (${placeholders})
      )
      WHERE row_number <= 3
      ORDER BY created_at DESC
    `)
    .all(params);

  const commentsByTrack = new Map(tracks.map((track) => [track.id, []]));

  for (const row of rows) {
    commentsByTrack.get(Number(row.track_id))?.push({
      id: Number(row.id),
      body: row.body,
      createdAt: row.created_at,
      user: {
        id: Number(row.user_id),
        nickname: row.nickname,
        username: row.username,
        avatarPath: row.avatar_path,
        displayName: buildDisplayName({
          nickname: row.nickname,
          firstName: row.first_name,
          lastName: row.last_name,
          username: row.username,
        }),
      },
    });
  }

  for (const track of tracks) {
    track.comments = commentsByTrack.get(track.id) ?? [];
  }

  return tracks;
}

function selectTracks(viewerId, options = {}) {
  const limit = options.limit ?? 12;
  const params = {
    viewerId: Number(viewerId),
    limit: Number(limit),
    ...(options.params ?? {}),
  };

  const whereClause = options.whereClause ?? '1 = 1';
  const orderBy = options.orderBy ?? 't.created_at DESC';

  const rows = db
    .prepare(`
      SELECT
        t.id,
        t.owner_id,
        t.title,
        t.description,
        t.genre,
        t.wav_path,
        t.mp3_path,
        t.created_at,
        t.updated_at,
        u.nickname AS owner_nickname,
        u.username AS owner_username,
        u.first_name AS owner_first_name,
        u.last_name AS owner_last_name,
        u.avatar_path AS owner_avatar_path,
        u.bio AS owner_bio,
        u.role AS owner_role,
        COALESCE(r.avg_rating, 0) AS average_rating,
        COALESCE(r.ratings_count, 0) AS ratings_count,
        COALESCE(l.likes_count, 0) AS likes_count,
        COALESCE(c.comments_count, 0) AS comments_count,
        EXISTS(SELECT 1 FROM likes l2 WHERE l2.track_id = t.id AND l2.user_id = :viewerId) AS is_liked,
        COALESCE((SELECT score FROM ratings r2 WHERE r2.track_id = t.id AND r2.user_id = :viewerId), 0) AS user_rating,
        EXISTS(SELECT 1 FROM follows f2 WHERE f2.artist_id = t.owner_id AND f2.follower_id = :viewerId) AS is_following_artist
      FROM tracks t
      JOIN users u ON u.id = t.owner_id
      LEFT JOIN (
        SELECT track_id, ROUND(AVG(score), 1) AS avg_rating, COUNT(*) AS ratings_count
        FROM ratings
        GROUP BY track_id
      ) r ON r.track_id = t.id
      LEFT JOIN (
        SELECT track_id, COUNT(*) AS likes_count
        FROM likes
        GROUP BY track_id
      ) l ON l.track_id = t.id
      LEFT JOIN (
        SELECT track_id, COUNT(*) AS comments_count
        FROM comments
        GROUP BY track_id
      ) c ON c.track_id = t.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT :limit
    `)
    .all(params);

  const tracks = rows.map((row) => mapTrackRow(row, viewerId));
  return attachCommentsToTracks(tracks);
}

export function upsertTelegramUser(telegramUser) {
  const existing = db
    .prepare('SELECT id FROM users WHERE telegram_id = :telegramId')
    .get({ telegramId: telegramUser.telegramId });

  const timestamp = nowIso();

  if (existing) {
    db.prepare(`
      UPDATE users
      SET
        username = :username,
        first_name = :firstName,
        last_name = :lastName,
        photo_url = :photoUrl,
        updated_at = :updatedAt
      WHERE id = :id
    `).run({
      id: Number(existing.id),
      username: telegramUser.username ?? '',
      firstName: telegramUser.firstName ?? '',
      lastName: telegramUser.lastName ?? '',
      photoUrl: telegramUser.photoUrl ?? '',
      updatedAt: timestamp,
    });

    return getUserById(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO users (
      telegram_id,
      username,
      first_name,
      last_name,
      photo_url,
      created_at,
      updated_at
    )
    VALUES (
      :telegramId,
      :username,
      :firstName,
      :lastName,
      :photoUrl,
      :createdAt,
      :updatedAt
    )
  `).run({
    telegramId: telegramUser.telegramId,
    username: telegramUser.username ?? '',
    firstName: telegramUser.firstName ?? '',
    lastName: telegramUser.lastName ?? '',
    photoUrl: telegramUser.photoUrl ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return getUserById(result.lastInsertRowid);
}

export function getUserById(userId) {
  const row = db.prepare(`${getUserSelect()} WHERE u.id = :userId`).get({ userId: Number(userId) });
  return mapUserRecord(row);
}

export function getViewerDashboard(userId) {
  const user = getUserById(userId);

  if (!user) {
    throw httpError(404, 'Пользователь не найден.');
  }

  return {
    ...user,
    ownTracks: selectTracks(userId, {
      whereClause: 't.owner_id = :ownerId',
      params: { ownerId: Number(userId) },
      orderBy: 't.created_at DESC',
      limit: 20,
    }),
    likedTracks: selectTracks(userId, {
      whereClause: 't.id IN (SELECT track_id FROM likes WHERE user_id = :likedByUserId)',
      params: { likedByUserId: Number(userId) },
      orderBy: 't.created_at DESC',
      limit: 20,
    }),
  };
}

export function getArtistProfile(artistId, viewerId) {
  const row = db.prepare(`
    SELECT
      u.id,
      u.nickname,
      u.username,
      u.first_name,
      u.last_name,
      u.bio,
      u.avatar_path,
      u.role,
      COALESCE((SELECT COUNT(*) FROM tracks t WHERE t.owner_id = u.id), 0) AS tracks_count,
      COALESCE((SELECT COUNT(*) FROM follows f WHERE f.artist_id = u.id), 0) AS followers_count,
      EXISTS(SELECT 1 FROM follows f2 WHERE f2.artist_id = u.id AND f2.follower_id = :viewerId) AS is_following
    FROM users u
    WHERE u.id = :artistId AND u.role = 'artist' AND u.is_registered = 1
  `).get({
    artistId: Number(artistId),
    viewerId: Number(viewerId),
  });

  if (!row) {
    throw httpError(404, 'Профиль артиста не найден.');
  }

  return {
    artist: mapArtistRecord(row),
    tracks: selectTracks(viewerId, {
      whereClause: 't.owner_id = :artistId',
      params: { artistId: Number(artistId) },
      orderBy: 't.created_at DESC',
      limit: 24,
    }),
  };
}

export function getSupportMessages(userId) {
  const user = getUserById(userId);

  if (!user) {
    throw httpError(404, 'Пользователь не найден.');
  }

  return db.prepare(`
    SELECT id, sender_type, body, created_at
    FROM support_messages
    WHERE user_id = :userId
    ORDER BY created_at ASC, id ASC
    LIMIT 60
  `).all({
    userId: Number(userId),
  }).map(mapSupportMessageRow);
}

export function getPlatformStats() {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'artist') AS artists_count,
      (SELECT COUNT(*) FROM users WHERE role = 'listener') AS listeners_count,
      (SELECT COUNT(*) FROM tracks) AS tracks_count,
      (SELECT COUNT(*) FROM ratings) AS ratings_count,
      (SELECT COUNT(*) FROM comments) AS comments_count
  `).get();

  return {
    artistsCount: Number(row.artists_count ?? 0),
    listenersCount: Number(row.listeners_count ?? 0),
    tracksCount: Number(row.tracks_count ?? 0),
    ratingsCount: Number(row.ratings_count ?? 0),
    commentsCount: Number(row.comments_count ?? 0),
  };
}

export function getTopArtists(viewerId, limit = 8) {
  const rows = db.prepare(`
    SELECT
      u.id,
      u.nickname,
      u.username,
      u.first_name,
      u.last_name,
      u.bio,
      u.avatar_path,
      u.role,
      COALESCE((SELECT COUNT(*) FROM tracks t WHERE t.owner_id = u.id), 0) AS tracks_count,
      COALESCE((SELECT COUNT(*) FROM follows f WHERE f.artist_id = u.id), 0) AS followers_count,
      EXISTS(SELECT 1 FROM follows f2 WHERE f2.artist_id = u.id AND f2.follower_id = :viewerId) AS is_following
    FROM users u
    WHERE u.role = 'artist'
    ORDER BY followers_count DESC, tracks_count DESC, u.created_at DESC
    LIMIT :limit
  `).all({ viewerId: Number(viewerId), limit: Number(limit) });

  return rows.map(mapArtistRecord);
}

export function getBootstrapData(userId) {
  return {
    me: getViewerDashboard(userId),
    featuredTracks: selectTracks(userId, {
      orderBy: 'average_rating DESC, likes_count DESC, t.created_at DESC',
      limit: 8,
    }),
    latestTracks: selectTracks(userId, {
      orderBy: 't.created_at DESC',
      limit: 12,
    }),
    topArtists: getTopArtists(userId, 8),
    platformStats: getPlatformStats(),
  };
}

export function searchCatalog(query, viewerId) {
  const normalizedQuery = trimText(query, 60);

  if (!normalizedQuery) {
    return {
      artists: getTopArtists(viewerId, 8),
      tracks: selectTracks(viewerId, {
        orderBy: 't.created_at DESC',
        limit: 8,
      }),
    };
  }

  const likeQuery = `%${normalizedQuery}%`;

  const artists = db.prepare(`
    SELECT
      u.id,
      u.nickname,
      u.username,
      u.first_name,
      u.last_name,
      u.bio,
      u.avatar_path,
      u.role,
      COALESCE((SELECT COUNT(*) FROM tracks t WHERE t.owner_id = u.id), 0) AS tracks_count,
      COALESCE((SELECT COUNT(*) FROM follows f WHERE f.artist_id = u.id), 0) AS followers_count,
      EXISTS(SELECT 1 FROM follows f2 WHERE f2.artist_id = u.id AND f2.follower_id = :viewerId) AS is_following
    FROM users u
    WHERE
      u.role = 'artist'
      AND (
        u.nickname LIKE :likeQuery
        OR u.username LIKE :likeQuery
        OR u.first_name LIKE :likeQuery
      )
    ORDER BY followers_count DESC, tracks_count DESC, u.created_at DESC
    LIMIT 12
  `).all({ viewerId: Number(viewerId), likeQuery }).map(mapArtistRecord);

  const tracks = selectTracks(viewerId, {
    whereClause: `
      t.title LIKE :likeQuery
      OR t.genre LIKE :likeQuery
      OR u.nickname LIKE :likeQuery
      OR u.username LIKE :likeQuery
    `,
    params: { likeQuery },
    orderBy: 'average_rating DESC, t.created_at DESC',
    limit: 12,
  });

  return { artists, tracks };
}

export function registerUser(userId, input) {
  const user = getUserById(userId);

  if (!user) {
    throw httpError(404, 'Пользователь не найден.');
  }

  const role = normalizeRole(input.role);
  const nickname = normalizeNickname(input.nickname);
  const bio = normalizeBio(input.bio);
  ensureNicknameUnique(userId, nickname);

  const updatedAt = nowIso();
  db.prepare(`
    UPDATE users
    SET
      nickname = :nickname,
      bio = :bio,
      avatar_path = :avatarPath,
      role = :role,
      is_registered = 1,
      updated_at = :updatedAt
    WHERE id = :userId
  `).run({
    userId: Number(userId),
    nickname,
    bio,
    avatarPath: input.avatarPath ?? user.avatarPath,
    role,
    updatedAt,
  });

  return getUserById(userId);
}

export function updateProfile(userId, input) {
  const user = getUserById(userId);

  if (!user?.isRegistered) {
    throw httpError(403, 'Сначала нужно зарегистрировать профиль.');
  }

  const role = input.role ? normalizeRole(input.role) : user.role;
  const nickname = normalizeNickname(input.nickname ?? user.nickname);
  const bio = normalizeBio(input.bio ?? user.bio);
  ensureNicknameUnique(userId, nickname);

  if (user.role === 'artist' && role !== 'artist' && user.tracksCount > 0) {
    throw httpError(400, 'Нельзя переключиться на слушателя после публикации треков.');
  }

  db.prepare(`
    UPDATE users
    SET
      nickname = :nickname,
      bio = :bio,
      avatar_path = :avatarPath,
      role = :role,
      updated_at = :updatedAt
    WHERE id = :userId
  `).run({
    userId: Number(userId),
    nickname,
    bio,
    avatarPath: input.avatarPath ?? user.avatarPath,
    role,
    updatedAt: nowIso(),
  });

  return getUserById(userId);
}

export function createTrack(userId, input) {
  const user = getUserById(userId);

  if (user?.role !== 'artist') {
    throw httpError(403, 'Загрузка доступна только артистам.');
  }

  const title = normalizeTrackField(input.title, 'Название трека', 2, 80);
  const description = trimText(input.description, 500);
  const genre = trimText(input.genre, 40);

  const inserted = db.prepare(`
    INSERT INTO tracks (
      owner_id,
      title,
      description,
      genre,
      wav_path,
      mp3_path,
      created_at,
      updated_at
    )
    VALUES (
      :ownerId,
      :title,
      :description,
      :genre,
      :wavPath,
      :mp3Path,
      :createdAt,
      :updatedAt
    )
  `).run({
    ownerId: Number(userId),
    title,
    description,
    genre,
    wavPath: input.wavPath,
    mp3Path: input.mp3Path,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  return selectTracks(userId, {
    whereClause: 't.id = :trackId',
    params: { trackId: Number(inserted.lastInsertRowid) },
    limit: 1,
  })[0];
}

export function toggleLike(userId, trackId) {
  const track = getTrackRecord(trackId);

  if (Number(track.owner_id) === Number(userId)) {
    throw httpError(400, 'Нельзя лайкать собственный трек.');
  }

  const existing = db
    .prepare('SELECT 1 FROM likes WHERE user_id = :userId AND track_id = :trackId')
    .get({ userId: Number(userId), trackId: Number(trackId) });

  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = :userId AND track_id = :trackId').run({
      userId: Number(userId),
      trackId: Number(trackId),
    });

    return { liked: false };
  }

  db.prepare(`
    INSERT INTO likes (user_id, track_id, created_at)
    VALUES (:userId, :trackId, :createdAt)
  `).run({
    userId: Number(userId),
    trackId: Number(trackId),
    createdAt: nowIso(),
  });

  return { liked: true };
}

export function upsertRating(userId, trackId, score) {
  const track = getTrackRecord(trackId);

  if (Number(track.owner_id) === Number(userId)) {
    throw httpError(400, 'Нельзя оценивать собственный трек.');
  }

  const numericScore = Number(score);

  if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 10) {
    throw httpError(400, 'Оценка должна быть числом от 1 до 10.');
  }

  const existing = db
    .prepare('SELECT 1 FROM ratings WHERE user_id = :userId AND track_id = :trackId')
    .get({ userId: Number(userId), trackId: Number(trackId) });

  if (existing) {
    db.prepare(`
      UPDATE ratings
      SET score = :score, updated_at = :updatedAt
      WHERE user_id = :userId AND track_id = :trackId
    `).run({
      userId: Number(userId),
      trackId: Number(trackId),
      score: numericScore,
      updatedAt: nowIso(),
    });
  } else {
    db.prepare(`
      INSERT INTO ratings (user_id, track_id, score, created_at, updated_at)
      VALUES (:userId, :trackId, :score, :createdAt, :updatedAt)
    `).run({
      userId: Number(userId),
      trackId: Number(trackId),
      score: numericScore,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return { score: numericScore };
}

export function addComment(userId, trackId, body) {
  getTrackRecord(trackId);
  const commentBody = trimText(body, 280);

  if (commentBody.length < 2) {
    throw httpError(400, 'Комментарий должен быть длиннее 1 символа.');
  }

  db.prepare(`
    INSERT INTO comments (user_id, track_id, body, created_at)
    VALUES (:userId, :trackId, :body, :createdAt)
  `).run({
    userId: Number(userId),
    trackId: Number(trackId),
    body: commentBody,
    createdAt: nowIso(),
  });

  return { ok: true };
}

export function addSupportMessage(userId, body) {
  const user = getUserById(userId);

  if (!user) {
    throw httpError(404, 'Пользователь не найден.');
  }

  const normalizedBody = normalizeSupportBody(body);
  const timestamp = nowIso();

  db.prepare(`
    INSERT INTO support_messages (user_id, sender_type, body, created_at)
    VALUES (:userId, 'user', :body, :createdAt)
  `).run({
    userId: Number(userId),
    body: normalizedBody,
    createdAt: timestamp,
  });

  db.prepare(`
    INSERT INTO support_messages (user_id, sender_type, body, created_at)
    VALUES (:userId, 'support', :body, :createdAt)
  `).run({
    userId: Number(userId),
    body: buildSupportReply(normalizedBody),
    createdAt: nowIso(),
  });

  return getSupportMessages(userId);
}

export function toggleFollow(userId, artistId) {
  const artist = getUserById(artistId);

  if (artist?.role !== 'artist') {
    throw httpError(404, 'Артист не найден.');
  }

  if (Number(userId) === Number(artistId)) {
    throw httpError(400, 'Нельзя подписаться на самого себя.');
  }

  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = :userId AND artist_id = :artistId')
    .get({ userId: Number(userId), artistId: Number(artistId) });

  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = :userId AND artist_id = :artistId').run({
      userId: Number(userId),
      artistId: Number(artistId),
    });

    return { following: false };
  }

  db.prepare(`
    INSERT INTO follows (follower_id, artist_id, created_at)
    VALUES (:userId, :artistId, :createdAt)
  `).run({
    userId: Number(userId),
    artistId: Number(artistId),
    createdAt: nowIso(),
  });

  return { following: true };
}

export function deleteTrack(actorUserId, trackId) {
  const actor = getUserById(actorUserId);
  const track = getTrackRecord(trackId);

  if (!actor) {
    throw httpError(404, 'Пользователь не найден.');
  }

  const canDelete = actor.isAdmin || Number(track.owner_id) === Number(actorUserId);

  if (!canDelete) {
    throw httpError(403, 'Недостаточно прав для удаления трека.');
  }

  db.prepare('DELETE FROM tracks WHERE id = :trackId').run({ trackId: Number(trackId) });

  return {
    trackId: Number(track.id),
    wavPath: track.wav_path,
    mp3Path: track.mp3_path,
    deletedAsAdmin: Boolean(actor.isAdmin && Number(track.owner_id) !== Number(actorUserId)),
  };
}

// Admin management functions

function getAdminUserIds() {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = :key').get({ key: 'admin_telegram_ids' });
  if (!row) {
    return [];
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return [];
  }
}

function saveAdminUserIds(ids) {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES ('admin_telegram_ids', :value, :updatedAt)
    ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :updatedAt
  `).run({
    value: JSON.stringify(ids),
    updatedAt: timestamp,
  });
}

export function addAdmin(userId) {
  const user = getUserById(userId);
  if (!user) {
    throw httpError(404, 'Пользователь не найден.');
  }

  const adminIds = getAdminUserIds();
  const telegramIdStr = String(user.telegramId);

  if (!adminIds.includes(telegramIdStr)) {
    adminIds.push(telegramIdStr);
    saveAdminUserIds(adminIds);
  }

  return { ok: true, user: mapUserRecord(user) };
}

export function removeAdmin(userId) {
  const user = getUserById(userId);
  if (!user) {
    throw httpError(404, 'Пользователь не найден.');
  }

  const adminIds = getAdminUserIds();
  const telegramIdStr = String(user.telegramId);
  const filtered = adminIds.filter(id => id !== telegramIdStr);

  if (filtered.length !== adminIds.length) {
    saveAdminUserIds(filtered);
  }

  return { ok: true, user: mapUserRecord(user) };
}

export function isUserAdmin(userId) {
  const user = getUserById(userId);
  if (!user) {
    return false;
  }
  return isAdminIdentity({ telegramId: user.telegramId, username: user.username });
}

export function getAllUsers(options = {}) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const rows = db.prepare(`
    ${getUserSelect()}
    ORDER BY u.created_at DESC
    LIMIT :limit OFFSET :offset
  `).all({ limit: Number(limit), offset: Number(offset) });

  return rows.map(mapUserRecord);
}

export function getAdminUsers() {
  const adminIds = getAdminUserIds();
  if (adminIds.length === 0) {
    return [];
  }

  const params = {};
  const placeholders = adminIds.map((id, index) => {
    const key = `id${index}`;
    params[key] = id;
    return `:${key}`;
  }).join(', ');

  const rows = db.prepare(`
    ${getUserSelect()}
    WHERE u.telegram_id IN (${placeholders})
    ORDER BY u.created_at DESC
  `).all(params);

  return rows.map(mapUserRecord);
}

export function transferArtistData(fromUserId, toUserId) {
  const fromUser = getUserById(fromUserId);
  const toUser = getUserById(toUserId);

  if (!fromUser) {
    throw httpError(404, 'Исходный пользователь не найден.');
  }

  if (!toUser) {
    throw httpError(404, 'Целевой пользователь не найден.');
  }

  if (fromUser.id === toUser.id) {
    throw httpError(400, 'Нельзя перенести данные на того же пользователя.');
  }

  const fromId = Number(fromUserId);
  const toId = Number(toUserId);

  db.exec('BEGIN TRANSACTION');

  try {
    // Переносим треки
    db.prepare('UPDATE tracks SET owner_id = :toId WHERE owner_id = :fromId').run({
      toId,
      fromId,
    });

    // Переносим рейтинги (если есть конфликты, заменяем)
    db.prepare(`
      INSERT OR REPLACE INTO ratings (user_id, track_id, score, created_at, updated_at)
      SELECT :toId, track_id, score, created_at, updated_at
      FROM ratings
      WHERE user_id = :fromId
    `).run({ toId, fromId });

    db.prepare('DELETE FROM ratings WHERE user_id = :fromId AND track_id IN (SELECT id FROM tracks WHERE owner_id = :toId)').run({
      fromId,
      toId,
    });

    // Переносим лайки
    db.prepare(`
      INSERT OR REPLACE INTO likes (user_id, track_id, created_at)
      SELECT :toId, track_id, created_at
      FROM likes
      WHERE user_id = :fromId
    `).run({ toId, fromId });

    db.prepare('DELETE FROM likes WHERE user_id = :fromId').run({ fromId });

    // Переносим комментарии
    db.prepare('UPDATE comments SET user_id = :toId WHERE user_id = :fromId').run({
      toId,
      fromId,
    });

    // Переносим подписки (как подписчик)
    db.prepare(`
      INSERT OR REPLACE INTO follows (follower_id, artist_id, created_at)
      SELECT :toId, artist_id, created_at
      FROM follows
      WHERE follower_id = :fromId
    `).run({ toId, fromId });

    db.prepare('DELETE FROM follows WHERE follower_id = :fromId').run({ fromId });

    // Переносим подписки (как артист, за кем подписаны)
    db.prepare(`
      INSERT OR REPLACE INTO follows (follower_id, artist_id, created_at)
      SELECT follower_id, :toId, created_at
      FROM follows
      WHERE artist_id = :fromId AND follower_id != :toId
    `).run({ toId, fromId });

    db.prepare('DELETE FROM follows WHERE artist_id = :fromId AND follower_id != :toId').run({ fromId });

    // Переносим сообщения поддержки
    db.prepare('UPDATE support_messages SET user_id = :toId WHERE user_id = :fromId').run({
      toId,
      fromId,
    });

    // Удаляем старого пользователя
    db.prepare('DELETE FROM users WHERE id = :fromId').run({ fromId });

    db.exec('COMMIT');

    return {
      ok: true,
      transferred: {
        fromUser: { id: fromUser.id, telegramId: fromUser.telegramId, nickname: fromUser.nickname },
        toUser: { id: toUser.id, telegramId: toUser.telegramId, nickname: toUser.nickname },
      },
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function linkArtistToTelegram(telegramId, artistNickname) {
  const existingUser = db
    .prepare('SELECT id, telegram_id, nickname, role, is_registered FROM users WHERE telegram_id = :telegramId')
    .get({ telegramId: String(telegramId) });

  if (!existingUser) {
    throw httpError(404, 'Пользователь с таким Telegram ID не найден.');
  }

  const artistUser = db
    .prepare('SELECT id, telegram_id, nickname, role, is_registered FROM users WHERE nickname = :nickname COLLATE NOCASE AND role = :role')
    .get({ nickname: artistNickname, role: 'artist' });

  if (!artistUser) {
    throw httpError(404, `Артист с никнеймом "${artistNickname}" не найден.`);
  }

  if (existingUser.id === artistUser.id) {
    throw httpError(400, 'Этот пользователь уже привязан к данному артисту.');
  }

  return transferArtistData(artistUser.id, existingUser.id);
}
