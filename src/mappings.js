import { toPublicMediaUrl } from './storage.js';

export function mapArtistForClient(artist) {
  if (!artist) return null;
  return {
    ...artist,
    avatarUrl: artist.avatarPath ? toPublicMediaUrl(artist.avatarPath) : null,
  };
}

export function mapTrackForClient(track) {
  if (!track) return null;
  return {
    ...track,
    coverUrl: track.coverPath ? toPublicMediaUrl(track.coverPath) : null,
    wavUrl: track.wavPath ? toPublicMediaUrl(track.wavPath) : null,
    mp3Url: track.mp3Path ? toPublicMediaUrl(track.mp3Path) : null,
    artist: track.artist ? {
      ...track.artist,
      avatarUrl: track.artist.avatarPath ? toPublicMediaUrl(track.artist.avatarPath) : null,
    } : null,
    comments: (track.comments || []).map((comment) => ({
      ...comment,
      user: comment.user ? {
        ...comment.user,
        avatarUrl: comment.user.avatarPath ? toPublicMediaUrl(comment.user.avatarPath) : null,
      } : null,
    })),
  };
}

export function mapUserForClient(user) {
  if (!user) return null;
  return {
    ...user,
    avatarUrl: user.avatarPath ? toPublicMediaUrl(user.avatarPath) : null,
    ownTracks: (user.ownTracks || []).map(mapTrackForClient),
    likedTracks: (user.likedTracks || []).map(mapTrackForClient),
  };
}
