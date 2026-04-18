import { 
  getBootstrapData, 
  getUserById, 
  registerUser, 
  updateProfile,
  upsertTelegramUser
} from '../database.js';
import { sendJson, readFormData } from '../http.js';
import { trimText } from '../utils.js';
import { saveUploadedFile, removeStoredFile, toPublicMediaUrl } from '../storage.js';
import { config } from '../config.js';
import { httpError } from '../utils.js';
import { mapUserForClient } from '../mappings.js';

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

export async function handleAuthRequest(req, res, pathname, sessionUser) {
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

  if (req.method === 'POST' && (pathname === '/api/register' || pathname === '/api/profile')) {
    const isRegister = pathname === '/api/register';
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

      const updateData = {
        role: payload.role || previousUser.role,
        nickname: payload.nickname || previousUser.nickname,
        bio: payload.bio,
        avatarPath: avatarUpload?.relativePath ?? previousUser.avatarPath,
      };

      const updatedUser = isRegister 
        ? registerUser(sessionUser.id, updateData)
        : updateProfile(sessionUser.id, updateData);

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
}
