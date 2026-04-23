import { setTimeout as delay } from 'node:timers/promises';
import { getWeeklySummary, hasWeeklySummaryPosted, markWeeklySummaryPosted } from './database.js';

export class TelegramBotService {
  constructor(config) {
    this.config = config;
    this.offset = 0;
    this.running = false;
    this.botInfo = null;
    this.weeklyCronTimer = null;
  }

  async api(method, payload = {}) {
    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.description || `Telegram API error on ${method}`);
    }

    return data.result;
  }

  async syncCommands() {
    await this.api('setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть Demo Stage' },
        { command: 'app', description: 'Открыть приложение' },
      ],
    });

    if (this.config.appBaseUrl.startsWith('https://')) {
      await this.api('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Demo Stage',
          web_app: {
            url: this.config.appBaseUrl,
          },
        },
      }).catch(() => {});
    }
  }

  async sendOpenAppMessage(chatId, firstName = '') {
    const hasPublicWebApp = this.config.appBaseUrl.startsWith('https://');
    const greeting = firstName ? `Привет, ${firstName}! 👋` : 'Привет! 👋';

    const lines = [
      greeting,
      '',
      '🎵 Demo Stage — платформа для музыкантов и любителей музыки.',
      'Здесь артисты публикуют демки, а слушатели оценивают их и дают фидбек.',
      '',
      '— Что умеет приложение:',
      '',
      '🎧 Лента треков — свежие и топовые релизы прямо в ленте',
      '🔍 Поиск артистов — находи и подписывайся на новых авторов',
      '⬆️ Загрузка демок — WAV или MP3, сервер сам конвертирует',
      '⭐ Рейтинги — оценки от 1 до 10 и честный топ лучших треков',
      '💬 Комментарии — оставляй развёрнутый фидбек под треком',
      '❤️ Избранное — сохраняй треки которые понравились',
      '👥 Подписки — следи за артистами и их новыми релизами',
      '🤝 Инвайты — приглашай друзей и получай бонусные прослушивания',
      '📊 Еженедельный топ — итоги недели каждое воскресенье',
      '',
      `🌐 Сайт: ${this.config.appBaseUrl}/landing.html`,
    ];

    if (!hasPublicWebApp) {
      lines.push('');
      lines.push('ℹ️ Mini App кнопка появится после настройки публичного HTTPS-адреса.');
    }

    const replyMarkup = hasPublicWebApp
      ? {
          inline_keyboard: [
            [
              {
                text: '🎵 Открыть Demo Stage',
                web_app: { url: this.config.appBaseUrl },
              },
            ],
            [
              {
                text: '🌐 Открыть сайт',
                url: `${this.config.appBaseUrl}/landing.html`,
              },
            ],
          ],
        }
      : undefined;

    await this.api('sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      reply_markup: replyMarkup,
    });
  }

  async handleMessage(message) {
    const text = message.text?.trim().toLowerCase();

    if (text === '/start' || text === '/app' || text === 'открыть demo stage') {
      await this.sendOpenAppMessage(message.chat.id, message.from?.first_name ?? '');
      return;
    }

    const fileName = message.document?.file_name?.toLowerCase();

    if (fileName?.endsWith('.wav')) {
      await this.api('sendMessage', {
        chat_id: message.chat.id,
        text: 'WAV лучше загружать через Mini App: там файл автоматически конвертируется в MP3, а трек попадает в каталог.',
      });
      return;
    }

    await this.api('sendMessage', {
      chat_id: message.chat.id,
      text: 'Используй /start, чтобы открыть Mini App и работать с треками в удобном интерфейсе.',
    });
  }

  async pollLoop() {
    while (this.running) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;

          if (update.message) {
            await this.handleMessage(update.message);
          }
        }
      } catch (error) {
        console.error('[telegram] poll error:', error.message);
        await delay(3_000);
      }
    }
  }

  async start() {
    if (!this.config.botToken) {
      console.log('[telegram] BOT_TOKEN is empty, bot polling is disabled.');
      return;
    }

    this.running = true;
    this.botInfo = await this.api('getMe');
    await this.syncCommands();
    console.log(`[telegram] connected as @${this.botInfo.username}`);
    void this.pollLoop();
    this.startWeeklyCron();
  }

  stop() {
    this.running = false;
    if (this.weeklyCronTimer) {
      clearInterval(this.weeklyCronTimer);
      this.weeklyCronTimer = null;
    }
  }

  // ============== WEEKLY SUMMARY ==============

  formatWeeklySummaryText(summary) {
    const lines = [];
    lines.push('📊 Итоги недели на Demo Stage');
    lines.push('');
    if (summary.topTracks.length) {
      lines.push('🏆 Топ-3 трека недели:');
      summary.topTracks.forEach((track, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`;
        lines.push(`${medal} «${track.title}» — ${track.artistName} (${track.weekPlays} прослушиваний)`);
      });
    } else {
      lines.push('На этой неделе пока тихо — треков не прослушали.');
    }
    lines.push('');
    lines.push(`🎧 Всего за неделю: ${summary.totalPlays} прослушиваний`);
    if (summary.editorsPick) {
      lines.push('');
      lines.push(`✨ Выбор редакции: «${summary.editorsPick.title}» — ${summary.editorsPick.artistName}`);
    }
    return lines.join('\n');
  }

  async sendWeeklySummary(summary = null) {
    if (!this.config.channelId) {
      return { ok: false, error: 'CHANNEL_ID не настроен.' };
    }
    const data = summary || getWeeklySummary();
    const text = this.formatWeeklySummaryText(data);
    await this.api('sendMessage', {
      chat_id: this.config.channelId,
      text,
      disable_web_page_preview: true,
    });
    return { ok: true };
  }

  startWeeklyCron() {
    if (this.weeklyCronTimer || !this.config.channelId) return;
    // Check every hour — auto-post on Sunday at 18:00 UTC (configurable later)
    const tick = async () => {
      try {
        const now = new Date();
        const isSunday = now.getUTCDay() === 0;
        const hour = now.getUTCHours();
        if (!isSunday || hour < 18) return;
        if (hasWeeklySummaryPosted()) return;
        const summary = getWeeklySummary();
        const result = await this.sendWeeklySummary(summary);
        if (result.ok) {
          markWeeklySummaryPosted(summary.weekStart);
          console.log('[telegram] weekly summary posted for week', summary.weekStart);
        }
      } catch (error) {
        console.error('[telegram] weekly cron error:', error.message);
      }
    };
    this.weeklyCronTimer = setInterval(tick, 60 * 60 * 1000);
    // Запустим сразу при старте (на случай пропущенного воскресенья)
    setTimeout(tick, 5_000).unref?.();
  }
}
