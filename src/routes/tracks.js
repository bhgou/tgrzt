import { 
  createTrack, 
  deleteTrack, 
  toggleLike, 
  upsertRating, 
  addComment, 
  addTrackPlay,
  addTrackRepost,
  searchCatalog,
  getArtistProfile
} from '../database.js';
import { sendJson, readFormData, readJson } from '../http.js';
import { trimText, httpError } from '../utils.js';
import { saveUploadedFile, removeStoredFile, toPublicMediaUrl, convertWavToMp3 } from '../storage.js';
import { config } from '../config.js';
import { mapArtistForClient, mapTrackForClient } from '../mappings.js';

export async function handleTrackRequest(req, res, pathname, sessionUser) {
  if (req.method === 'GET' && pathname === '/api/search') {
    const url = new URL(req.url, config.appBaseUrl);
    const results = searchCatalog(url.searchParams.get('q') || '', sessionUser.id);
    sendJson(res, 200, {
      artists: results.artists.map(mapArtistForClient),
      tracks: results.tracks.map(mapTrackForClient),
    });
    return;
  }

  const artistProfileMatch = pathname.match(/^\/api\/artists\/(\d+)$/);
  if (req.method === 'GET' && artistProfileMatch) {
    const profile = getArtistProfile(artistProfileMatch[1], sessionUser.id);
    sendJson(res, 200, {
      artist: mapArtistForClient(profile.artist),
      tracks: profile.tracks.map(mapTrackForClient),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tracks') {
    const formData = await readFormData(req, config.maxAudioBytes);
    const wavFile = formData.get('track');
    const coverFile = formData.get('cover');

    if (!(wavFile instanceof File) || wavFile.size === 0) {
      throw httpError(400, 'Нужно приложить WAV-файл.');
    }

    let wavUpload = null;
    let mp3Upload = null;
    let coverUpload = null;

    try {
      wavUpload = await saveUploadedFile(wavFile, 'wav', {
        allowedExtensions: ['.wav'],
        maxBytes: config.maxAudioBytes,
      });

      mp3Upload = await convertWavToMp3(wavUpload.absolutePath);

      if (coverFile instanceof File && coverFile.size > 0) {
        coverUpload = await saveUploadedFile(coverFile, 'covers', {
          allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
          maxBytes: config.maxAvatarBytes,
        });
      }

      const track = createTrack(sessionUser.id, {
        title: trimText(formData.get('title'), 80),
        description: trimText(formData.get('description'), 500),
        genre: trimText(formData.get('genre'), 40),
        wavPath: wavUpload.relativePath,
        mp3Path: mp3Upload.relativePath,
        coverPath: coverUpload?.relativePath || null,
      });

      sendJson(res, 200, { ok: true, track: mapTrackForClient(track) });
    } catch (error) {
      if (wavUpload?.relativePath) await removeStoredFile(wavUpload.relativePath).catch(() => {});
      if (mp3Upload?.relativePath) await removeStoredFile(mp3Upload.relativePath).catch(() => {});
      if (coverUpload?.relativePath) await removeStoredFile(coverUpload.relativePath).catch(() => {});
      throw error;
    }
    return;
  }

  const trackIdMatch = pathname.match(/^\/api\/tracks\/(\d+)$/);
  if (req.method === 'DELETE' && trackIdMatch) {
    const deleted = deleteTrack(sessionUser.id, trackIdMatch[1]);
    await removeStoredFile(deleted.wavPath).catch(() => {});
    await removeStoredFile(deleted.mp3Path).catch(() => {});
    if (deleted.coverPath) await removeStoredFile(deleted.coverPath).catch(() => {});
    sendJson(res, 200, { ok: true, ...deleted });
    return;
  }

  const likeMatch = pathname.match(/^\/api\/tracks\/(\d+)\/like$/);
  if (req.method === 'POST' && likeMatch) {
    sendJson(res, 200, { ok: true, ...toggleLike(sessionUser.id, likeMatch[1]) });
    return;
  }

  const rateMatch = pathname.match(/^\/api\/tracks\/(\d+)\/rate$/);
  if (req.method === 'POST' && rateMatch) {
    const body = await readJson(req, config.maxJsonBytes);
    sendJson(res, 200, { ok: true, ...upsertRating(sessionUser.id, rateMatch[1], body.score) });
    return;
  }

  const commentMatch = pathname.match(/^\/api\/tracks\/(\d+)\/comments$/);
  if (req.method === 'POST' && commentMatch) {
    const body = await readJson(req, config.maxJsonBytes);
    sendJson(res, 200, { ok: true, ...addComment(sessionUser.id, commentMatch[1], body.body) });
    return;
  }

  const playMatch = pathname.match(/^\/api\/tracks\/(\d+)\/play$/);
  if (req.method === 'POST' && playMatch) {
    sendJson(res, 200, { ok: true, ...addTrackPlay(sessionUser.id, playMatch[1]) });
    return;
  }

  const repostMatch = pathname.match(/^\/api\/tracks\/(\d+)\/repost$/);
  if (req.method === 'POST' && repostMatch) {
    sendJson(res, 200, { ok: true, ...addTrackRepost(sessionUser.id, repostMatch[1]) });
    return;
  }
}
