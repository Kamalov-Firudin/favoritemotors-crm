import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { changeMyPassword, clearMustChangePassword } from '../lib/api.js';

const TEMP_FORBIDDEN = '20242025';

export default function ForcePasswordChange({ email, onDone }) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (pwd.length < 8) return 'Пароль должен быть не короче 8 символов.';
    if (!/[A-Za-zА-Яа-я]/.test(pwd) || !/[0-9]/.test(pwd)) return 'Пароль должен содержать и буквы, и цифры.';
    if (pwd === TEMP_FORBIDDEN) return 'Нельзя оставить временный пароль — придумайте новый.';
    if (pwd !== confirm) return 'Пароли не совпадают.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setLoading(true); setError('');
    try {
      await changeMyPassword(pwd);
      await clearMustChangePassword();
      onDone?.();
    } catch (err) {
      setError(err?.message || 'Не удалось сменить пароль.');
      setLoading(false);
    }
  };

  const signOut = () => supabase.auth.signOut();

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1>Смена пароля</h1>
        <p>При первом входе нужно задать новый пароль.</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Логин</label>
            <input type="text" value={email} readOnly disabled />
          </div>
          <div className="field">
            <label>Новый пароль</label>
            <input
              type={show ? 'text' : 'password'}
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              placeholder="не короче 8 символов, буквы + цифры"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Подтвердите пароль</label>
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
            />
          </div>
          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 18px', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
            Показать пароль
          </label>
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%', padding: '11px' }}>
            {loading ? 'Сохранение...' : 'Сохранить и войти'}
          </button>
        </form>
        <button className="btn ghost sm" onClick={signOut} style={{ marginTop: 12, width: '100%', opacity: 0.7 }}>
          Выйти
        </button>
      </div>
    </div>
  );
}
