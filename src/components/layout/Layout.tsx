import React, { createContext, useContext, useState, useEffect } from "react";
import Navbar from "@/components/layout/Navbar";
import Sidebar from "@/components/layout/Sidebar";
import { createLogger } from "@/lib/client-logger";

const log = createLogger("Layout");

/**
 * True below the persistent app shell (app/client-app.tsx), which renders the
 * one Layout for every dashboard route. Pages still wrap themselves in
 * <Layout>, but inside the shell that becomes a pass-through, so navigating
 * between pages never remounts the Navbar/Sidebar (or refetches the badge
 * counts they display).
 */
const InShellContext = createContext(false);

interface LayoutProps {
  children: React.ReactNode;
  hideSidebar?: boolean;
}

const ChromeLayout: React.FC<LayoutProps> = ({ children, hideSidebar = false }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    log.info("Mounted — hideSidebar:", hideSidebar);
    return () => { log.info("Unmounted"); };
  }, [hideSidebar]);

  const toggleMobileMenu = () => {
    log.log("Mobile menu toggled");
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    log.log("Mobile menu closed");
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="app-container">
      <Navbar onMenuToggle={toggleMobileMenu} />
      <div className="layout-wrapper">
        {!hideSidebar && (
          <>
            <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
              <Sidebar isOpen={true} onClose={closeMobileMenu} isDesktop={true} />
            </aside>
            {isMobileMenuOpen && <div className="sidebar-overlay active" onClick={closeMobileMenu}></div>}
          </>
        )}
        <main className={`main-content ${hideSidebar ? 'main-content-full' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
};

const Layout: React.FC<LayoutProps> = (props) => {
  const inShell = useContext(InShellContext);
  if (inShell) return <>{props.children}</>;
  return <ChromeLayout {...props} />;
};

/** The persistent chrome rendered once by the app shell; any <Layout> below it is a pass-through. */
export const ShellLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChromeLayout>
    <InShellContext.Provider value={true}>{children}</InShellContext.Provider>
  </ChromeLayout>
);

export default Layout;
