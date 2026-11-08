// src/lib/backupManifest.js
// Общий для двух бэкапов (кнопка в CRM и автобэкап в GitHub Actions) список таблиц
// и «паспорт» бэкапа (manifest): сколько строк, суммы денег по валютам, контрольная сумма.
//
// ВАЖНО: manifest лежит ТОЛЬКО внутри файла бэкапа (который шифруется). В публичные логи
// GitHub Actions суммы и контрольные суммы НЕ выводятся — только количества строк и статус.
//
// Модуль без зависимостей и без JSX: импортируется и браузером (Vite), и Node.

// Порядок = порядок восстановления по внешним ключам (родители раньше детей).
// profiles восстанавливается отдельным шагом (его id = UUID пользователя Supabase Auth).
export const BACKUP_TABLES = [
  'cars',
  'clients',
  'rentals',
  'payments',
  'car_expenses',
  'office_expenses',
  'maintenance',
  'audit_log',
  'profiles',
];

// Денежные колонки (целые ×100) — для сверки сумм после восстановления.
export const MONEY_COLUMNS = {
  rentals: ['amount', 'paid', 'deposit', 'rental_price', 'daily_price', 'extra_fee'],
  payments: ['amount'],
  car_expenses: ['amount'],
  office_expenses: ['amount'],
};

export const BACKUP_FORMAT_VERSION = 3;

// Детерминированная сериализация: ключи объекта по алфавиту, строки по id.
// Нужна, чтобы контрольная сумма не зависела от порядка полей в ответе API.
export function canonicalRows(rows) {
  const sorted = [...rows].sort((a, b) => {
    const x = a?.id, y = b?.id;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  });
  return JSON.stringify(sorted.map((r) => {
    const o = {};
    for (const k of Object.keys(r).sort()) o[k] = r[k];
    return o;
  }));
}

// Суммы денежных колонок по валютам. BigInt — чтобы не терять точность на больших итогах.
// Результат — строки (BigInt в JSON не сериализуется).
export function moneySums(table, rows) {
  const cols = MONEY_COLUMNS[table];
  if (!cols) return null;
  const out = {};
  for (const col of cols) {
    const byCur = {};
    for (const r of rows) {
      const v = r[col];
      if (v === null || v === undefined || v === '') continue;
      const cur = r.currency || '(нет)';
      byCur[cur] = (byCur[cur] ?? 0n) + BigInt(Math.trunc(Number(v)));
    }
    out[col] = Object.fromEntries(Object.entries(byCur).map(([c, s]) => [c, s.toString()]));
  }
  return out;
}

// sha256Hex: async (string) => hex — передаётся снаружи (в Node — crypto, в браузере — SubtleCrypto).
export async function buildManifest(tables, sha256Hex) {
  const manifest = { tables: {} };
  for (const [t, rows] of Object.entries(tables)) {
    manifest.tables[t] = {
      rows: rows.length,
      sha256: await sha256Hex(canonicalRows(rows)),
      money: moneySums(t, rows),
    };
  }
  return manifest;
}
