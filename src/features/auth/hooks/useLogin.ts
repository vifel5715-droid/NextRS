import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { createLogger } from '@/lib/client-logger';
import { useNavigate } from '@/lib/next-router';
import { useAuth } from "@/components/providers/AuthProvider";
import { loginAction } from "@/features/auth/actions/auth";
import { landingPathFor } from "@/features/auth/landing-path";

const log = createLogger("useLogin");

function messageFor(response: Exclude<Awaited<ReturnType<typeof loginAction>>, { success: true }>): string {
  switch (response.error) {
    case "RATE_LIMITED":
      return response.message;
    case "INVALID_CREDENTIALS":
      return "Invalid username or password.";
    case "UNAVAILABLE":
      return "Sign-in is temporarily unavailable. Please try again in a few minutes.";
    default:
      return "Enter a valid username and password.";
  }
}

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
    if (isSubmitting.current) return;

    isSubmitting.current = true;
    setError('');
    setLoading(true);

    try {
      const response = await loginAction(formData.email, formData.password, rememberMe);
      if (!response.success) {
        setError(messageFor(response));
        return;
      }

      const { user: loggedIn } = response;
      const destination = landingPathFor(loggedIn);
      log.info("Login successful — role:", loggedIn.role, "redirecting to", destination);
      login(loggedIn);
      navigate(destination);
    } catch (err: unknown) {
      // Credential, throttling and server failures come back as data above;
      // reaching here means the request itself never completed.
      log.warn("Login request failed:", err);
      setError('Unable to reach the server. Please check your connection and try again.');
    } finally {
      isSubmitting.current = false;
      setLoading(false);
    }
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
