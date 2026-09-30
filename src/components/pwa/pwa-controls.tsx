"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let installedEventReceived = false;

function getInstalledSnapshot() {
  if (typeof window === "undefined") return false;
  return installedEventReceived || window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

function subscribeToInstalled(callback: () => void) {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const onInstalled = () => {
    installedEventReceived = true;
    callback();
  };
  displayMode.addEventListener("change", callback);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    displayMode.removeEventListener("change", callback);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function PwaControls() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const helpId = useId();
  const isInstalled = useSyncExternalStore(subscribeToInstalled, getInstalledSnapshot, () => false);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      installedEventReceived = true;
      setInstallPrompt(null);
      setInstallHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setInstallHelp((open) => !open);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  if (isInstalled) return null;

  return (
    <div className="relative flex w-full shrink-0 items-center gap-2">
      {!isInstalled && (
        <button type="button" onClick={install} aria-expanded={installHelp} aria-controls={helpId} className="inline-flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <Download size={18} aria-hidden="true" /> <span>Install app</span>
        </button>
      )}
      <div id={helpId} hidden={!installHelp} role="status" className="fixed left-3 right-3 top-[4.75rem] z-[70] mt-0 w-auto max-w-md rounded-xl border border-stone-200 bg-white p-4 text-left text-sm shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:z-50 sm:mt-2 sm:w-80">
          <p className="font-semibold text-stone-900">Install HabFarms</p>
          <p className="mt-1 text-stone-600">Use your browser&apos;s menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>. On iPhone or iPad, tap Share, then Add to Home Screen.</p>
      </div>
    </div>
  );
}
