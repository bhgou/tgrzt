import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { authenticateRequest } from './auth.js';
import { config } from './config.js';
import {
  addTrackPlay,
  addTrackRepost,
  addSupportMessage,
  addComment,
  claimInvite,
  createTrack,
  deleteTrack,
  ensureUserInviteCode,
  getArtistProfile,
  getBootstrapData,
  getInviteStats,
  getPlatformStats,
  getSupportMessages,
  getTopInviters,
  getUserById,
  getWeeklySummary,
  hasWeeklySummaryPosted,
  markWeeklySummaryPosted,
  registerUser,
  searchCatalog,
  toggleFollow,
  toggleLike,
  updateProfile,
  updateTrack,
  upsertRating,
  upsertTelegramUser,
} from './database.js';
import { readFormData, readJson, sendJson, sendText, serveFile } from './http.js';
import {
  convertWavToMp3,
  detectFfmpeg,
  ensureDirectories,
  removeStoredFile,
  resolveMediaPath,
  saveUploadedFile,
  toPublicMediaUrl,
} from './storage.js';
import { TelegramBotService } from './telegram.js';
import { httpError, trimText } from './utils.js';

let ffmpegReady = false;

function mapArtistForClient(artist) {
  return {
    ...artist,
    avatarUrl: artist.avatarPath ? toPublicMediaUrl(artist.avatarPath) : null,
    topTrackMp3Url: artist.topTrackMp3Path ? toPublicMediaUrl(artist.topTrackMp3Path) : null,
  };
}

function mapTrackForClient(track) {
  return {
    ...track,
    wavUrl: toPublicMediaUrl(track.wavPath),
    mp3Url: toPublicMediaUrl(track.mp3Path),
    coverUrl: track.coverPath ? toPublicMediaUrl(track.coverPath) : null,
    artist: {
      ...track.artist,
      avatarUrl: track.artist.avatarPath ? toPublicMediaUrl(track.artist.avatarPath) : null,
    },
    comments: track.comments.map((comment) => ({
      ...comment,
      user: {
        ...comment.user,
        avatarUrl: comment.user.avatarPath ? toPublicMediaUrl(comment.user.avatarPath) : null,
      },
    })),
  };
}

function mapUserForClient(user) {
  return {
    ...user,
    avatarUrl: user.avatarPath ? toPublicMediaUrl(user.avatarPath) : null,
    ownTracks: user.ownTracks.map(mapTrackForClient),
    likedTracks: user.likedTracks.map(mapTrackForClient),
  };
}

function mapBootstrapForClient(data) {
  return {
    me: mapUserForClient(data.me),
    featuredTracks: data.featuredTracks.map(mapTrackForClient),
    latestTracks: data.latestTracks.map(mapTrackForClient),
    topArtists: data.topArtists.map(mapArtistForClient),
    platformStats: data.platformStats,
  };
}

function mapArtistProfileForClient(profile) {
  return {
    artist: mapArtistForClient(profile.artist),
    tracks: profile.tracks.map(mapTrackForClient),
  };
}

function mapSupportMessageForClient(message) {
  return {
    ...message,
  };
}

async function resolveSessionUser(req) {
  const authUser = authenticateRequest(req);
  return upsertTelegramUser(authUser);
}

async function parseProfilePayload(req, maxBytes) {
  const formData = await readFormData(req, maxBytes);
  const avatar = formData.get('avatar');

  return {
    formData,
    payload: {
      role: trimText(formData.get('role'), 20).toLowerCase(),
      nickname: trimText(formData.get('nickname'), 32),
      bio: trimText(formData.get('bio'), 280),
      avatar: avatar instanceof File && avatar.size > 0 ? avatar : null,
    },
  };
}

async function handleApiRequest(req, res, pathname, sessionUser) {
  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const data = mapBootstrapForClient(getBootstrapData(sessionUser.id));
    let inviteCode = null;
    try {
      inviteCode = ensureUserInviteCode(sessionUser.id);
    } catch (_e) {
      inviteCode = null;
    }
    const topInviters = getTopInviters(20).map((inv) => ({
      ...inv,
      avatarUrl: inv.avatarPath ? toPublicMediaUrl(inv.avatarPath) : null,
    }));
    sendJson(res, 200, {
      ...data,
      inviteCode,
      topInviters,
      botUsername: telegramBot.botInfo?.username || '',
      capabilities: {
        ffmpegReady,
        botConfigured: Boolean(config.botToken),
      },
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/session/login') {
    sendJson(res, 200, {
      ok: true,
      registered: sessionUser.isRegistered,
      message: sessionUser.isRegistered
        ? `Аккаунт найден. Роль: ${sessionUser.role === 'artist' ? 'артист' : 'слушатель'}.`
        : 'Telegram-профиль найден, но роль ещё не выбрана.',
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/session/logout') {
    sendJson(res, 200, {
      ok: true,
      closeMiniApp: true,
      message: 'Профиль закрывается. При следующем открытии вход снова выполнится через Telegram.',
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/search') {
    const url = new URL(req.url, config.appBaseUrl);
    const results = searchCatalog(url.searchParams.get('q') || '', sessionUser.id);

    sendJson(res, 200, {
      artists: results.artists.map(mapArtistForClient),
      tracks: results.tracks.map(mapTrackForClient),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/support/messages') {
    sendJson(res, 200, {
      messages: getSupportMessages(sessionUser.id).map(mapSupportMessageForClient),
    });
    return;
  }

  const artistProfileMatch = pathname.match(/^\/api\/artists\/(\d+)$/);

  if (req.method === 'GET' && artistProfileMatch) {
    sendJson(res, 200, mapArtistProfileForClient(getArtistProfile(artistProfileMatch[1], sessionUser.id)));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    const previousUser = getUserById(sessionUser.id);
    const { payload } = await parseProfilePayload(req, config.maxAvatarBytes);
    let avatarUpload = null;

    try {
      if (payload.avatar) {
        avatarUpload = await saveUploadedFile(payload.avatar, 'avatars', {
          allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
          maxBytes: config.maxAvatarBytes,
        });
      }

      const updatedUser = registerUser(sessionUser.id, {
        role: payload.role,
        nickname: payload.nickname,
        bio: payload.bio,
        avatarPath: avatarUpload?.relativePath ?? previousUser.avatarPath,
      });

      if (avatarUpload?.relativePath && previousUser.avatarPath && previousUser.avatarPath !== avatarUpload.relativePath) {
        await removeStoredFile(previousUser.avatarPath);
      }

      sendJson(res, 200, {
        ok: true,
        user: mapUserForClient({
          ...getBootstrapData(updatedUser.id).me,
        }),
      });
    } catch (error) {
      if (avatarUpload?.relativePath) {
        await removeStoredFile(avatarUpload.relativePath).catch(() => {});
      }

      throw error;
    }

    return;
  }

  if (req.method === 'POST' && pathname === '/api/support/messages') {
    const body = await readJson(req, config.maxJsonBytes);
    sendJson(res, 200, {
      ok: true,
      messages: addSupportMessage(sessionUser.id, body.body).map(mapSupportMessageForClient),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/profile') {
    const previousUser = getUserById(sessionUser.id);
    const { payload } = await parseProfilePayload(req, config.maxAvatarBytes);
    let avatarUpload = null;

    try {
      if (payload.avatar) {
        avatarUpload = await saveUploadedFile(payload.avatar, 'avatars', {
          allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
          maxBytes: config.maxAvatarBytes,
        });
      }

      const updatedUser = updateProfile(sessionUser.id, {
        role: payload.role || previousUser.role,
        nickname: payload.nickname || previousUser.nickname,
        bio: payload.bio,
        avatarPath: avatarUpload?.relativePath ?? previousUser.avatarPath,
      });

      if (avatarUpload?.relativePath && previousUser.avatarPath && previousUser.avatarPath !== avatarUpload.relativePath) {
        await removeStoredFile(previousUser.avatarPath);
      }

      sendJson(res, 200, {
        ok: true,
        user: mapUserForClient({
          ...getBootstrapData(updatedUser.id).me,
        }),
      });
    } catch (error) {
      if (avatarUpload?.relativePath) {
        await removeStoredFile(avatarUpload.relativePath).catch(() => {});
      }

      throw error;
    }

    return;
  }

  if (req.method === 'POST' && pathname === '/api/tracks') {
    const formData = await readFormData(req, config.maxAudioBytes + config.maxCoverBytes);
    const audioFile = formData.get('track');
    const coverFile = formData.get('cover');

    if (!(audioFile instanceof File) || audioFile.size === 0) {
      throw httpError(400, 'Нужно приложить аудиофайл (WAV или MP3).');
    }

    const uploadExt = path.extname(audioFile.name || '').toLowerCase();

    if (uploadExt !== '.wav' && uploadExt !== '.mp3') {
      throw httpError(400, 'Поддерживаются только WAV и MP3 файлы.');
    }

    let wavUpload = null;
    let mp3Upload = null;
    let coverUpload = null;

    try {
      if (uploadExt === '.wav') {
        // WAV: сохраняем оригинал, конвертируем в MP3 через ffmpeg
        wavUpload = await saveUploadedFile(audioFile, 'wav', {
          allowedExtensions: ['.wav'],
          maxBytes: config.maxAudioBytes,
        });

        mp3Upload = await convertWavToMp3(wavUpload.absolutePath);
        ffmpegReady = true;
      } else {
        // MP3: сохраняем напрямую, используем один файл для воспроизведения и скачивания
        mp3Upload = await saveUploadedFile(audioFile, 'mp3', {
          allowedExtensions: ['.mp3'],
          maxBytes: config.maxAudioBytes,
        });
        wavUpload = { relativePath: mp3Upload.relativePath, absolutePath: mp3Upload.absolutePath };
      }

      // Обложка — опционально
      if (coverFile instanceof File && coverFile.size > 0) {
        const coverExt = path.extname(coverFile.name || '').toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(coverExt)) {
          throw httpError(400, 'Обложка должна быть в формате JPG, PNG или WEBP.');
        }
        coverUpload = await saveUploadedFile(coverFile, 'covers', {
          allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
          maxBytes: config.maxCoverBytes,
        });
      }

      const track = createTrack(sessionUser.id, {
        title: trimText(formData.get('title'), 80),
        description: '',
        genre: '',
        wavPath: wavUpload.relativePath,
        mp3Path: mp3Upload.relativePath,
        coverPath: coverUpload?.relativePath ?? null,
      });

      sendJson(res, 200, {
        ok: true,
        track: mapTrackForClient(track),
      });
    } catch (error) {
      // При WAV удаляем оба файла; при MP3 wavUpload === mp3Upload, удаляем один раз
      const toDelete = new Set();
      if (wavUpload?.relativePath) toDelete.add(wavUpload.relativePath);
      if (mp3Upload?.relativePath) toDelete.add(mp3Upload.relativePath);
      if (coverUpload?.relativePath) toDelete.add(coverUpload.relativePath);
      await Promise.all([...toDelete].map((p) => removeStoredFile(p).catch(() => {})));

      throw error;
    }

    return;
  }

  const trackIdMatch = pathname.match(/^\/api\/tracks\/(\d+)$/);

  if (req.method === 'PATCH' && trackIdMatch) {
    const trackId = trackIdMatch[1];
    const formData = await readFormData(req, config.maxCoverBytes + config.maxJsonBytes);
    const coverFile = formData.get('cover');
    const removeCover = formData.get('removeCover') === '1';

    let coverUpload = null;
    const input = {};

    if (formData.has('title')) input.title = trimText(formData.get('title'), 80);
    if (formData.has('description')) input.description = trimText(formData.get('description'), 500);
    if (formData.has('genre')) input.genre = trimText(formData.get('genre'), 40);

    try {
      if (coverFile instanceof File && coverFile.size > 0) {
        const coverExt = path.extname(coverFile.name || '').toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(coverExt)) {
          throw httpError(400, 'Обложка должна быть в формате JPG, PNG или WEBP.');
        }
        coverUpload = await saveUploadedFile(coverFile, 'covers', {
          allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
          maxBytes: config.maxCoverBytes,
        });
        input.coverPath = coverUpload.relativePath;
      } else if (removeCover) {
        input.coverPath = null;
      }

      const result = updateTrack(sessionUser.id, trackId, input);

      // Удаляем старый файл обложки, если он сменился или был снят
      if (result.oldCoverPath) {
        await removeStoredFile(result.oldCoverPath).catch(() => {});
      }

      sendJson(res, 200, {
        ok: true,
        track: mapTrackForClient(result.track),
      });
    } catch (error) {
      // Если не сохранили в БД — удалим загруженный новый файл обложки
      if (coverUpload?.relativePath) {
        await removeStoredFile(coverUpload.relativePath).catch(() => {});
      }
      throw error;
    }

    return;
  }

  const deleteTrackMatch = trackIdMatch;

  if (req.method === 'DELETE' && deleteTrackMatch) {
    const deleted = deleteTrack(sessionUser.id, deleteTrackMatch[1]);
    await removeStoredFile(deleted.wavPath).catch(() => {});
    await removeStoredFile(deleted.mp3Path).catch(() => {});
    if (deleted.coverPath) await removeStoredFile(deleted.coverPath).catch(() => {});

    sendJson(res, 200, {
      ok: true,
      ...deleted,
    });
    return;
  }

  const likeMatch = pathname.match(/^\/api\/tracks\/(\d+)\/like$/);

  if (req.method === 'POST' && likeMatch) {
    sendJson(res, 200, {
      ok: true,
      ...toggleLike(sessionUser.id, likeMatch[1]),
    });
    return;
  }

  const rateMatch = pathname.match(/^\/api\/tracks\/(\d+)\/rate$/);

  if (req.method === 'POST' && rateMatch) {
    const body = await readJson(req, config.maxJsonBytes);
    sendJson(res, 200, {
      ok: true,
      ...upsertRating(sessionUser.id, rateMatch[1], body.score),
    });
    return;
  }

  const commentMatch = pathname.match(/^\/api\/tracks\/(\d+)\/comments$/);

  if (req.method === 'POST' && commentMatch) {
    const body = await readJson(req, config.maxJsonBytes);
    sendJson(res, 200, {
      ok: true,
      ...addComment(sessionUser.id, commentMatch[1], body.body),
    });
    return;
  }

  const playMatch = pathname.match(/^\/api\/tracks\/(\d+)\/play$/);

  if (req.method === 'POST' && playMatch) {
    sendJson(res, 200, {
      ok: true,
      ...addTrackPlay(sessionUser.id, playMatch[1]),
    });
    return;
  }

  const followMatch = pathname.match(/^\/api\/artists\/(\d+)\/follow$/);

  if (req.method === 'POST' && followMatch) {
    sendJson(res, 200, {
      ok: true,
      ...toggleFollow(sessionUser.id, followMatch[1]),
    });
    return;
  }

  // ========== INVITES ==========

  if (req.method === 'GET' && pathname === '/api/invite/me') {
    const stats = getInviteStats(sessionUser.id);
    const botUsername = telegramBot.botInfo?.username || '';
    const inviteLink = botUsername
      ? `https://t.me/${botUsername}/app?startapp=${stats.code}`
      : `${config.appBaseUrl}?invite=${stats.code}`;
    sendJson(res, 200, { ...stats, inviteLink, botUsername });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/invite/claim') {
    const body = await readJson(req, config.maxJsonBytes);
    const result = claimInvite(sessionUser.id, body.code);
    sendJson(res, 200, { ok: result.ok, ...result });
    return;
  }

  // ========== REPOSTS ==========

  const repostMatch = pathname.match(/^\/api\/tracks\/(\d+)\/repost$/);

  if (req.method === 'POST' && repostMatch) {
    sendJson(res, 200, {
      ok: true,
      ...addTrackRepost(sessionUser.id, repostMatch[1]),
    });
    return;
  }

  // ========== WEEKLY SUMMARY (admin) ==========

  if (req.method === 'POST' && pathname === '/api/admin/weekly-summary') {
    const user = getUserById(sessionUser.id);
    if (!user?.isAdmin) {
      throw httpError(403, 'Только для админа.');
    }
    const summary = getWeeklySummary();
    const posted = await telegramBot.sendWeeklySummary(summary).catch((error) => {
      console.error('[weekly-summary]', error);
      return { ok: false, error: error.message };
    });
    if (posted?.ok !== false) {
      markWeeklySummaryPosted(summary.weekStart);
    }
    sendJson(res, 200, { ok: true, summary, posted });
    return;
  }

  throw httpError(404, 'API route не найдена.');
}

async function handleStaticRequest(res, pathname) {
  if (pathname.startsWith('/media/')) {
    const mediaPath = resolveMediaPath(pathname.slice('/media/'.length));
    await serveFile(res, mediaPath);
    return;
  }

  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const absolutePath = path.resolve(config.publicDir, requestedPath);

  if (!absolutePath.startsWith(config.publicDir)) {
    throw httpError(400, 'Некорректный путь к статике.');
  }

  const stats = await fs.stat(absolutePath).catch(() => null);

  if (stats?.isFile()) {
    await serveFile(res, absolutePath);
    return;
  }

  if (path.extname(pathname)) {
    throw httpError(404, 'Статический файл не найден.');
  }

  await serveFile(res, path.join(config.publicDir, 'index.html'));
}

function handleError(res, error) {
  const statusCode = error.statusCode ?? 500;
  const message = error.message ?? 'Внутренняя ошибка сервера.';

  if (statusCode >= 500) {
    console.error('[server]', error);
  }

  if (!res.headersSent) {
    sendJson(res, statusCode, { error: message });
  } else {
    res.end();
  }
}

await ensureDirectories();
ffmpegReady = await detectFfmpeg();

if (!ffmpegReady) {
  console.warn('[server] ffmpeg not found, WAV upload will fail until ffmpeg is installed.');
}

const telegramBot = new TelegramBotService(config);
await telegramBot.start();

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url || '/', config.appBaseUrl);

      if (req.method === 'GET' && url.pathname === '/health') {
        sendText(res, 200, 'ok');
        return;
      }

      // ── Public endpoints (no auth required) ──────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/public-stats') {
        sendJson(res, 200, getPlatformStats());
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        const sessionUser = await resolveSessionUser(req);
        await handleApiRequest(req, res, url.pathname, sessionUser);
        return;
      }

      await handleStaticRequest(res, url.pathname);
    } catch (error) {
      handleError(res, error);
    }
  })();
});

server.on('error', (error) => {
  console.error(`[server] failed to listen on ${config.host}:${config.port}: ${error.message}`);
});

server.listen(config.port, config.host, () => {
  console.log(`[server] Demo Stage listening on ${config.appBaseUrl}`);
});

process.on('SIGINT', () => {
  telegramBot.stop();
  server.close(() => process.exit(0));
});
