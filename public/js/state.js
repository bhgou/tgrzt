export const state = {
  me: null,
  activeView: 'home',
  searchQuery: '',
  searchResults: { artists: [], tracks: [] },
  featuredTracks: [],
  latestTracks: [],
  topArtists: [],
  popularArtists: [],
  activeBattles: [],
  hallOfFame: { recentWinners: [] },
  genres: [],
  news: [],
  banners: [],
  history: ['home'],
  platformStats: {},
  botUsername: '',
  supportTelegramId: '',
  
  // Player state
  player: {
    track: null,
    isPlaying: false,
    progress: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    audio: new Audio(),
  },
  
  // UI state
  loading: true,
  isRefreshing: false,
  error: null,
  pending: false,
  pendingInviteCode: null,
};
