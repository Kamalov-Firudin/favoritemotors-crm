import React, { useState, useEffect, useCallback, useRef } from 'react';
import { payments as paymentsApi, rentals as rentalsApi, PAYMENT_KINDS, PAYMENT_KIND_LABELS } from '../lib/api.js';
import { fmtMoney, fmtDate } from '../App.jsx';
import { usePerms } from '../lib/perms.js';
import { toast, confirmDialog } from '../lib/ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const toMinor = (s) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

// Кассовый журнал одной аренды: список датированных платежей + добавление/удаление.
// rental.paid — кэш суммы платежей; после любого изменения зовём onChanged,
// чтобы родитель перезагрузил аренды и увидел свежий долг.
// Режим «Возврат клиенту»: сумма вводится без минуса, сохраняется как отрицательный арендный платёж
// с пометкой «Возврат клиенту». Исходный платёж не меняется — касса остаётся честной по датам
// (пришло 90 в день оплаты, ушло 30 в день возврата). В «Финансах» позже станет отдельным типом refund.
export default function PaymentsPanel({ rental, onClose, onChanged, initialMode = 'pay' }) {
  const [mode, setMode] = useState(initialMode); // 'pay' | 'refund'
  const [rentalAmount, setRentalAmount] = useState(Number(rental.amount || 0)); // может уменьшиться (скидка)
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
  const debt = rentalAmount - paidRental;
  const paidIn = (rows || []).filter((p) => isRentalKind(p) && Number(p.amount) > 0).reduce((s, p) => s + Number(p.amount), 0);
  const refunded = -(rows || []).filter((p) => isRentalKind(p) && Number(p.amount) < 0).reduce((s, p) => s + Number(p.amount), 0);
  const overpay = Math.max(0, -debt);
  const REFUND_NOTE = 'Возврат клиенту';

  const addingRef = useRef(false); // синхронный замок против двойного клика
  const add = async () => {
    if (addingRef.current) return; // повторный вызов до завершения — игнор
    const entered = toMinor(form.amount);
    if (!form.paid_at) return toast('Укажите дату');
    if (entered <= 0) return toast(mode === 'refund'
      ? 'Укажите сумму возврата без минуса, например 30'
      : 'Укажите сумму оплаты. Чтобы вернуть деньги клиенту — переключитесь на «Возврат клиенту».');
    const amt = mode === 'refund' ? -entered : entered;
    const kind = mode === 'refund' ? 'rental' : form.kind;
    let note = form.note.trim() || null;
    if (mode === 'refund') note = note ? `${REFUND_NOTE}: ${note}` : REFUND_NOTE;

    // Возврат больше переплаты → после него появится долг. Обычно это скидка/компенсация:
    // тогда итог аренды тоже уменьшается, иначе клиент «повиснет» должником.
    let newAmount = null;
    if (mode === 'refund' && entered > overpay) {
      const gap = entered - overpay;
      const ok = await confirmDialog(
        (overpay > 0 ? `Переплата клиента — ${fmtMoney(overpay, cur)}, а возвращаете ${fmtMoney(entered, cur)}.` : `У клиента нет переплаты, а возвращаете ${fmtMoney(entered, cur)}.`) +
        ` После возврата у клиента появится долг ${fmtMoney(gap, cur)}.\n\nЕсли это скидка или компенсация — итог аренды тоже нужно уменьшить: ${fmtMoney(rentalAmount, cur)} → ${fmtMoney(rentalAmount - gap, cur)}.\n\nУменьшить итог и записать возврат? (Если сумма введена ошибочно — нажмите «Отмена».)`,
        { okText: 'Уменьшить итог и вернуть' });
      if (!ok) return;
      newAmount = rentalAmount - gap;
    }

    // Защита от случайного дубля: та же дата и та же сумма уже есть.
    const dup = (rows || []).find((p) => p.paid_at === form.paid_at && Number(p.amount) === amt);
    if (dup && !(await confirmDialog(`${mode === 'refund' ? 'Возврат' : 'Платёж'} ${fmtMoney(entered, cur)} от ${fmtDate(form.paid_at)} уже записан по этой аренде. Добавить ещё один такой же?`, { okText: 'Всё равно добавить' }))) return;
    addingRef.current = true;
    setBusy(true);
    try {
      if (newAmount !== null) {
        const rp = rental.rental_price != null ? Math.max(0, newAmount - (rental.extra_fee || 0)) : rental.rental_price;
        await rentalsApi.update({ ...rental, amount: newAmount, rental_price: rp });
        setRentalAmount(newAmount);
      }
      await paymentsApi.add({ rental_id: rental.id, paid_at: form.paid_at, amount: amt, currency: cur, note, kind });
      setForm({ paid_at: today(), amount: '', note: '', kind: 'rental' });
      if (mode === 'refund') setMode('pay');
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
              <span className="mono muted" style={{ marginRight: 6 }}>Аренда №{rental.id}</span>
              <b>{rental.car_name}</b>{rental.car_plate ? ` · ${rental.car_plate}` : ''} — {rental.client_name}
              <div style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>Сумма аренды: <b>{fmtMoney(rentalAmount, cur)}</b></span>
                {refunded > 0 ? (<>
                  <span style={{ color: '#3B6D11' }}>Оплачено: <b>{fmtMoney(paidIn, cur)}</b></span>
                  <span style={{ color: 'var(--warn)' }}>Возвращено: <b>{fmtMoney(refunded, cur)}</b></span>
                  <span>Итого получено: <b>{fmtMoney(paidRental, cur)}</b></span>
                </>) : (
                  <span style={{ color: '#3B6D11' }}>Оплачено (аренда): <b>{fmtMoney(paidRental, cur)}</b></span>
                )}
                {debt === 0 && paidRental > 0 && <span style={{ color: 'var(--ink-soft)' }}>Долг: <b>0</b></span>}
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
                      <td style={{ fontSize: 12, color: Number(p.amount) < 0 ? 'var(--warn)' : k === 'rental' ? 'var(--ink-soft)' : '#8a5a1a', fontWeight: k === 'rental' && Number(p.amount) >= 0 ? 400 : 600 }}>
                        {k === 'rental' && Number(p.amount) < 0 ? 'Возврат клиенту' : (PAYMENT_KIND_LABELS[k] || k)}
                      </td>
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
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                <button type="button" className={`btn sm ${mode === 'pay' ? '' : 'ghost'}`} onClick={() => setMode('pay')}>Оплата</button>
                <button type="button" className={`btn sm ${mode === 'refund' ? '' : 'ghost'}`} onClick={() => setMode('refund')}>Возврат клиенту</button>
              </div>
              <div className="amount-row" style={{ gridTemplateColumns: '150px 1fr', marginBottom: 8 }}>
                <input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} title={mode === 'refund' ? 'Дата, когда деньги отдали клиенту' : 'Дата, когда деньги получены'} />
                <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder={mode === 'refund' ? `Сколько вернули (${cur}), без минуса${overpay > 0 ? ` · переплата ${fmtMoney(overpay, cur)}` : ''}` : `Сумма (${cur})`} />
              </div>
              {mode === 'refund' ? (
                <>
                  <div className="amount-row" style={{ gridTemplateColumns: '1fr', marginBottom: 8 }}>
                    <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Причина (необязательно): досрочный возврат, скидка…" />
                  </div>
                  <div className="hint" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    Деньги ушли клиенту из кассы в эту дату. Исходная оплата не меняется — так касса совпадает с реальными деньгами по датам.
                    Если ошиблись при приёме и отдали сдачу в тот же день — это не возврат: удалите неверный платёж и внесите правильный.
                  </div>
                </>
              ) : (<>
              <div className="amount-row" style={{ gridTemplateColumns: '150px 1fr', marginBottom: 8 }}>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} title="Аренда — в счёт долга клиента. Остальное — прочий приход в кассу, в долг не идёт.">
                  {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</option>)}
                </select>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Заметка (необязательно): аванс, ремонт бампера, штраф ПДД…" />
              </div>
              {form.kind !== 'rental' && <div className="hint" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Это не оплата аренды: в долг клиента не пойдёт, попадёт в кассу как «{PAYMENT_KIND_LABELS[form.kind].toLowerCase()}». Расход по нему заведите отдельно во вкладке «Финансы».</div>}
              </>)}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Закрыть</button>
          {canWrite && <button className="btn" disabled={busy} onClick={add}>{mode === 'refund' ? '− Записать возврат' : '+ Добавить платёж'}</button>}
        </div>
      </div>
    </div>
  );
}
