import { useState, useEffect, useRef, useCallback } from 'react';
import { createLogger } from '@/lib/client-logger';

const log = createLogger("useLogin");
import type React from 'react';
import { useNavigate } from '@/lib/next-router';
import { useAuth } from "@/components/providers/AuthProvider";
import { loginAction } from "@/features/auth/actions/auth";

const ROLE_REDIRECT_MAP: Record<string, string> = {
  staff: '/requests/pending',
  secretary: '/requests/pending',
  supervisor: '/requests/pending',
  manager: '/requests/pending',
  custodian: '/approvals/custodian',
  admin: '/settings',
  director: '/dashboard',
  purchaser: '/approvals/purchaser',
  ap_officer: '/approvals/ap-officer',
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
      navigate(ROLE_REDIRECT_MAP[user.role] || '/requests');
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
          response.error === "RATE_LIMITED"
            ? response.message
            : response.error === "INVALID_CREDENTIALS"
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
      // Credential and throttling failures come back as data above; reaching
      // here means the request itself failed (network, or a server error
      // whose details Next.js withholds from the client).
      log.warn("Login request failed:", err);
      setError('Unable to sign in right now. Please check your connection and try again.');
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
