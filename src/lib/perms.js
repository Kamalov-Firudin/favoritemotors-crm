// src/lib/perms.js
// Права доступа по роли пользователя.
//   admin  — всё, включая физическое удаление (purge)
//   staff  — создаёт/правит/прячет в корзину и восстанавливает; НЕ удаляет физически
//   viewer — только чтение (инвестор)
import { createContext, useContext } from 'react';

export const PermsContext = createContext({ role: 'viewer', canWrite: false, canPurge: false });

export function permsForRole(role) {
  return {
    role: role || 'viewer',
    canWrite: role === 'admin' || role === 'staff',
    canPurge: role === 'admin',
    isViewer: role === 'viewer' || !role,
  };
}

export function usePerms() {
  return useContext(PermsContext);
}
