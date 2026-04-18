import crypto from 'node:crypto';
import { config } from './config.js';
import { httpError } from './utils.js';

function getInitDataFromRequest(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('TelegramMiniApp ')) {
    return authHeader.slice('TelegramMiniApp '.length);
  }
  return req.headers['x-telegram-init-data'] || '';
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyTelegramInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    console.error('[auth] hash missing in initData');
    throw httpError(401, 'Telegram initData не содержит hash.');
  }

  params.delete('hash');
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!safeCompare(hash, calculatedHash)) {
    console.error('[auth] hash mismatch!');
    console.error('  Received:', hash);
    console.error('  Calculated:', calculatedHash);
    console.error('  DataCheckString:', dataCheckString.replace(/\n/g, '\\n'));
    throw httpError(401, 'Подпись Telegram Mini App не прошла проверку.');
  }

  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);

  if (authDate && Math.abs(now - authDate) > 86_400) {
    throw httpError(401, 'Сессия Telegram Mini App устарела.');
  }

  const rawUser = params.get('user');

  if (!rawUser) {
    throw httpError(401, 'Telegram initData не содержит пользователя.');
  }

  const user = JSON.parse(rawUser);

  return {
    telegramId: String(user.id),
    username: user.username ?? '',
    firstName: user.first_name ?? '',
    lastName: user.last_name ?? '',
    photoUrl: user.photo_url ?? '',
    source: 'telegram',
  };
}

export function authenticateRequest(req) {
  const initData = getInitDataFromRequest(req);

  if (initData) {
    console.log('[auth] Received initData, length:', initData.length);
    if (!config.botToken) {
      throw httpError(500, 'Для Telegram Mini App нужен BOT_TOKEN.');
    }

    return verifyTelegramInitData(initData);
  }

  console.warn('[auth] No X-Telegram-Init-Data header found in request');
  if (config.allowDevAuth) {
    return {
      ...config.devUser,
      source: 'dev',
    };
  }

  throw httpError(401, 'Требуется авторизация через Telegram Mini App.');
}
