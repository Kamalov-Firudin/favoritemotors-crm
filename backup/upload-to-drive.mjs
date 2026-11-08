// backup/upload-to-drive.mjs — загрузить готовый файл (зашифрованный дамп) в папку Google Drive.
// Использование: node upload-to-drive.mjs <путь_к_файлу>
// Секреты — те же, что у backup-to-drive.mjs (GOOGLE_*, DRIVE_FOLDER_ID). В лог: только имя и размер.
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';

const env = process.env;
function fail(msg) { console.error('❌ UPLOAD FAILED:', msg); process.exit(1); }

const path = process.argv[2];
if (!path) fail('не указан файл');
if (!path.endsWith('.age')) fail('загружаются только зашифрованные файлы (.age)');
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN || !env.DRIVE_FOLDER_ID) fail('нет Google-секретов');

const { google } = await import('googleapis');
const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth });
try {
  const res = await drive.files.create({
    requestBody: { name: basename(path), parents: [env.DRIVE_FOLDER_ID] },
    media: { mimeType: 'application/octet-stream', body: createReadStream(path) },
    fields: 'id,name,size',
  });
  console.log(`✅ Загружено: ${res.data.name} (${res.data.size ?? statSync(path).size} байт)`);
} catch (e) {
  fail(e.message || String(e));
}
