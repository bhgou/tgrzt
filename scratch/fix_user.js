import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = path.resolve('data', 'demo-stage.sqlite');
const db = new DatabaseSync(dbPath);

const result = db.prepare("UPDATE users SET is_registered = 1, role = 'artist' WHERE telegram_id = '9001'").run();
console.log('Update result:', result);

if (result.changes === 0) {
  // User 9001 might not exist yet, let's create them
  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, is_registered, role, created_at, updated_at)
    VALUES ('9001', 'local_tester', 'Local', 1, 'artist', datetime('now'), datetime('now'))
  `).run();
  console.log('User 9001 created.');
}
