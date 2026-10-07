"use client";

import { useEffect } from "react";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled Next.js page error.");
  }, []);

  return (
    <main className="not-found-page" role="alert">
      <h1>Something went wrong</h1>
      <p>The page could not be loaded. Please try again.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
