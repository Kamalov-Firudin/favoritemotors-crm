import React, { useState, useEffect, useCallback } from 'react';
import { fmtMoney, fmtDate, CURRENCIES, toMinor, fromMinor } from '../App.jsx';
import { carExpenses, officeExpenses, CAR_EXPENSE_CATS, OFFICE_EXPENSE_CATS } from '../lib/api.js';
import { usePerms } from '../lib/perms.js';

const today = () => new Date().toISOString().slice(0, 10);

const RENTAL_STATUS = {
  reserved: ['Бронь', 'out'],
  active: ['В аренде', 'out'],
  completed: ['Завершена', 'done'],
  cancelled: ['Отменена', 'done'],
};

const CAT_COLORS = {
  'ТО': '#EF9F27',
  'Ремонт': '#D85A30',
  'Страхование': '#639922',
  'Шины': '#378ADD',
  'Мойка': '#1D9E75',
  'Прочее': '#888780',
};

function driverOn(rentals, d) {
  return rentals.find((r) => {
    if (r.status !== 'active' && r.status !== 'completed') return false;
    const end = r.returned_at || today();
    return r.issued_at <= d && d <= end;
  }) || null;
}

// Сумма по валютам: { TRY: 12000, EUR: 500 }
function sumByCurrency(rows) {
  const result = {};
  for (const r of rows) {
    const cur = r.currency || 'TRY';
    result[cur] = (result[cur] || 0) + (Number(r.amount) || 0);
  }
  return result;
}

function renderSums(sums, color) {
  return Object.entries(sums).map(([cur, amt]) => (
    <span key={cur} style={{ color, fontWeight: 500, marginRight: 10 }}>
      {fmtMoney(amt, cur)}
    </span>
  ));
}

const EMPTY_EXPENSE = { date: today(), category: 'ТО', description: '', amount: '', currency: 'TRY', note: '' };

export default function CarCard({ car, rentals: allRentals, onClose, onChange }) {
  const { canWrite } = usePerms();
  const [tab, setTab] = useState('info');
  const [dateQuery, setDateQuery] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [expForm, setExpForm] = useState(null);
  const [cats, setCats] = useState([]);

  const carRentals = allRentals
    .filter((r) => r.car_id === car.id)
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at));

  const loadExpenses = useCallback(async () => {
    const data = await carExpenses.listByCar(car.id);
    setExpenses(data);
  }, [car.id]);

  useEffect(() => {
    loadExpenses();
    Promise.resolve({ car: CAR_EXPENSE_CATS, office: OFFICE_EXPENSE_CATS }).then((c) => setCats(c.car || []));
  }, [loadExpenses]);

  const found = dateQuery ? driverOn(carRentals, dateQuery) : null;

  const completedRentals = carRentals.filter((r) => r.status === 'completed' || r.status === 'active');
  const totalDays = completedRentals.reduce((acc, r) => {
    if (!r.issued_at) return acc;
    const end = r.returned_at || r.due_at || today();
    const diff = Math.max(0, Math.round((new Date(end) - new Date(r.issued_at)) / 86400000));
    return acc + diff;
  }, 0);

  const incomeSums = sumByCurrency(carRentals.filter((r) => r.status === 'completed' || r.status === 'active'));
  const expenseSums = sumByCurrency(expenses);

  const saveExpense = async () => {
    if (!expForm.description.trim()) return alert('Укажите описание');
    if (!expForm.date) return alert('Укажите дату');
    const payload = {
      ...expForm,
      car_id: car.id,
      amount: toMinor(expForm.amount),
    };
    if (expForm.id) await carExpenses.update(payload);
    else await carExpenses.create(payload);
    setExpForm(null);
    await loadExpenses();
    onChange?.();
  };

  const removeExpense = async (e) => {
    if (!confirm(`Удалить «${e.description}»?`)) return;
    await carExpenses.remove(e.id);
    await loadExpenses();
    onChange?.();
  };

  const set = (k) => (ev) => setExpForm({ ...expForm, [k]: ev.target.value });

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 780 }}>
        <div className="modal-head">
          <h3>
            {car.name}
            {car.plate && <span className="muted mono" style={{ fontSize: 13, marginLeft: 8 }}>{car.plate}</span>}
          </h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {/* Табы */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--bg2)' }}>
          {[['info', 'Информация'], ['history', 'История аренд'], ['expenses', 'Расходы']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '10px 20px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === key ? 'var(--accent)' : 'var(--muted)',
                fontWeight: tab === key ? 500 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Вкладка: Информация */}
        {tab === 'info' && (
          <div style={{ padding: '16px 22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginBottom: 20 }}>
              {[
                ['Год', car.year || '—'],
                ['Кузов', car.body_type || '—'],
                ['Коробка', car.transmission || '—'],
                ['Мест', car.seats || '—'],
                ['Цвет', car.color || '—'],
                ['Госномер', car.plate || '—'],
                ['Куплена', car.purchase_date ? fmtDate(car.purchase_date) : '—'],
                ['Цена покупки', car.purchase_price ? fmtMoney(car.purchase_price, car.purchase_currency) : '—'],
                ['Пробег', car.mileage ? `${Number(car.mileage).toLocaleString()} км` : '—'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{carRentals.filter(r => r.status === 'completed').length}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Завершённых аренд</div>
              </div>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{totalDays} дн</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>В аренде суммарно</div>
              </div>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{renderSums(incomeSums, 'var(--fg)')}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Доход за всё время</div>
              </div>
            </div>
            {car.note && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>
                {car.note}
              </div>
            )}
          </div>
        )}

        {/* Вкладка: История аренд */}
        {tab === 'history' && (
          <>
            <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div className="field" style={{ maxWidth: 200, margin: 0 }}>
                  <label>Кто был за рулём на дату (штраф)</label>
                  <input type="date" value={dateQuery} onChange={(e) => setDateQuery(e.target.value)} />
                </div>
                {dateQuery && (
                  found
                    ? <div className="hint" style={{ flex: 1 }}>
                        {fmtDate(dateQuery)} — машина была у: <b>{found.client_name}</b>. Выдана {fmtDate(found.issued_at)}{found.returned_at ? ` · возврат ${fmtDate(found.returned_at)}` : ' · ещё на руках'}.
                      </div>
                    : <div className="hint warn" style={{ flex: 1 }}>На {fmtDate(dateQuery)} аренды этой машины не найдено.</div>
                )}
              </div>
            </div>
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {carRentals.length === 0
                ? <div className="empty"><b>Аренд ещё не было</b></div>
                : (
                  <table>
                    <thead><tr><th>Клиент</th><th>Выдана</th><th>Возврат</th><th>Сумма</th><th>Статус</th></tr></thead>
                    <tbody>
                      {carRentals.map((r) => (
                        <tr key={r.id} style={found?.id === r.id ? { background: '#f7ecde' } : undefined}>
                          <td><b>{r.client_name}</b></td>
                          <td className="mono">{fmtDate(r.issued_at)}</td>
                          <td className="mono muted">{r.returned_at ? fmtDate(r.returned_at) : (r.due_at ? `до ${fmtDate(r.due_at)}` : '—')}</td>
                          <td className="mono">{fmtMoney(r.amount, r.currency)}</td>
                          <td><span className={`badge ${RENTAL_STATUS[r.status]?.[1] || 'done'}`}>{RENTAL_STATUS[r.status]?.[0] || r.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
          </>
        )}

        {/* Вкладка: Расходы */}
        {tab === 'expenses' && (
          <>
            <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Итого расходов: {Object.keys(expenseSums).length === 0 ? '—' : renderSums(expenseSums, '#993C1D')}
              </div>
              {canWrite && <button className="btn sm" onClick={() => setExpForm({ ...EMPTY_EXPENSE })}>+ Добавить расход</button>}
            </div>
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {expenses.length === 0
                ? <div className="empty"><b>Расходов ещё нет</b>Добавьте первый — ТО, ремонт, страховку.</div>
                : (
                  <table>
                    <thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Сумма</th><th></th></tr></thead>
                    <tbody>
                      {expenses.map((e) => (
                        <tr key={e.id}>
                          <td className="mono muted">{fmtDate(e.date)}</td>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[e.category] || '#888', flexShrink: 0, display: 'inline-block' }} />
                              {e.category}
                            </span>
                          </td>
                          <td>{e.description}{e.note ? <span className="muted"> · {e.note}</span> : ''}</td>
                          <td className="mono">{fmtMoney(e.amount, e.currency)}</td>
                          <td><div className="row-actions">
                            {canWrite && <button className="btn ghost sm" onClick={() => setExpForm({ ...e, amount: fromMinor(e.amount) })}>Изм.</button>}
                            {canWrite && <button className="btn ghost sm" onClick={() => removeExpense(e)}>Скрыть</button>}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
          </>
        )}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>

      {/* Форма добавления/редактирования расхода */}
      {expForm && (
        <div className="overlay" style={{ zIndex: 300 }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3>{expForm.id ? 'Изменить расход' : 'Новый расход'}</h3>
              <button className="x" onClick={() => setExpForm(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="field"><label>Дата *</label><input type="date" value={expForm.date} onChange={set('date')} /></div>
              <div className="field">
                <label>Категория</label>
                <select value={expForm.category} onChange={set('category')}>
                  {cats.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field full"><label>Описание *</label><input value={expForm.description} onChange={set('description')} placeholder="Замена масла + фильтр" /></div>
              <div className="field">
                <label>Сумма</label>
                <div className="amount-row">
                  <input value={expForm.amount} onChange={set('amount')} placeholder="0.00" />
                  <select value={expForm.currency} onChange={set('currency')}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="field full"><label>Заметка</label><input value={expForm.note || ''} onChange={set('note')} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setExpForm(null)}>Отмена</button>
              <button className="btn" onClick={saveExpense}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
