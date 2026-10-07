import React, { useState, useEffect } from "react";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import { createLogger } from "@shared/utils/logger";

const log = createLogger("Layout");

interface LayoutProps {
  children: React.ReactNode;
  hideSidebar?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children, hideSidebar = false }) => {
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

export default Layout;
