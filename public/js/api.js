export async function api(url, options = {}) {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';

  const headers = {
    'Authorization': `TelegramMiniApp ${initData}`,
    ...(options.headers || {}),
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}
