import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { authenticateRequest } from './auth.js';
import { config } from './config.js';
import {
  addSupportMessage,
  addComment,
  createTrack,
  deleteTrack,
  getArtistProfile,
  getBootstrapData,
  getSupportMessages,
  getUserById,
  registerUser,
  searchCatalog,
  toggleFollow,
  toggleLike,
  updateProfile,
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
  };
}

function mapTrackForClient(track) {
  return {
    ...track,
    wavUrl: toPublicMediaUrl(track.wavPath),
    mp3Url: toPublicMediaUrl(track.mp3Path),
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
    sendJson(res, 200, {
      ...data,
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
    const formData = await readFormData(req, config.maxAudioBytes);
    const wavFile = formData.get('track');

    if (!(wavFile instanceof File) || wavFile.size === 0) {
      throw httpError(400, 'Нужно приложить WAV-файл.');
    }

    let wavUpload = null;
    let mp3Upload = null;

    try {
      wavUpload = await saveUploadedFile(wavFile, 'wav', {
        allowedExtensions: ['.wav'],
        maxBytes: config.maxAudioBytes,
      });

      mp3Upload = await convertWavToMp3(wavUpload.absolutePath);
      ffmpegReady = true;

      const track = createTrack(sessionUser.id, {
        title: trimText(formData.get('title'), 80),
        description: trimText(formData.get('description'), 500),
        genre: trimText(formData.get('genre'), 40),
        wavPath: wavUpload.relativePath,
        mp3Path: mp3Upload.relativePath,
      });

      sendJson(res, 200, {
        ok: true,
        track: mapTrackForClient(track),
      });
    } catch (error) {
      if (wavUpload?.relativePath) {
        await removeStoredFile(wavUpload.relativePath).catch(() => {});
      }

      if (mp3Upload?.relativePath) {
        await removeStoredFile(mp3Upload.relativePath).catch(() => {});
      }

      throw error;
    }

    return;
  }

  const deleteTrackMatch = pathname.match(/^\/api\/tracks\/(\d+)$/);

  if (req.method === 'DELETE' && deleteTrackMatch) {
    const deleted = deleteTrack(sessionUser.id, deleteTrackMatch[1]);
    await removeStoredFile(deleted.wavPath).catch(() => {});
    await removeStoredFile(deleted.mp3Path).catch(() => {});

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

  const followMatch = pathname.match(/^\/api\/artists\/(\d+)\/follow$/);

  if (req.method === 'POST' && followMatch) {
    sendJson(res, 200, {
      ok: true,
      ...toggleFollow(sessionUser.id, followMatch[1]),
    });
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
