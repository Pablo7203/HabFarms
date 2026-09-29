"use client";

import { useEffect } from "react";

const LEGACY_DATABASE = "habfarms-offline-operations";
const LEGACY_CACHE_PREFIX = "habfarms-pwa-shell-";

/** Remove only storage owned by the retired offline-records prototype. */
export function LegacyOfflineCleanup() {
  useEffect(() => {
    let cancelled = false;

    async function cleanup() {
      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          const legacy = registrations.filter((registration) => {
            const worker = registration.active ?? registration.waiting ?? registration.installing;
            if (!worker) return false;
            const script = new URL(worker.scriptURL);
            return script.origin === window.location.origin && script.pathname === "/sw.js";
          });
          await Promise.all(legacy.map(async (registration) => {
            // The replacement worker clears its own caches and unregisters
            // itself on activation. Do not unregister here mid-update.
            try { await registration.update(); } catch { /* retry on a later visit */ }
          }));
        }

        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.all(names
            .filter((name) => name.startsWith(LEGACY_CACHE_PREFIX))
            .map((name) => caches.delete(name)));
        }

        if ("indexedDB" in window && !cancelled) {
          await new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(LEGACY_DATABASE);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            // Another tab may still have the prototype open. Its pending delete
            // request can complete when that tab closes its database handle.
            request.onblocked = () => resolve();
          });
        }
      } catch {
        // Storage cleanup must never prevent ordinary signed-in app use.
      }
    }

    void cleanup();
    return () => { cancelled = true; };
  }, []);

  return null;
}
