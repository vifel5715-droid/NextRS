import React from "react";
import stpsLogo from "../../assets/stples.svg";
import styles from "./LoadingScreen.module.css";

interface LoadingScreenProps {
  label?: string;
  /** Fills the viewport when true (route/auth gate); sits inline within its parent otherwise (Suspense fallback inside the already-chromed layout). */
  fullScreen?: boolean;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ label = "Loading", fullScreen = true }) => (
  <div className={`${styles.wrap} ${fullScreen ? styles.fullScreen : ""}`} role="status" aria-live="polite">
    <div className={styles.spinnerBox}>
      <div className={styles.ring} />
      <img src={stpsLogo.src} alt="" className={styles.logo} />
    </div>
    <span className={styles.label}>{label}</span>
  </div>
);

export default LoadingScreen;
