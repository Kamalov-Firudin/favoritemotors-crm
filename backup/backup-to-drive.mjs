// backup/backup-to-drive.mjs
// Автобэкап: читает все таблицы Supabase через REST (сервисным ключом, минуя RLS —
// попадают и скрытые в корзину строки) и заливает один JSON-файл в папку Google Drive.
// Имя файла с датой-временем, предыдущие файлы НЕ перезаписываются.
//
// Надёжность (этап 0, 08.11.2026):
//  • keyset-пагинация по id (order=id.asc + id=gt.<последний>) — без пропусков/дублей и без лимита 1000;
//  • сверка с COUNT(*) до и после выгрузки — при расхождении скрипт падает (exit 1 → письмо от GitHub);
//  • manifest (строки, суммы денег по валютам, sha256 таблиц) — ВНУТРИ файла, не в логах;
//  • шифрование age публичным ключом (включается переменной BACKUP_ENCRYPT=1).
//
// ЛОГИ ПУБЛИЧНЫЕ (репозиторий открытый): печатаем только имена таблиц, количества строк и статусы.
// Никаких сумм, email, паспортов, содержимого строк.
//
// Переменные окружения:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY                       — обязательно
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID — для загрузки в Drive
//   BACKUP_ENCRYPT=1 + AGE_RECIPIENT=age1...                 — шифровать (публичный ключ, не секретный)
//   BACKUP_DRY_RUN=1                                         — не грузить в Drive, записать файл в ./out/
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { BACKUP_TABLES, BACKUP_FORMAT_VERSION, buildManifest } from '../src/lib/backupManifest.js';

const env = process.env;
const PAGE = 1000;
const DRY = env.BACKUP_DRY_RUN === '1';
const ENCRYPT = env.BACKUP_ENCRYPT === '1';

function fail(msg) { console.error('❌ BACKUP FAILED:', msg); process.exit(1); }

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) fail('нет SUPABASE_URL / SUPABASE_SERVICE_KEY');
if (!DRY && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN || !env.DRIVE_FOLDER_ID)) fail('нет Google-секретов');
if (ENCRYPT && !/^age1[0-9a-z]+$/.test(env.AGE_RECIPIENT || '')) fail('BACKUP_ENCRYPT=1, но AGE_RECIPIENT пустой или не похож на публичный ключ age1…');

const base = env.SUPABASE_URL.replace(/\/+$/, '');
const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };

// Текст ошибки API обрезаем и не печатаем тело целиком (там не должно быть данных, но страхуемся).
async function apiError(t, res) {
  const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
  return new Error(`таблица ${t}: HTTP ${res.status} ${body}`);
}

// COUNT(*) через заголовок Content-Range (Prefer: count=exact), без выгрузки строк.
async function countRows(t) {
  const res = await fetch(`${base}/rest/v1/${t}?select=id`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } });
  if (!res.ok) throw await apiError(t, res);
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`таблица ${t}: сервер не вернул COUNT`);
  return total;
}

// Keyset-пагинация: стабильна даже если во время выгрузки добавляются строки.
async function dumpTable(t) {
  let all = [], last = null;
  for (;;) {
    const filter = last === null ? '' : `&id=gt.${encodeURIComponent(last)}`;
    const res = await fetch(`${base}/rest/v1/${t}?select=*&order=id.asc&limit=${PAGE}${filter}`, { headers });
    if (!res.ok) throw await apiError(t, res);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`таблица ${t}: неожиданный ответ API`);
    all = all.concat(rows);
    if (rows.length < PAGE) break;
    const nextLast = rows[rows.length - 1].id;
    if (nextLast === undefined || nextLast === last) throw new Error(`таблица ${t}: пагинация не продвигается (нет id?)`);
    last = nextLast;
  }
  const ids = new Set(all.map((r) => String(r.id)));
  if (ids.size !== all.length) throw new Error(`таблица ${t}: дубли id в выгрузке`);
  return all;
}

const sha256Hex = async (s) => createHash('sha256').update(s).digest('hex');

async function encryptAge(text) {
  const { Encrypter } = await import('age-encryption');
  const e = new Encrypter();
  e.addRecipient(env.AGE_RECIPIENT);
  return Buffer.from(await e.encrypt(text));
}

async function main() {
  const backup = { version: BACKUP_FORMAT_VERSION, exported_at: new Date().toISOString(), source: 'github-actions', tables: {} };
  let allOk = true;
  for (const t of BACKUP_TABLES) {
    const before = await countRows(t);
    const rows = await dumpTable(t);
    const after = await countRows(t);
    const lo = Math.min(before, after), hi = Math.max(before, after);
    const ok = rows.length >= lo && rows.length <= hi;
    if (!ok) allOk = false;
    backup.tables[t] = rows;
    console.log(`  ${t}: ${rows.length} строк · COUNT ${before === after ? before : `${before}→${after}`} · ${ok ? 'сверка OK' : 'РАСХОЖДЕНИЕ'}`);
  }
  if (!allOk) fail('число выгруженных строк не совпало с COUNT(*) — файл НЕ загружен');

  const totalRows = Object.values(backup.tables).reduce((s, a) => s + a.length, 0);
  if (totalRows === 0) fail('все таблицы пусты — не загружаю пустой бэкап (проверь, что ключ именно service_role/secret)');
  backup.manifest = await buildManifest(backup.tables, sha256Hex);
  const json = JSON.stringify(backup);

  const payload = ENCRYPT ? await encryptAge(json) : Buffer.from(json, 'utf8');
  const local = new Date(Date.now() + 3 * 3600 * 1000); // имя файла по времени UTC+3
  const stamp = local.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filename = `favoritemotors-backup-${stamp}.json${ENCRYPT ? '.age' : ''}`;

  if (DRY) {
    mkdirSync('out', { recursive: true });
    writeFileSync(`out/${filename}`, payload);
    console.log(`✅ DRY RUN: записан out/${filename} (${payload.length} байт, всего ${totalRows} строк, шифрование: ${ENCRYPT ? 'да' : 'нет'})`);
    return;
  }

  const { google } = await import('googleapis');
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth });
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [env.DRIVE_FOLDER_ID] },
    media: { mimeType: ENCRYPT ? 'application/octet-stream' : 'application/json', body: Readable.from([payload]) },
    fields: 'id,name,size',
  });
  console.log(`✅ Загружено: ${res.data.name} (${res.data.size} байт, всего ${totalRows} строк, шифрование: ${ENCRYPT ? 'да' : 'нет'})`);
}

main().catch((e) => fail(e.message || String(e)));
