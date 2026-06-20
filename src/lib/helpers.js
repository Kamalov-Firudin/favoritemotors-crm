export const CURRENCIES = ['EUR', 'USD', 'TRY'];
const SYM = { EUR: '€', USD: '$', TRY: '₺' };

export const toMinor = (s) => {
  const n = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const fromMinor = (m) => (Number(m || 0) / 100).toFixed(2);
export const fmtMoney = (m, cur) => `${fromMinor(m)} ${SYM[cur] || cur || ''}`.trim();
export const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '—');
export const today = () => new Date().toISOString().slice(0, 10);

export const CAR_EXPENSE_CATS = ['ТО', 'Ремонт', 'Страхование', 'Шины', 'Мойка', 'Прочее'];
export const OFFICE_EXPENSE_CATS = ['Аренда', 'Коммунальные услуги', 'Реклама', 'Зарплата', 'Связь', 'Прочее'];

// Срок аренды в днях: начатый день = целый, минимум 1.
// rentalDays('2025-06-01','2025-06-03') = 2 ; тот же день = 1.
export const rentalDays = (start, end) => {
  if (!start || !end) return 0;
  const ms = Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z');
  if (!Number.isFinite(ms)) return 0;
  return Math.max(1, Math.ceil(ms / 86400000));
};
