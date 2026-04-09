import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('E:/github/ArFintes2/tgrzt/data/demo-stage.sqlite');

const users = db.prepare('SELECT id, telegram_id, nickname, role, is_registered, created_at FROM users ORDER BY id').all();

console.log('\n=== ПОЛЬЗОВАТЕЛИ ===\n');
console.log(`Найдено пользователей: ${users.length}\n`);

for (const user of users) {
  console.log(`ID: ${user.id}`);
  console.log(`  Telegram ID: ${user.telegram_id}`);
  console.log(`  Nickname: ${user.nickname || '(нет)'}`);
  console.log(`  Role: ${user.role}`);
  console.log(`  Registered: ${user.is_registered ? 'Да' : 'Нет'}`);
  console.log(`  Created: ${user.created_at}`);
  console.log('');
}

const tracks = db.prepare('SELECT id, owner_id, title FROM tracks').all();
console.log(`\n=== ТРЕКИ (${tracks.length}) ===\n`);
for (const track of tracks) {
  console.log(`Track ID: ${track.id}, Owner: ${track.owner_id}, Title: ${track.title}`);
}

const adminSettings = db.prepare('SELECT * FROM admin_settings').all();
console.log(`\n\n=== ADMIN SETTINGS ===\n`);
for (const setting of adminSettings) {
  console.log(`Key: ${setting.key}`);
  console.log(`  Value: ${setting.value}`);
  console.log('');
}
