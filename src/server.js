import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { authenticateRequest } from './auth.js';
import { config } from './config.js';
import {
  getUserById,
  upsertTelegramUser,
  resolveDailyBattles,
  createDailyBattles,
  markWeeklySummaryPosted,
} from './database.js';
import { sendJson, sendText, serveFile } from './http.js';
import {
  detectFfmpeg,
  ensureDirectories,
  resolveMediaPath,
} from './storage.js';
import { TelegramBotService } from './telegram.js';
import { httpError } from './utils.js';

// Route Handlers
import { handleAuthRequest } from './routes/auth.js';
import { handleTrackRequest } from './routes/tracks.js';
import { handleAdminRequest } from './routes/admin.js';
import { handleMiscRequest } from './routes/misc.js';

let ffmpegReady = false;

async function resolveSessionUser(req) {
  const authUser = authenticateRequest(req);
  return upsertTelegramUser(authUser);
}

async function handleApiRequest(req, res, pathname, sessionUser, telegramBot) {
  // Try Auth Routes
  if (await handleAuthRequest(req, res, pathname, sessionUser)) return;

  // Try Track/Artist Routes
  if (await handleTrackRequest(req, res, pathname, sessionUser)) return;

  // Try Admin Routes
  if (pathname.startsWith('/api/admin/')) {
    const result = await handleAdminRequest(req, res, pathname, sessionUser);
    if (result?.type === 'weekly-summary') {
      const posted = await telegramBot.sendWeeklySummary(result.summary).catch((error) => {
        console.error('[weekly-summary]', error);
        return { ok: false, error: error.message };
      });
      if (posted?.ok !== false) {
        markWeeklySummaryPosted(result.summary.weekStart);
      }
      sendJson(res, 200, { ok: true, summary: result.summary, posted });
    }
    return;
  }

  // Try Misc Routes
  if (await handleMiscRequest(req, res, pathname, sessionUser, telegramBot, ffmpegReady)) return;

  throw httpError(404, `API route ${pathname} not found.`);
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

// Create daily battles if needed on startup
try {
  const created = createDailyBattles();
  if (created.length > 0) {
    console.log(`[server] Created ${created.length} new daily battles.`);
  }
} catch (error) {
  console.error('[server] Failed to create daily battles:', error);
}

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
        await handleApiRequest(req, res, url.pathname, sessionUser, telegramBot);
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
  process.exit(1);
});

server.listen(config.port, config.host, async () => {
  console.log(`[server] Demo Stage listening on ${config.appBaseUrl}`);
  await telegramBot.start();
});

process.on('SIGINT', () => {
  telegramBot.stop();
  server.close(() => process.exit(0));
});
