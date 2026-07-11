import React, { useState } from 'react';
import { fmtMoney, fmtDate, clientBalance } from '../App.jsx';

const today = () => new Date().toISOString().slice(0, 10);

const RENTAL_STATUS = {
  reserved: ['Бронь', 'out'],
  active: ['В аренде', 'out'],
  completed: ['Завершена', 'done'],
  cancelled: ['Отменена', 'done'],
};

function sumByCurrency(rows) {
  const result = {};
  for (const r of rows) {
    const cur = r.currency || 'TRY';
    result[cur] = (result[cur] || 0) + (Number(r.amount) || 0);
  }
  return result;
}
function renderSums(sums, color) {
  const entries = Object.entries(sums);
  if (entries.length === 0) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return entries.map(([cur, amt]) => (
    <span key={cur} style={{ color, fontWeight: 500, marginRight: 10, whiteSpace: 'nowrap' }}>{fmtMoney(amt, cur)}</span>
  ));
}

// Карточка клиента: сведения + история аренд (какие машины брал, когда, суммы, долг).
// Данные только для чтения — все правки идут через раздел «Аренда».
export default function ClientCard({ client, rentals: allRentals, onClose }) {
  const [tab, setTab] = useState('info');

  const clientRentals = allRentals
    .filter((r) => r.client_id === client.id)
    .sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''));

  const realized = clientRentals.filter((r) => r.status === 'completed' || r.status === 'active');
  const spentSums = sumByCurrency(realized);
  const bal = clientBalance(allRentals, client.id);
  const debt = Object.entries(bal).filter(([, v]) => v > 0);
  const credit = Object.entries(bal).filter(([, v]) => v < 0);

  const fullName = [client.last_name, client.first_name, client.middle_name].filter(Boolean).join(' ') || client.name || '—';

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 780 }}>
        <div className="modal-head">
          <h3>
            {fullName}
            {client.category && client.category !== 'Обычный' && (
              <span className={`badge ${client.category === 'Чёрный список' ? 'maintenance' : 'free'}`} style={{ marginLeft: 8 }}>
                {client.category === 'Чёрный список' ? 'ЧС' : client.category}
              </span>
            )}
          </h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--bg2)' }}>
          {[['info', 'Информация'], ['history', 'История аренд']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{
                padding: '10px 20px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === key ? 'var(--accent)' : 'var(--muted)', fontWeight: tab === key ? 500 : 400,
              }}>
              {label}{key === 'history' ? ` (${clientRentals.length})` : ''}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <div style={{ padding: '16px 22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginBottom: 20 }}>
              {[
                ['Телефон', client.phone || '—'],
                ['Доп. телефон', client.phone2 || '—'],
                ['Email', client.email || '—'],
                ['Дата рождения', client.birth_date ? fmtDate(client.birth_date) : '—'],
                ['Страна', client.country || '—'],
                ['Паспорт', client.passport_number || '—'],
                ['Вод. удостоверение', client.license_number || '—'],
                ['Права выданы', client.license_issued ? fmtDate(client.license_issued) : '—'],
                ['Скидка', client.discount ? `${client.discount}%` : '—'],
                ['Источник', client.source || '—'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{clientRentals.filter((r) => r.status === 'completed').length}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Завершённых аренд</div>
              </div>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{renderSums(spentSums, 'var(--fg)')}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Сумма аренд за всё время</div>
              </div>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  {debt.length === 0 && credit.length === 0 && <span style={{ color: 'var(--ink-soft)' }}>0</span>}
                  {debt.length > 0 && <span style={{ color: 'var(--warn)' }}>{debt.map(([c, v]) => fmtMoney(v, c)).join(' · ')}</span>}
                  {credit.length > 0 && <span style={{ color: '#3B6D11' }} title="переплата в пользу клиента"> +{credit.map(([c, v]) => fmtMoney(-v, c)).join(' · ')}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Текущий баланс (долг / переплата)</div>
              </div>
            </div>
            {client.note && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>{client.note}</div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {clientRentals.length === 0
              ? <div className="empty"><b>Аренд ещё не было</b></div>
              : (
                <table>
                  <thead><tr><th>Машина</th><th>Выдана</th><th>Возврат</th><th>Сумма</th><th>Долг</th><th>Статус</th></tr></thead>
                  <tbody>
                    {clientRentals.map((r) => {
                      const d = Number(r.amount || 0) - Number(r.paid || 0);
                      return (
                        <tr key={r.id}>
                          <td><b>{r.car_name || '—'}</b>{r.car_plate ? <span className="muted mono" style={{ marginLeft: 6 }}>{r.car_plate}</span> : ''}</td>
                          <td className="mono">{fmtDate(r.issued_at)}</td>
                          <td className="mono muted">{r.returned_at ? fmtDate(r.returned_at) : (r.due_at ? `до ${fmtDate(r.due_at)}` : '—')}</td>
                          <td className="mono">{fmtMoney(r.amount, r.currency)}</td>
                          <td className="mono">{d > 0 ? <span style={{ color: 'var(--warn)' }}>{fmtMoney(d, r.currency)}</span> : d < 0 ? <span style={{ color: '#3B6D11' }}>+{fmtMoney(-d, r.currency)}</span> : <span style={{ color: 'var(--ink-soft)' }}>—</span>}</td>
                          <td><span className={`badge ${RENTAL_STATUS[r.status]?.[1] || 'done'}`}>{RENTAL_STATUS[r.status]?.[0] || r.status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        )}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
