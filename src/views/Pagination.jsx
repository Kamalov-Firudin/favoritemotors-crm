import React from 'react';

// Пагинация отображения: данные уже загружены, делим на страницы по pageSize.
export default function Pagination({ page, total, pageSize, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const go = (p) => onPage(Math.min(pages, Math.max(1, p)));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', padding: '14px 0 4px', fontSize: 13, flexWrap: 'wrap' }}>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => go(1)}>«</button>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => go(page - 1)}>‹ Назад</button>
      <span style={{ color: 'var(--ink-soft)', margin: '0 8px' }}>{from}–{to} из {total} · стр. {page}/{pages}</span>
      <button className="btn ghost sm" disabled={page >= pages} onClick={() => go(page + 1)}>Вперёд ›</button>
      <button className="btn ghost sm" disabled={page >= pages} onClick={() => go(pages)}>»</button>
    </div>
  );
}
