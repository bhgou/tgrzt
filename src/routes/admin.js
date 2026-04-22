import { 
  getAllUsers, 
  setUserBan, 
  getAllTracks, 
  adminDeleteTrack, 
  addNews, 
  deleteNews, 
  addBanner,
  getAllBanners,
  updateBanner,
  deleteBanner,
  adminCreateBattle,
  resolveDailyBattles,
  createDailyBattles,
  getWeeklySummary,
  markWeeklySummaryPosted,
  getBootstrapData,
  getAllNews
} from '../database.js';
import { sendJson, readJson } from '../http.js';
import { trimText, httpError } from '../utils.js';
import { config } from '../config.js';
import { mapUserForClient } from '../mappings.js';

export async function handleAdminRequest(req, res, pathname, sessionUser) {
  // Security check
  if (!sessionUser?.isAdmin) {
    throw httpError(403, 'Только для администраторов.');
  }

  if (req.method === 'GET' && pathname === '/api/admin/bootstrap') {
    console.log('[admin] /api/admin/bootstrap called, sessionUser:', sessionUser);
    const data = getBootstrapData(sessionUser.id);
    sendJson(res, 200, {
      me: mapUserForClient(data.me),
      news: getAllNews(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/users') {
    sendJson(res, 200, { users: getAllUsers() });
    return;
  }

  const banMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (req.method === 'POST' && banMatch) {
    const body = await readJson(req, config.maxJsonBytes);
    const user = setUserBan(banMatch[1], body.isBanned);
    sendJson(res, 200, { ok: true, user });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/tracks') {
    sendJson(res, 200, { tracks: getAllTracks() });
    return;
  }

  const deleteTrackMatch = pathname.match(/^\/api\/admin\/tracks\/(\d+)$/);
  if (req.method === 'DELETE' && deleteTrackMatch) {
    const track = adminDeleteTrack(deleteTrackMatch[1]);
    sendJson(res, 200, { ok: true, track });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/news') {
    const body = await readJson(req, config.maxJsonBytes);
    const news = addNews(body.title, body.body);
    sendJson(res, 200, { ok: true, news });
    return;
  }

  const deleteNewsMatch = pathname.match(/^\/api\/admin\/news\/(\d+)$/);
  if (req.method === 'DELETE' && deleteNewsMatch) {
    deleteNews(deleteNewsMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/banners') {
    sendJson(res, 200, { banners: getAllBanners() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/banners') {
    const body = await readJson(req, config.maxJsonBytes);
    const banner = addBanner(body);
    sendJson(res, 200, { ok: true, banner });
    return;
  }

  const bannerMatch = pathname.match(/^\/api\/admin\/banners\/(\d+)$/);
  if (req.method === 'PATCH' && bannerMatch) {
    const body = await readJson(req, config.maxJsonBytes);
    updateBanner(bannerMatch[1], body);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'DELETE' && bannerMatch) {
    deleteBanner(bannerMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/battles/create') {
    const body = await readJson(req, config.maxJsonBytes);
    const battle = adminCreateBattle(body.genre, body.trackAId, body.trackBId, body.hours);
    sendJson(res, 200, { ok: true, battle });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/battles/trigger') {
    const resolvedCount = resolveDailyBattles();
    const createdCount = createDailyBattles().length;
    sendJson(res, 200, { ok: true, resolvedCount, createdCount });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/weekly-summary') {
    const summary = getWeeklySummary();
    // Note: telegramBot is passed in or we use a service. 
    // For now, I'll keep the bot logic in server.js or a separate service.
    // I'll return the summary so server.js can handle the telegram part.
    return { type: 'weekly-summary', summary };
  }

  throw httpError(404, 'Admin API route not found.');
}
