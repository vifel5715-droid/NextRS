import React, { useState } from "react";
import { useLogin } from "@/features/auth/hooks/useLogin";
import brandIcon from "@/assets/stples.svg";

const UserIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const LockIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const EyeIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.7 20.7 0 0 1 5.06-6.06M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 8 11 8a20.7 20.7 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="M1 1l22 22" />
  </svg>
);

const Login: React.FC = () => {
  const {
    formData,
    rememberMe,
    loading,
    error,
    handleSubmit,
    handleFieldChange,
    setRememberMe,
  } = useLogin();

  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="login-page">
      <main className="login-wrapper">
        <div className="login-form-side">
          <div className="login-form-container">
            <div className="login-brand">
              <img
                src={brandIcon.src}
                alt="Company Logo"
                className="brand-icon"
                fetchPriority="high"
              />
            </div>

            <div className="login-header">
              <h2>Welcome back</h2>
              <p>Please sign in to access your dashboard</p>
            </div>

            {error && (
              <div id="login-error" className="error-message" role="alert">
                {error}
              </div>
            )}

            <form className="login-form" onSubmit={handleSubmit} aria-busy={loading}>
              <div className="form-field">
                <label htmlFor="username">Username</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <UserIcon />
                  </span>
                  <input
                    id="username"
                    type="text"
                    placeholder="Enter your username"
                    value={formData.email}
                    onChange={(e) => handleFieldChange("email", e.target.value)}
                    required
                    maxLength={254}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <LockIcon />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={(e) => handleFieldChange("password", e.target.value)}
                    required
                    maxLength={1024}
                    autoComplete="current-password"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="form-options">
                <label className="checkbox-label" htmlFor="rememberMe">
                  <input
                    id="rememberMe"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
              </div>

              <button
                type="submit"
                className="login-button"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>

            <div className="login-footer">
              <p>© 2026 Request System. All rights reserved.</p>
            </div>
          </div>
        </div>

        <div className="login-hero-side">
          <div className="hero-blob hero-blob-1" aria-hidden="true" />
          <div className="hero-blob hero-blob-2" aria-hidden="true" />
          <div className="hero-blob hero-blob-3" aria-hidden="true" />
          <div className="hero-content">
            <img
              src={brandIcon.src}
              alt="Company Logo"
              className="logo"
              width={1241}
              height={378}
            />
            <h1>Request Management System</h1>
            <p>
              Streamline requests, approvals, and inventory tracking in one
              place.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;