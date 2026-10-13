import React, { useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import styles from "@/components/layout/Navbar.module.css";
import { createLogger } from "@/lib/client-logger";
import stpsLogo from "@/assets/stples.svg";

const log = createLogger("Navbar");

interface NavbarProps {
  onMenuToggle: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onMenuToggle }) => {
  const { user, logout } = useAuth();

  useEffect(() => {
    log.info("Mounted — user:", user?.email ?? "none");
    return () => { log.info("Unmounted"); };
  }, [user?.email]);

  // Logout is a server round trip now (only the server can clear the httpOnly
  // cookie). ProtectedRoute redirects to /login on its own once the context
  // user clears, so there is nothing to navigate here.
  const handleLogout = async () => {
    log.info("Logout clicked by:", user?.email);
    await logout();
  };

  return (
    <nav className="navbar">
      <button
        className="mobile-menu-toggle"
        onClick={onMenuToggle}
        aria-label="Toggle navigation"
      >
        ☰
      </button>

      <div className="navbar-brand">
        <div className="navbar-brand-icon"><img src={stpsLogo.src} alt="STPL Logo" className={styles.logoImage} /></div>
        <span>Request System</span>
      </div>

      <div className="navbar-content">
        {user && (
          <>
            <div className="navbar-user">
              <div className="navbar-user-name">{user.name}</div>
              <div className="navbar-user-role">
                {user.role?.toLowerCase() === 'staff' ? user.department : `${user.role} • ${user.department}`}
              </div>
            </div>

            <button
              onClick={handleLogout}
              className={`btn btn-ghost ${styles.logoutButton}`}
            >
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
