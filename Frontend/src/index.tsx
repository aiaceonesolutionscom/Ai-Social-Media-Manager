import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";

const clerkPublishableKey = (import.meta as { env?: { VITE_CLERK_PUBLISHABLE_KEY?: string } }).env?.VITE_CLERK_PUBLISHABLE_KEY || "";

if (!clerkPublishableKey) {
  console.warn(
    "VITE_CLERK_PUBLISHABLE_KEY is not set. Clerk auth will not work. Add it to Frontend/.env",
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <App />
      </ClerkProvider>
    </React.StrictMode>
  );
}
