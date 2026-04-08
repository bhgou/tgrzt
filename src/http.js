import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createFileStream } from './storage.js';
import { httpError } from './utils.js';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
};

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export function sendText(res, statusCode, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readRawBody(req, limitBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;

    if (totalBytes > limitBytes) {
      throw httpError(413, 'Тело запроса слишком большое.');
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export async function readJson(req, limitBytes) {
  const buffer = await readRawBody(req, limitBytes);

  if (!buffer.length) {
    return {};
  }

  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch (error) {
    throw httpError(400, `Некорректный JSON: ${error.message}`);
  }
}

export async function readFormData(req, limitBytes) {
  const contentLength = Number(req.headers['content-length'] || 0);

  if (contentLength && contentLength > limitBytes) {
    throw httpError(413, 'Форма превышает допустимый размер.');
  }

  const request = new Request('http://localhost', {
    method: req.method,
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  });

  return request.formData();
}

export async function serveFile(res, filePath) {
  const stats = await fs.stat(filePath).catch(() => null);

  if (!stats || !stats.isFile()) {
    throw httpError(404, 'Файл не найден.');
  }

  const extension = path.extname(filePath).toLowerCase();
  const stream = createFileStream(filePath);
  const noStoreExtensions = new Set(['.html', '.js', '.css']);

  res.writeHead(200, {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': noStoreExtensions.has(extension) ? 'no-store' : 'public, max-age=3600',
  });

  stream.on('error', (error) => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message });
    } else {
      res.destroy(error);
    }
  });

  stream.pipe(res);
}
