import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { httpError } from './utils.js';

const uploadFolders = {
  wav: config.wavDir,
  mp3: config.mp3Dir,
  avatars: config.avatarDir,
};

let ffmpegCheckPromise;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

export async function ensureDirectories() {
  await Promise.all(Object.values(uploadFolders).map((folder) => fs.mkdir(folder, { recursive: true })));
}

export function toPublicMediaUrl(relativePath) {
  if (!relativePath) {
    return null;
  }

  return `/media/${toPosixPath(relativePath).replace(/^\/+/, '')}`;
}

export function resolveMediaPath(relativePath) {
  const sanitized = String(relativePath || '').replace(/^\/+/, '');
  const absolutePath = path.resolve(config.dataDir, sanitized);

  if (!absolutePath.startsWith(config.dataDir)) {
    throw httpError(400, 'Некорректный путь к медиафайлу.');
  }

  return absolutePath;
}

export async function detectFfmpeg() {
  if (!ffmpegCheckPromise) {
    ffmpegCheckPromise = new Promise((resolve) => {
      const child = spawn('ffmpeg', ['-version']);

      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
  }

  return ffmpegCheckPromise;
}

export async function saveUploadedFile(file, folderName, options = {}) {
  if (!(file instanceof File)) {
    throw httpError(400, 'Файл не был передан.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxBytes = options.maxBytes ?? config.maxAudioBytes;

  if (buffer.byteLength > maxBytes) {
    throw httpError(413, 'Файл превышает допустимый размер.');
  }

  const sourceExtension = path.extname(file.name || '').toLowerCase();
  const extension = options.forceExtension ?? sourceExtension;

  if (options.allowedExtensions && !options.allowedExtensions.includes(extension)) {
    throw httpError(400, `Недопустимый формат файла: ${extension || 'без расширения'}.`);
  }

  const safeFileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const targetDirectory = uploadFolders[folderName];

  if (!targetDirectory) {
    throw httpError(500, 'Неизвестная папка загрузки.');
  }

  const absolutePath = path.join(targetDirectory, safeFileName);
  await fs.writeFile(absolutePath, buffer);

  return {
    absolutePath,
    relativePath: path.join('uploads', folderName, safeFileName),
  };
}

export async function convertWavToMp3(sourceAbsolutePath) {
  const ffmpegReady = await detectFfmpeg();

  if (!ffmpegReady) {
    throw httpError(500, 'На сервере не найден ffmpeg. Установи ffmpeg, чтобы конвертировать WAV в MP3.');
  }

  const targetName = `${path.basename(sourceAbsolutePath, path.extname(sourceAbsolutePath))}.mp3`;
  const targetAbsolutePath = path.join(config.mp3Dir, targetName);

  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i',
      sourceAbsolutePath,
      '-vn',
      '-codec:a',
      'libmp3lame',
      '-qscale:a',
      '2',
      targetAbsolutePath,
    ]);

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      reject(httpError(500, `Не удалось запустить ffmpeg: ${error.message}`));
    });

    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(httpError(500, `ffmpeg завершился с ошибкой. ${stderr.trim() || 'Проверь WAV-файл.'}`));
    });
  });

  return {
    absolutePath: targetAbsolutePath,
    relativePath: path.join('uploads', 'mp3', targetName),
  };
}

export async function removeStoredFile(relativePath) {
  if (!relativePath) {
    return;
  }

  const absolutePath = resolveMediaPath(relativePath);
  await fs.rm(absolutePath, { force: true });
}

export function createFileStream(filePath) {
  return createReadStream(filePath);
}
