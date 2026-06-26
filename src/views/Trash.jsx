import React, { useState, useEffect, useCallback } from 'react';
import { cars as carsApi, clients as clientsApi, rentals as rentalsApi, carExpenses, officeExpenses } from '../lib/api.js';
import { fmtMoney, fmtDate } from '../App.jsx';
import { usePerms } from '../lib/perms.js';
import { toast, confirmDialog } from '../lib/ui.jsx';

// Превращаем сырые ошибки БД в понятный текст
function humanError(e, tab) {
  const m = String(e?.message || '');
  if (m.includes('foreign key') || m.includes('_fkey') || m.includes('violates')) {
    if (tab === 'clients') return 'Нельзя удалить навсегда: по клиенту есть аренды в истории. Сначала удалите его аренды — или оставьте клиента скрытым в корзине.';
    if (tab === 'cars') return 'Нельзя удалить навсегда: по машине есть аренды или расходы в истории. Сначала удалите их — или оставьте машину скрытой.';
    return 'Нельзя удалить навсегда: на эту запись ссылаются другие данные. Сначала удалите связанные записи.';
  }
  return 'Ошибка: ' + (m || 'не удалось выполнить');
}

const TABS = [
  ['clients', 'Клиенты'],
  ['rentals', 'Аренды'],
  ['carExp', 'Расходы машин'],
  ['offExp', 'Расходы офиса'],
  ['cars', 'Машины'],
];

export default function Trash({ onChange }) {
  const { canPurge } = usePerms();
  const [tab, setTab] = useState('clients');
  const [data, setData] = useState({ clients: [], rentals: [], carExp: [], offExp: [], cars: [] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cl, re, ce, oe, ca] = await Promise.all([
      clientsApi.trash(), rentalsApi.trash(), carExpenses.trash(), officeExpenses.trash(), carsApi.trash(),
    ]);
    setData({ clients: cl, rentals: re, carExp: ce, offExp: oe, cars: ca });
  }, []);
  useEffect(() => { load(); }, [load]);

  const api = { clients: clientsApi, rentals: rentalsApi, carExp: carExpenses, offExp: officeExpenses, cars: carsApi };

  const restore = async (id) => {
    setBusy(true);
    try { await api[tab].restore(id); await load(); onChange?.(); }
    catch (e) { toast(humanError(e, tab), 'error'); }
    finally { setBusy(false); }
  };
  const purge = async (id) => {
    if (!(await confirmDialog('Удалить НАВСЕГДА? Это действие необратимо — запись не восстановить.', { danger: true, okText: 'Удалить навсегда' }))) return;
    setBusy(true);
    try { await api[tab].purge(id); await load(); onChange?.(); }
    catch (e) { toast(humanError(e, tab), 'error'); }
    finally { setBusy(false); }
  };

  const rows = data[tab] || [];

  const renderRow = (r) => {
    if (tab === 'clients') return <><b>{r.name || '—'}</b> <span className="muted">{r.phone || ''}</span></>;
    if (tab === 'rentals') return <><b>{r.car_name || r.cars?.name || '—'}</b> — {r.client_name || r.clients?.name || '—'} <span className="muted mono">{fmtDate(r.issued_at)}</span></>;
    if (tab === 'carExp') return <><b>{r.description || '—'}</b> <span className="muted">{r.car_name || ''} · {fmtMoney(r.amount, r.currency)}</span></>;
    if (tab === 'offExp') return <><b>{r.description || '—'}</b> <span className="muted">{r.category || ''} · {fmtMoney(r.amount, r.currency)}</span></>;
    if (tab === 'cars') return <><b>{r.name || '—'}</b> <span className="muted">{r.plate || ''}</span></>;
    return null;
  };

  return (
    <>
      <div className="head">
        <h1>Корзина</h1>
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          Скрытые записи. Восстановить может сотрудник; удалить навсегда — только администратор.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'btn sm' : 'btn ghost sm'} onClick={() => setTab(key)}>
            {label} {data[key]?.length ? `(${data[key].length})` : ''}
          </button>
        ))}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><b>Пусто</b>Здесь нет скрытых записей.</div>
        ) : (
          <table>
            <thead><tr><th>Запись</th><th style={{ width: 220 }}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{renderRow(r)}</td>
                  <td><div className="row-actions">
                    <button className="btn ghost sm" disabled={busy} onClick={() => restore(r.id)}>↩ Восстановить</button>
                    {canPurge && <button className="btn danger sm" disabled={busy} onClick={() => purge(r.id)}>Удалить навсегда</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
