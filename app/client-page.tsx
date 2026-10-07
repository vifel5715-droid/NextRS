"use client";

import dynamic from "next/dynamic";

const ClientApp = dynamic(() => import("./client-app"), {
  ssr: false,
  loading: () => <main aria-busy="true">Loading request system...</main>,
});

export default ClientApp;
