import React, { useState, useEffect, useCallback, useRef } from 'react';
import { payments as paymentsApi, PAYMENT_KINDS, PAYMENT_KIND_LABELS } from '../lib/api.js';
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
  const [form, setForm] = useState({ paid_at: today(), amount: '', note: '', kind: 'rental' });

  const cur = rental.currency || 'TRY';

  const load = useCallback(async () => {
    setRows(await paymentsApi.listByRental(rental.id));
  }, [rental.id]);
  useEffect(() => { load(); }, [load]);

  // В долг аренды идут только арендные платежи; остальное — прочий приход (в кассу, не в долг).
  const isRentalKind = (p) => (p.kind ?? 'rental') === 'rental';
  const paidRental = (rows || []).filter(isRentalKind).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const otherTotal = (rows || []).filter((p) => !isRentalKind(p)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const debt = Number(rental.amount || 0) - paidRental;

  const addingRef = useRef(false); // синхронный замок против двойного клика
  const add = async () => {
    if (addingRef.current) return; // повторный вызов до завершения — игнор
    const amt = toMinor(form.amount);
    if (!form.paid_at) return toast('Укажите дату платежа');
    if (amt === 0) return toast('Укажите сумму платежа (можно отрицательную — возврат/коррекция)');
    // Защита от случайного дубля: платёж с той же датой и той же суммой уже есть.
    const dup = (rows || []).find((p) => p.paid_at === form.paid_at && Number(p.amount) === amt);
    if (dup && !(await confirmDialog(`Платёж ${fmtMoney(amt, cur)} от ${fmtDate(form.paid_at)} уже записан по этой аренде. Добавить ещё один такой же?`, { okText: 'Всё равно добавить' }))) return;
    addingRef.current = true;
    setBusy(true);
    try {
      await paymentsApi.add({ rental_id: rental.id, paid_at: form.paid_at, amount: amt, currency: cur, note: form.note.trim() || null, kind: form.kind });
      setForm({ paid_at: today(), amount: '', note: '', kind: 'rental' });
      await load();
      onChanged?.();
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(false); addingRef.current = false; }
  };

  const remove = async (p) => {
    if (!(await confirmDialog(`Убрать платёж ${fmtMoney(p.amount, p.currency)} от ${fmtDate(p.paid_at)} в корзину? Долг пересчитается; платёж можно будет восстановить.`, { okText: 'В корзину' }))) return;
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
                <span style={{ color: '#3B6D11' }}>Оплачено (аренда): <b>{fmtMoney(paidRental, cur)}</b></span>
                {debt > 0 && <span style={{ color: 'var(--warn)' }}>Долг: <b>{fmtMoney(debt, cur)}</b></span>}
                {debt < 0 && <span style={{ color: '#3B6D11' }}>Переплата: <b>{fmtMoney(-debt, cur)}</b></span>}
                {otherTotal !== 0 && <span style={{ color: 'var(--ink-soft)' }} title="Возмещения/штрафы/прочее — в кассу, но не в счёт аренды">Прочий приход: <b>{fmtMoney(otherTotal, cur)}</b></span>}
              </div>
            </div>
          </div>

          <div className="field full" style={{ gridColumn: '1 / -1' }}>
            {rows === null ? <div className="muted" style={{ padding: 8 }}>Загрузка…</div>
              : rows.length === 0 ? <div className="empty" style={{ padding: '14px' }}><b>Платежей ещё нет</b></div>
              : (
                <table>
                  <thead><tr><th>Дата</th><th>Сумма</th><th>Категория</th><th>Заметка</th><th></th></tr></thead>
                  <tbody>{rows.map((p) => {
                    const k = p.kind ?? 'rental';
                    return (
                    <tr key={p.id}>
                      <td className="mono muted">{fmtDate(p.paid_at)}</td>
                      <td className="mono" style={{ color: Number(p.amount) < 0 ? 'var(--warn)' : '#3B6D11', fontWeight: 500 }}>{fmtMoney(p.amount, p.currency)}</td>
                      <td style={{ fontSize: 12, color: k === 'rental' ? 'var(--ink-soft)' : '#8a5a1a', fontWeight: k === 'rental' ? 400 : 600 }}>{PAYMENT_KIND_LABELS[k] || k}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{p.note || ''}</td>
                      <td>{canWrite && <button className="btn ghost sm" disabled={busy} onClick={() => remove(p)}>Удалить</button>}</td>
                    </tr>
                    );
                  })}</tbody>
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
              <div className="amount-row" style={{ gridTemplateColumns: '150px 1fr', marginBottom: 8 }}>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} title="Аренда — в счёт долга клиента. Остальное — прочий приход в кассу, в долг не идёт.">
                  {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</option>)}
                </select>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Заметка (необязательно): аванс, ремонт бампера, штраф ПДД…" />
              </div>
              {form.kind !== 'rental' && <div className="hint" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Это не оплата аренды: в долг клиента не пойдёт, попадёт в кассу как «{PAYMENT_KIND_LABELS[form.kind].toLowerCase()}». Расход по нему заведите отдельно во вкладке «Финансы».</div>}
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
