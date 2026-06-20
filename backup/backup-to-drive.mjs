// backup/backup-to-drive.mjs
// Читает все таблицы из Supabase (сервисным ключом, минуя RLS — попадают и скрытые
// строки) и заливает один JSON-файл в папку Google Drive. Имя файла с датой-временем,
// предыдущие НЕ перезаписываются. При любой ошибке выходит с кодом 1 — тогда GitHub
// присылает письмо о провале.
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Readable } from 'node:stream';

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
} = process.env;

const TABLES = ['cars', 'clients', 'rentals', 'car_expenses', 'office_expenses', 'maintenance', 'audit_log', 'profiles'];
const PAGE = 1000;

function fail(msg) { console.error('❌ BACKUP FAILED:', msg); process.exit(1); }

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) fail('нет SUPABASE_URL / SUPABASE_SERVICE_KEY');
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !DRIVE_FOLDER_ID) fail('нет Google-секретов');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

async function dumpTable(t) {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await supabase.from(t).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`таблица ${t}: ${error.message}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const backup = { version: 2, exported_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    backup.tables[t] = await dumpTable(t);
    console.log(`  ${t}: ${backup.tables[t].length} строк`);
  }
  const totalRows = Object.values(backup.tables).reduce((s, a) => s + a.length, 0);
  if (totalRows === 0) fail('все таблицы пусты — не загружаю пустой бэкап');

  const json = JSON.stringify(backup, null, 2);

  // имя файла с локальным временем UTC+3
  const local = new Date(Date.now() + 3 * 3600 * 1000);
  const stamp = local.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filename = `favoritemotors-backup-${stamp}.json`;

  const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth });

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
    media: { mimeType: 'application/json', body: Readable.from([json]) },
    fields: 'id,name,size',
  });
  console.log(`✅ Загружено: ${res.data.name} (id=${res.data.id}, ${res.data.size} байт, всего ${totalRows} строк)`);
}

main().catch(e => fail(e.message || String(e)));
