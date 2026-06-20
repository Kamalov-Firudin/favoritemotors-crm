import React, { useState, useEffect, useCallback } from 'react';
import { maintenance as maintenanceApi } from '../lib/api.js';
import { fmtDate } from '../App.jsx';
import { usePerms } from '../lib/perms.js';

// Дней между двумя датами (date2 - date1)
function daysDiff(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

// Статус по дням: просрочен / критично (≤15) / скоро (≤30) / норм / далеко
function dateStatus(days) {
  if (days === null) return 'unknown';
  if (days < 0) return 'overdue';
  if (days <= 15) return 'critical';
  if (days <= 30) return 'soon';
  return 'ok';
}

// Статус масла по км
function oilStatus(currentKm, nextKm) {
  if (!currentKm || !nextKm) return 'unknown';
  const left = nextKm - currentKm;
  if (left <= 0) return 'overdue';
  if (left <= 500) return 'critical';
  if (left <= 1500) return 'soon';
  return 'ok';
}

const STATUS_LABEL = {
  overdue: 'Просрочено',
  critical: 'Срочно',
  soon: 'Скоро',
  ok: 'ОК',
  unknown: '—',
};
const STATUS_STYLE = {
  overdue: { background: '#f4e7e3', color: '#b4472b', fontWeight: 600 },
  critical: { background: '#fef3e2', color: '#8a5a00', fontWeight: 600 },
  soon: { background: '#fef9ec', color: '#7a6200', fontWeight: 500 },
  ok: { background: '#e7f0e9', color: '#3f7d52', fontWeight: 500 },
  unknown: { background: '#ecebe7', color: '#56524a', fontWeight: 400 },
};

function StatusBadge({ status }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 11, padding: '3px 9px', borderRadius: 999, ...STATUS_STYLE[status] }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function DaysLeft({ days }) {
  if (days === null) return <span style={{ color: 'var(--ink-soft)' }}>—</span>;
  if (days < 0) return <span style={{ color: '#b4472b', fontWeight: 600 }}>просрочено на {Math.abs(days)} дн</span>;
  if (days === 0) return <span style={{ color: '#b4472b', fontWeight: 600 }}>сегодня!</span>;
  return <span style={{ color: days <= 15 ? '#8a5a00' : days <= 30 ? '#7a6200' : 'var(--ink-soft)' }}>через {days} дн</span>;
}

const EMPTY_RECORD = {
  car_id: '',
  inspection_date: '',   // тех. осмотр
  insurance_date: '',    // страховка
  oil_changed_date: '',  // дата замены масла
  oil_km: '',            // пробег при замене
  oil_next_km: '',       // следующая замена (км)
  current_km: '',        // текущий пробег
  note: '',
};

export default function Maintenance({ cars }) {
  const { canWrite, canPurge } = usePerms();
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState('all'); // all | overdue | critical | soon

  const load = useCallback(async () => {
    const data = await maintenanceApi.list();
    setRecords(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Обогащаем записи вычисленными статусами
  const enriched = records.map((r) => {
    const inspDays = daysDiff(r.inspection_date);
    const insDays = daysDiff(r.insurance_date);
    const inspStatus = dateStatus(inspDays);
    const insStatus = dateStatus(insDays);
    const oilSt = oilStatus(r.current_km, r.oil_next_km);
    const worstStatus = ['overdue', 'critical', 'soon', 'ok', 'unknown'].find(
      (s) => [inspStatus, insStatus, oilSt].includes(s)
    );
    const car = cars.find((c) => c.id === r.car_id) || {};
    return { ...r, inspDays, insDays, inspStatus, insStatus, oilSt, worstStatus, car };
  });

  // Машины без записи техсостояния
  const carsWithRecord = new Set(records.map((r) => r.car_id));
  const carsWithout = cars.filter((c) => c.status !== 'hidden' && !carsWithRecord.has(c.id));

  const filtered = enriched.filter((r) => {
    if (filter === 'all') return true;
    return r.worstStatus === filter;
  });

  // Счётчики для фильтров
  const counts = { overdue: 0, critical: 0, soon: 0, ok: 0 };
  enriched.forEach((r) => { if (counts[r.worstStatus] !== undefined) counts[r.worstStatus]++; });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (!form.car_id) return alert('Выберите машину');
    const payload = {
      ...form,
      car_id: Number(form.car_id),
      oil_km: form.oil_km ? Number(form.oil_km) : null,
      oil_next_km: form.oil_next_km ? Number(form.oil_next_km) : null,
      current_km: form.current_km ? Number(form.current_km) : null,
    };
    if (form.id) await maintenanceApi.update(payload);
    else await maintenanceApi.create(payload);
    setForm(null);
    await load();
  };

  const remove = async (r) => {
    if (!confirm(`Удалить запись для ${r.car?.name || 'машины'}?`)) return;
    await maintenanceApi.remove(r.id);
    await load();
  };

  const openEdit = (r) => setForm({
    ...EMPTY_RECORD, ...r,
    oil_km: r.oil_km ?? '',
    oil_next_km: r.oil_next_km ?? '',
    current_km: r.current_km ?? '',
  });

  return (
    <>
      <div className="head">
        <h1>Техсостояние</h1>
        {canWrite && <button className="btn" onClick={() => setForm({ ...EMPTY_RECORD })}>+ Добавить запись</button>}
      </div>

      {/* Счётчики-фильтры */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          ['all', 'Все', enriched.length, null],
          ['overdue', 'Просрочено', counts.overdue, '#b4472b'],
          ['critical', 'Срочно (≤15 дн)', counts.critical, '#8a5a00'],
          ['soon', 'Скоро (≤30 дн)', counts.soon, '#7a6200'],
          ['ok', 'ОК', counts.ok, '#3f7d52'],
        ].map(([key, label, count, color]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid var(--line)',
              background: filter === key ? 'var(--ink)' : 'var(--panel)',
              color: filter === key ? '#fff' : (color || 'var(--ink)'),
              fontWeight: filter === key ? 600 : 400,
            }}
          >
            {label} {count > 0 && <span style={{
              background: filter === key ? 'rgba(255,255,255,0.25)' : (color ? STATUS_STYLE[key]?.background || '#eee' : '#eee'),
              color: filter === key ? '#fff' : (color || 'var(--ink-soft)'),
              borderRadius: 999, padding: '1px 7px', fontSize: 11, marginLeft: 4
            }}>{count}</span>}
          </button>
        ))}
      </div>

      {/* Предупреждение если есть просроченные */}
      {counts.overdue > 0 && (
        <div style={{
          background: '#fdf0ed', border: '1px solid #e8b4a6', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <span>
            <b style={{ color: '#b4472b' }}>{counts.overdue} {counts.overdue === 1 ? 'машина требует' : 'машины требуют'} немедленного внимания</b>
            {' '}— просрочен тех. осмотр, страховка или замена масла.
          </span>
        </div>
      )}

      {/* Таблица */}
      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty">
            <b>{filter === 'all' ? 'Нет записей' : 'Нет машин в этой категории'}</b>
            {filter === 'all' && 'Добавьте первую запись — нажмите «+ Добавить запись».'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Машина</th>
                <th>Тех. осмотр</th>
                <th>Страховка</th>
                <th>Масло — последняя замена</th>
                <th>Текущий пробег</th>
                <th>Следующая замена масла</th>
                <th>Общий статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={r.worstStatus === 'overdue' ? { background: '#fdf6f5' } : undefined}>
                  <td>
                    <b>{r.car?.name || `Машина #${r.car_id}`}</b>
                    {r.car?.plate && <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>{r.car.plate}</div>}
                  </td>
                  <td>
                    {r.inspection_date
                      ? <>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{fmtDate(r.inspection_date)}</div>
                          <DaysLeft days={r.inspDays} />
                        </>
                      : <span style={{ color: 'var(--ink-soft)' }}>не указан</span>
                    }
                    {r.inspection_date && <div style={{ marginTop: 3 }}><StatusBadge status={r.inspStatus} /></div>}
                  </td>
                  <td>
                    {r.insurance_date
                      ? <>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{fmtDate(r.insurance_date)}</div>
                          <DaysLeft days={r.insDays} />
                        </>
                      : <span style={{ color: 'var(--ink-soft)' }}>не указана</span>
                    }
                    {r.insurance_date && <div style={{ marginTop: 3 }}><StatusBadge status={r.insStatus} /></div>}
                  </td>
                  <td>
                    {r.oil_changed_date
                      ? <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{fmtDate(r.oil_changed_date)}</div>
                      : <span style={{ color: 'var(--ink-soft)' }}>не указана</span>
                    }
                    {r.oil_km && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{Number(r.oil_km).toLocaleString()} км</div>}
                  </td>
                  <td>
                    {r.current_km
                      ? <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{Number(r.current_km).toLocaleString()} км</span>
                      : <span style={{ color: 'var(--ink-soft)' }}>не указан</span>
                    }
                  </td>
                  <td>
                    {r.oil_next_km
                      ? <>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{Number(r.oil_next_km).toLocaleString()} км</div>
                          {r.current_km && (
                            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                              осталось {Math.max(0, r.oil_next_km - r.current_km).toLocaleString()} км
                            </div>
                          )}
                          <div style={{ marginTop: 3 }}><StatusBadge status={r.oilSt} /></div>
                        </>
                      : <span style={{ color: 'var(--ink-soft)' }}>не указана</span>
                    }
                  </td>
                  <td><StatusBadge status={r.worstStatus} /></td>
                  <td>
                    <div className="row-actions">
                      {canWrite && <button className="btn ghost sm" onClick={() => openEdit(r)}>Изм.</button>}
                      {canPurge && <button className="btn danger sm" onClick={() => remove(r)}>Удалить</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Машины без записи */}
      {carsWithout.length > 0 && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13, color: 'var(--ink-soft)' }}>
          <b style={{ color: 'var(--ink)' }}>Машины без записи техсостояния:</b>{' '}
          {carsWithout.map((c) => c.name).join(', ')} —{' '}
          <span
            style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setForm({ ...EMPTY_RECORD })}
          >добавить запись</span>
        </div>
      )}

      {/* Форма добавления/редактирования */}
      {form && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 540 }}>
            <div className="modal-head">
              <h3>{form.id ? 'Изменить запись' : 'Новая запись техсостояния'}</h3>
              <button className="x" onClick={() => setForm(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="field full">
                <label>Машина *</label>
                <select value={form.car_id} onChange={set('car_id')}>
                  <option value="">— выберите машину —</option>
                  {cars.filter((c) => c.status !== 'hidden').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.plate ? ` · ${c.plate}` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="field"><label>Тех. осмотр — срок окончания</label><input type="date" value={form.inspection_date || ''} onChange={set('inspection_date')} /></div>
              <div className="field"><label>Страховка — срок окончания</label><input type="date" value={form.insurance_date || ''} onChange={set('insurance_date')} /></div>

              <div className="field"><label>Дата последней замены масла</label><input type="date" value={form.oil_changed_date || ''} onChange={set('oil_changed_date')} /></div>
              <div className="field"><label>Пробег при замене (км)</label><input type="number" value={form.oil_km} onChange={set('oil_km')} placeholder="114 430" /></div>
              <div className="field"><label>Следующая замена — пробег (км)</label><input type="number" value={form.oil_next_km} onChange={set('oil_next_km')} placeholder="124 430" /></div>
              <div className="field"><label>Текущий пробег (км)</label><input type="number" value={form.current_km} onChange={set('current_km')} placeholder="118 000" /></div>

              <div className="field full"><label>Заметка</label><textarea value={form.note || ''} onChange={set('note')} rows={2} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setForm(null)}>Отмена</button>
              <button className="btn" onClick={save}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
