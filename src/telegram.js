import { setTimeout as delay } from 'node:timers/promises';

export class TelegramBotService {
  constructor(config) {
    this.config = config;
    this.offset = 0;
    this.running = false;
    this.botInfo = null;
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
    const lines = [
      `Demo Stage готов для загрузки демок и оценки треков${firstName ? `, ${firstName}` : ''}.`,
      '',
      'Что умеет приложение:',
      '• лента свежих и рейтинговых треков',
      '• поиск артистов',
      '• личный кабинет и профиль',
      '• загрузка WAV с прослушиванием в MP3',
      '• лайки, комментарии и подписки',
    ];

    if (!hasPublicWebApp) {
      lines.push('');
      lines.push('Mini App кнопка появится после того, как APP_BASE_URL будет заменён на публичный HTTPS-адрес.');
    }

    const replyMarkup = hasPublicWebApp
      ? {
          keyboard: [
            [
              {
                text: 'Открыть Demo Stage',
                web_app: { url: this.config.appBaseUrl },
              },
            ],
          ],
          resize_keyboard: true,
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
  }

  stop() {
    this.running = false;
  }
}
