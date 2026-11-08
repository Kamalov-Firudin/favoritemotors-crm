// src/lib/backup.js
// Ручной бэкап из CRM (кнопка «Скачать бэкап»). Только для администратора.
//
// Этап 0 (08.11.2026):
//  • все таблицы, включая payments и profiles (список общий с автобэкапом — backupManifest.js);
//  • keyset-пагинация по id — без молчаливого обрезания на ~1000 строк;
//  • сверка с COUNT(*) — при расхождении файл НЕ скачивается;
//  • manifest (строки, суммы денег, sha256) внутри файла — для сверки после восстановления.
//
// Файл НЕ зашифрован и содержит персональные данные клиентов (паспорта, телефоны).
import { supabase } from './supabase.js';
import { getMyRole } from './api.js';
import { BACKUP_TABLES, BACKUP_FORMAT_VERSION, buildManifest } from './backupManifest.js';

const PAGE = 1000;

async function countRows(table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`Ошибка подсчёта ${table}: ${error.message}`);
  return count ?? 0;
}

async function dumpTable(table) {
  let all = [], last = null;
  for (;;) {
    let query = supabase.from(table).select('*').order('id', { ascending: true }).limit(PAGE);
    if (last !== null) query = query.gt('id', last);
    const { data, error } = await query;
    if (error) throw new Error(`Ошибка при выгрузке ${table}: ${error.message}`);
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    const nextLast = data[data.length - 1].id;
    if (nextLast === undefined || nextLast === last) throw new Error(`Выгрузка ${table}: пагинация не продвигается`);
    last = nextLast;
  }
  return all;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function exportBackup() {
  // Проверка роли на стороне операции, а не только скрытие кнопки.
  // ЧЕСТНО: это защита интерфейса. Читать таблицы сотрудник может и так (RLS разрешает staff SELECT
  // ко всем рабочим таблицам — иначе CRM не работала бы). Настоящее ограничение — только через RLS.
  const role = await getMyRole();
  if (role !== 'admin') throw new Error('Скачать полный бэкап может только администратор.');

  const backup = { version: BACKUP_FORMAT_VERSION, exported_at: new Date().toISOString(), source: 'crm-button', tables: {} };
  const mismatches = [];
  for (const table of BACKUP_TABLES) {
    const before = await countRows(table);
    const rows = await dumpTable(table);
    const after = await countRows(table);
    if (rows.length < Math.min(before, after) || rows.length > Math.max(before, after)) mismatches.push(table);
    backup.tables[table] = rows;
  }
  if (mismatches.length) throw new Error(`Бэкап не скачан: число строк не совпало с базой (${mismatches.join(', ')}). Повторите позже.`);

  backup.manifest = await buildManifest(backup.tables, sha256Hex);

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `favoritemotors-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return backup.tables;
}
