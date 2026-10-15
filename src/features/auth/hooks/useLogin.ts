import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { createLogger } from '@/lib/client-logger';
import { useNavigate } from '@/lib/next-router';
import { useAuth } from "@/components/providers/AuthProvider";
import { loginAction } from "@/features/auth/actions/auth";
import { landingPathFor } from "@/features/auth/landing-path";
import { submitLogin } from "@/features/auth/hooks/submitLogin";

const log = createLogger("useLogin");

export const useLogin = () => {
  const { login, user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Synchronous single-flight guard: `loading` state only blocks a second
  // submit after React re-renders, a ref blocks it immediately.
  const isSubmitting = useRef(false);

  // Already-signed-in visitors landing on /login go straight to their
  // dashboard. Role comes from context (the server's answer).
  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      navigate(landingPathFor(user));
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await submitLogin(
      { username: formData.email, password: formData.password, rememberMe },
      {
        inFlight: isSubmitting,
        loginAction,
        setLoading,
        setError,
        onSuccess: (loggedIn) => {
          const destination = landingPathFor(loggedIn);
          log.info("Login successful — role:", loggedIn.role, "redirecting to", destination);
          login(loggedIn);
          navigate(destination);
        },
        onNetworkError: (err) => log.warn("Login request failed:", err),
      }
    );
  }, [formData.email, formData.password, rememberMe, login, navigate]);

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
