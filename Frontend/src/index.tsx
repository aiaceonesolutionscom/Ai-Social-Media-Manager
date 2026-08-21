import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";

const clerkEnv = (import.meta as { env?: Record<string, string | undefined> }).env || {};
const clerkPublishableKey = clerkEnv.VITE_CLERK_PUBLISHABLE_KEY || "";
const clerkEnabled = clerkEnv.VITE_ENABLE_CLERK === "true" && !!clerkPublishableKey;

if (!clerkPublishableKey) {
  console.warn(
    "VITE_CLERK_PUBLISHABLE_KEY is not set. Clerk auth will not work. Add it to Frontend/.env",
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      {clerkEnabled ? (
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <App />
        </ClerkProvider>
      ) : (
        <App />
      )}
    </React.StrictMode>,
  );
}
