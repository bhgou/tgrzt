import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, '..');

try {
  process.loadEnvFile?.(path.join(rootDir, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') {
    throw error;
  }
}

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

function parseList(value, lowerCase = false) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => (lowerCase ? item.trim().toLowerCase() : item.trim()))
      .filter(Boolean),
  );
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number.isFinite(port) ? port : 3000,
  appBaseUrl: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
  botToken: process.env.BOT_TOKEN ?? '',
  channelId: process.env.CHANNEL_ID ?? '',
  allowDevAuth: process.env.ALLOW_DEV_AUTH !== 'false',
  adminTelegramIds: parseList(process.env.ADMIN_TELEGRAM_IDS),
  adminUsernames: parseList(process.env.ADMIN_USERNAMES, true),
  devUser: {
    telegramId: String(process.env.DEV_USER_ID ?? '9001'),
    username: process.env.DEV_USERNAME ?? 'local_tester',
    firstName: process.env.DEV_FIRST_NAME ?? 'Local',
    lastName: process.env.DEV_LAST_NAME ?? 'Tester',
    photoUrl: '',
  },
  dataDir: path.join(rootDir, 'data'),
  databasePath: path.join(rootDir, 'data', 'demo-stage.sqlite'),
  wavDir: path.join(rootDir, 'data', 'uploads', 'wav'),
  mp3Dir: path.join(rootDir, 'data', 'uploads', 'mp3'),
  avatarDir: path.join(rootDir, 'data', 'uploads', 'avatars'),
  coverDir: path.join(rootDir, 'data', 'uploads', 'covers'),
  publicDir: path.join(rootDir, 'public'),
  maxJsonBytes: 1_000_000,
  maxAudioBytes: 60 * 1024 * 1024,
  maxAvatarBytes: 5 * 1024 * 1024,
  maxCoverBytes: 5 * 1024 * 1024,
};

export function isAdminIdentity(identity) {
  const telegramId = String(identity?.telegramId ?? identity?.telegram_id ?? '');
  const username = String(identity?.username ?? '').trim().toLowerCase();

  return config.adminTelegramIds.has(telegramId) || (username ? config.adminUsernames.has(username) : false);
}
