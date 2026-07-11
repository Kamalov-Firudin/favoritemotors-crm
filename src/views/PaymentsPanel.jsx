import React, { useState, useEffect, useCallback } from 'react';
import { payments as paymentsApi } from '../lib/api.js';
import { fmtMoney, fmtDate } from '../App.jsx';
import { usePerms } from '../lib/perms.js';
import { toast, confirmDialog } from '../lib/ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const toMinor = (s) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

// Кассовый журнал одной аренды: список датированных платежей + добавление/удаление.
// rental.paid — кэш суммы платежей; после любого изменения зовём onChanged,
// чтобы родитель перезагрузил аренды и увидел свежий долг.
export default function PaymentsPanel({ rental, onClose, onChanged }) {
  const { canWrite } = usePerms();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ paid_at: today(), amount: '', note: '' });

  const cur = rental.currency || 'TRY';

  const load = useCallback(async () => {
    setRows(await paymentsApi.listByRental(rental.id));
  }, [rental.id]);
  useEffect(() => { load(); }, [load]);

  const paidTotal = (rows || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const debt = Number(rental.amount || 0) - paidTotal;

  const add = async () => {
    const amt = toMinor(form.amount);
    if (!form.paid_at) return toast('Укажите дату платежа');
    if (amt === 0) return toast('Укажите сумму платежа (можно отрицательную — возврат/коррекция)');
    setBusy(true);
    try {
      await paymentsApi.add({ rental_id: rental.id, paid_at: form.paid_at, amount: amt, currency: cur, note: form.note.trim() || null });
      setForm({ paid_at: today(), amount: '', note: '' });
      await load();
      onChanged?.();
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (p) => {
    if (!(await confirmDialog(`Удалить платёж ${fmtMoney(p.amount, p.currency)} от ${fmtDate(p.paid_at)}?`, { danger: true, okText: 'Удалить' }))) return;
    setBusy(true);
    try { await paymentsApi.remove(p.id); await load(); onChanged?.(); }
    catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>Платежи по аренде</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="field full" style={{ gridColumn: '1 / -1' }}>
            <div style={{ background: 'var(--paper)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
              <b>{rental.car_name}</b>{rental.car_plate ? ` · ${rental.car_plate}` : ''} — {rental.client_name}
              <div style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>Сумма аренды: <b>{fmtMoney(rental.amount, cur)}</b></span>
                <span style={{ color: '#3B6D11' }}>Оплачено: <b>{fmtMoney(paidTotal, cur)}</b></span>
                {debt > 0 && <span style={{ color: 'var(--warn)' }}>Долг: <b>{fmtMoney(debt, cur)}</b></span>}
                {debt < 0 && <span style={{ color: '#3B6D11' }}>Переплата: <b>{fmtMoney(-debt, cur)}</b></span>}
              </div>
            </div>
          </div>

          <div className="field full" style={{ gridColumn: '1 / -1' }}>
            {rows === null ? <div className="muted" style={{ padding: 8 }}>Загрузка…</div>
              : rows.length === 0 ? <div className="empty" style={{ padding: '14px' }}><b>Платежей ещё нет</b></div>
              : (
                <table>
                  <thead><tr><th>Дата</th><th>Сумма</th><th>Заметка</th><th></th></tr></thead>
                  <tbody>{rows.map((p) => (
                    <tr key={p.id}>
                      <td className="mono muted">{fmtDate(p.paid_at)}</td>
                      <td className="mono" style={{ color: Number(p.amount) < 0 ? 'var(--warn)' : '#3B6D11', fontWeight: 500 }}>{fmtMoney(p.amount, p.currency)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{p.note || ''}</td>
                      <td>{canWrite && <button className="btn ghost sm" disabled={busy} onClick={() => remove(p)}>Удалить</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>

          {canWrite && (
            <div className="field full" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <label>Добавить платёж</label>
              <div className="amount-row" style={{ gridTemplateColumns: '150px 1fr', marginBottom: 8 }}>
                <input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} />
                <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={`Сумма (${cur})`} />
              </div>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Заметка (необязательно): аванс, доплата при возврате…" />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Закрыть</button>
          {canWrite && <button className="btn" disabled={busy} onClick={add}>+ Добавить платёж</button>}
        </div>
      </div>
    </div>
  );
}
