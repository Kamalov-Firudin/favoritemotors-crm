import React, { useState, useMemo, useRef } from 'react';

const LIMIT = 25;

function label(c) {
  return [c.last_name, c.first_name, c.middle_name].filter(Boolean).join(' ') || c.name || '(без имени)';
}
function sub(c) {
  return [
    c.phone,
    c.passport_number && 'пасп. ' + c.passport_number,
    c.license_number && 'в/у ' + c.license_number,
    c.birth_date && c.birth_date.slice(0, 4),
  ].filter(Boolean).join(' · ');
}

// value = client_id (number|''), onChange(id)
export default function ClientPicker({ clients, value, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const selected = clients.find((c) => c.id === Number(value));

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients.slice(0, LIMIT);
    const res = [];
    for (const c of clients) {
      const hay = [c.last_name, c.first_name, c.middle_name, c.phone, c.phone2, c.email, c.passport_number, c.license_number, String(c.id)]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(term)) res.push(c);
      if (res.length > LIMIT) break;
    }
    return res;
  }, [q, clients]);

  const more = matches.length > LIMIT ? matches.length - LIMIT : 0;
  const shown = matches.slice(0, LIMIT);

  const pick = (c) => { onChange(c.id); setQ(''); setOpen(false); };
  const clear = () => { onChange(''); setQ(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="field full">
      <label>Клиент *</label>
      {selected ? (
        <div className="picker-selected">
          <span><b>{label(selected)}</b>{sub(selected) ? <span className="muted"> · {sub(selected)}</span> : null}</span>
          <button type="button" className="btn ghost sm" onClick={clear}>Изменить</button>
        </div>
      ) : (
        <div className="picker">
          <input
            ref={inputRef}
            value={q}
            placeholder="Поиск: фамилия, имя, телефон, паспорт, в/у..."
            onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
          />
          {open && (
            <div className="picker-list">
              {shown.length === 0 ? (
                <div className="picker-empty">Ничего не найдено</div>
              ) : (
                shown.map((c, i) => (
                  <div key={c.id} className={`picker-item ${i === active ? 'active' : ''}`}
                       onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
                    <div className="pi-name">{label(c)}{c.category === 'Чёрный список' ? <span className="badge maintenance" style={{ marginLeft: 6 }}>ЧС</span> : null}</div>
                    {sub(c) && <div className="pi-sub muted">{sub(c)}</div>}
                  </div>
                ))
              )}
              {more > 0 && <div className="picker-more">…ещё {more}. Уточните запрос.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
