import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
      setSessionExpired(false);
      return data.user;
    } catch (err) {
      setUser(null);
      if (err.status === 401) {
        // only mark expired if we previously had a user or came from a protected route
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (identifier, password) => {
    const data = await authApi.login({ identifier, password });
    setUser(data.user);
    setSessionExpired(false);
    return data.user;
  };

  const register = async (payload) => {
    const data = await authApi.register(payload);
    setUser(data.user);
    setSessionExpired(false);
    return data.user;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    setUser(null);
  };

  const updateProfile = async (updates) => {
    const data = await authApi.updateProfile(updates);
    setUser(data.user);
    return data.user;
  };

  const changePassword = async (currentPassword, newPassword) => {
    return authApi.changePassword({ currentPassword, newPassword });
  };

  const handleAuthError = useCallback((err) => {
    if (err?.status === 401) {
      setUser(null);
      setSessionExpired(true);
    }
  }, []);

  const value = {
    user,
    loading,
    sessionExpired,
    setSessionExpired,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    refresh,
    handleAuthError,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
