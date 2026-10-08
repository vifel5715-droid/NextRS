import { useState, useEffect, useRef, useCallback } from 'react';
import { createLogger } from '@shared/utils/logger';
import { getErrorMessage, getErrorStatus } from '@shared/utils/errorMessage';

const log = createLogger("useLogin");
import type React from 'react';
import { useNavigate } from '@shared/next-router';
import { useAuth } from "@app/providers/AuthProvider";
import { loginAction } from "@server/actions/auth";

const ROLE_REDIRECT_MAP: Record<string, string> = {
  staff: '/dashboard/staff',
  secretary: '/dashboard/staff',
  supervisor: '/dashboard/staff',
  manager: '/dashboard/staff',
  custodian: '/dashboard/custodian',
  admin: '/dashboard/admin',
  director: '/dashboard/overview',
  purchaser: '/dashboard/purchaser',
  ap_officer: '/dashboard/ap-officer',
};

let globalLoginLock = false;

export const useLogin = () => {
  const { login, user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSubmitting = useRef(false);
  const hasMounted = useRef(false);
  const lastSubmitTime = useRef(0);
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formSubmitted = useRef(false);

  // Already-signed-in visitors landing on /login go straight to their
  // dashboard. Role comes from context (the server's answer) rather than a
  // parsed sessionStorage blob — there is no client-side copy any more.
  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      navigate(ROLE_REDIRECT_MAP[user.role] || '/dashboard/staff');
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      globalLoginLock = false;
    };
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!hasMounted.current) hasMounted.current = true;
    if (globalLoginLock) return;
    if (formSubmitted.current) return;

    const now = Date.now();
    if (isSubmitting.current || loading) return;
    if (now - lastSubmitTime.current < 2000) return;

    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

    log.info("Login attempt:", formData.email);
    globalLoginLock = true;
    formSubmitted.current = true;
    setError('');
    setLoading(true);
    isSubmitting.current = true;
    lastSubmitTime.current = now;

    try {
      const response = await loginAction(formData.email, formData.password);
      if (!response.success) {
        setError(
          response.error === "INVALID_CREDENTIALS"
            ? "Invalid username or password."
            : "Enter a valid username and password."
        );
        return;
      }

      const { user: loggedIn } = response;
      log.info("Login successful — role:", loggedIn.role, "redirecting to", ROLE_REDIRECT_MAP[loggedIn.role] || '/dashboard');
      login(loggedIn);
      navigate(ROLE_REDIRECT_MAP[loggedIn.role] || '/dashboard');
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      log.warn("Login failed — HTTP status:", status ?? "no response");
      if (status === 401 || status === 403) {
        setError(getErrorMessage(err, 'Invalid email or password.'));
      } else if (status === 429) {
        setError('Too many login attempts. Please try again later.');
      } else if (!status) {
        setError('Unable to reach the server. Please check your connection.');
      } else {
        setError('Server error. Please try again later.');
      }
    } finally {
      globalLoginLock = false;
      setLoading(false);
      isSubmitting.current = false;
      setTimeout(() => { formSubmitted.current = false; }, 1000);
      debounceTimeout.current = setTimeout(() => { lastSubmitTime.current = 0; }, 3000);
    }
  }, [formData.email, formData.password, login, navigate, loading]);

  const handleFieldChange = (field: 'email' | 'password', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return {
    formData,
    rememberMe,
    loading,
    error,
    authLoading,
    isSubmitting,
    handleSubmit,
    handleFieldChange,
    setRememberMe,
  };
};
