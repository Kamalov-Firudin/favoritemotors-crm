import React, { useState, useEffect, useCallback } from 'react';
import { auditLog } from '../lib/api.js';
import { fmtDate } from '../App.jsx';

const ACTION_LABEL = { create: 'Создание', update: 'Изменение', delete: 'Удаление' };
const ACTION_STYLE = {
  create: { background: '#e7f0e9', color: '#3f7d52' },
  update: { background: '#f7ecde', color: '#7a4814' },
  delete: { background: '#f4e7e3', color: '#b4472b' },
};
const TABLE_LABEL = {
  cars: 'Машины', clients: 'Клиенты', rentals: 'Аренды',
  car_expenses: 'Расходы машин', office_expenses: 'Расходы офиса', maintenance: 'Техсостояние',
};

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const date = d.toLocaleDateString('ru-RU');
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterTable, setFilterTable] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await auditLog.list();
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Уникальные пользователи для фильтра
  const users = [...new Set(rows.map(r => r.user_email))];

  const filtered = rows.filter(r => {
    if (filterUser && r.user_email !== filterUser) return false;
    if (filterAction && r.action !== filterAction) return false;
    if (filterTable && r.table_name !== filterTable) return false;
    return true;
  });

  return (
    <>
      <div className="head">
        <h1>Журнал действий</h1>
        <button className="btn ghost" onClick={load} style={{ fontSize: 13 }}>↻ Обновить</button>
      </div>

      {/* Фильтры */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}>
          <option value="">Все пользователи</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)} style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}>
          <option value="">Все действия</option>
          <option value="create">Создание</option>
          <option value="update">Изменение</option>
          <option value="delete">Удаление</option>
        </select>
        <select value={filterTable} onChange={e => setFilterTable(e.target.value)} style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}>
          <option value="">Все разделы</option>
          {Object.entries(TABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {(filterUser || filterAction || filterTable) && (
          <button className="btn ghost sm" onClick={() => { setFilterUser(''); setFilterAction(''); setFilterTable(''); }}>× Сбросить</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft)', alignSelf: 'center' }}>{filtered.length} записей</span>
      </div>

      <div className="card">
        {loading
          ? <div className="empty"><b>Загрузка...</b></div>
          : filtered.length === 0
          ? <div className="empty"><b>Действий пока нет</b>Журнал заполняется автоматически при работе с системой.</div>
          : (
            <table>
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Пользователь</th>
                  <th>Действие</th>
                  <th>Раздел</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDateTime(r.created_at)}</td>
                    <td style={{ fontSize: 13 }}>{r.user_email}</td>
                    <td>
                      <span style={{ display: 'inline-block', fontSize: 11, padding: '3px 9px', borderRadius: 999, fontWeight: 600, ...(ACTION_STYLE[r.action] || {}) }}>
                        {ACTION_LABEL[r.action] || r.action}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{TABLE_LABEL[r.table_name] || r.table_name}</td>
                    <td style={{ fontSize: 13 }}>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </>
  );
}
