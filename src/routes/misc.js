import { 
  getBootstrapData, 
  getSupportMessages, 
  addSupportMessage,
  getInviteStats,
  claimInvite,
  getTopInviters,
  getActiveBattles,
  getHallOfFame,
  getAllNews
} from '../database.js';
import { sendJson, readJson } from '../http.js';
import { toPublicMediaUrl } from '../storage.js';
import { config } from '../config.js';
import { mapArtistForClient, mapTrackForClient, mapUserForClient } from '../mappings.js';

export async function handleMiscRequest(req, res, pathname, sessionUser, telegramBot, ffmpegReady) {
  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const data = getBootstrapData(sessionUser.id);
    const inviteStats = getInviteStats(sessionUser.id);
    const topInviters = getTopInviters(20).map((inv) => ({
      ...inv,
      avatarUrl: inv.avatarPath ? toPublicMediaUrl(inv.avatarPath) : null,
    }));

    const battles = getActiveBattles(sessionUser.id).map((b) => ({
      ...b,
      trackA: mapTrackForClient(b.trackA),
      trackB: mapTrackForClient(b.trackB),
    }));

    const hallOfFameData = getHallOfFame();
    hallOfFameData.recentWinners = hallOfFameData.recentWinners.map(w => ({
      ...w,
      coverUrl: w.coverPath ? toPublicMediaUrl(w.coverPath) : null,
      mp3Url: toPublicMediaUrl(w.mp3Path)
    }));

    sendJson(res, 200, {
      me: mapUserForClient(data.me),
      featuredTracks: data.featuredTracks.map(mapTrackForClient),
      latestTracks: data.latestTracks.map(mapTrackForClient),
      topArtists: data.topArtists.map(mapArtistForClient),
      platformStats: data.platformStats,
      news: getAllNews(),
      inviteCode: inviteStats.code,
      topInviters,
      genres: config.genres,
      activeBattles: battles,
      hallOfFame: hallOfFameData,
      botUsername: telegramBot.botInfo?.username || '',
      capabilities: {
        ffmpegReady,
        botConfigured: Boolean(config.botToken),
      },
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/battles') {
    const battles = getActiveBattles(sessionUser.id).map((b) => ({
      ...b,
      trackA: mapTrackForClient(b.trackA),
      trackB: mapTrackForClient(b.trackB),
    }));
    sendJson(res, 200, { battles });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/support/messages') {
    sendJson(res, 200, {
      messages: getSupportMessages(sessionUser.id),
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/support/messages') {
    const body = await readJson(req, config.maxJsonBytes);
    sendJson(res, 200, {
      ok: true,
      messages: addSupportMessage(sessionUser.id, body.body),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/invite/me') {
    const stats = getInviteStats(sessionUser.id);
    const botUsername = telegramBot.botInfo?.username || '';
    const inviteLink = botUsername
      ? `https://t.me/${botUsername}/app?startapp=${stats.code}`
      : `${config.appBaseUrl}?invite=${stats.code}`;
    sendJson(res, 200, { ...stats, inviteLink, botUsername });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/invite/claim') {
    const body = await readJson(req, config.maxJsonBytes);
    const result = claimInvite(sessionUser.id, body.code);
    sendJson(res, 200, { ok: result.ok, ...result });
    return true;
  }
}
