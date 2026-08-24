"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function InviteRedirectPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const finish = async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const description = params.get("error_description");

      if (description) {
        setError(description);
        return;
      }
      if (!accessToken || !refreshToken) {
        setError("This invitation link is invalid or has expired.");
        return;
      }

      const { error: sessionError } = await createClient().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        setError("This invitation link is invalid or has expired.");
        return;
      }

      window.history.replaceState(null, "", window.location.pathname);
      window.location.replace("/accept-invitation");
    };

    void finish();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-6 py-12">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Opening your invitation</h1>
        {error ? (
          <>
            <p role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-red-800">
              {error}
            </p>
            <a href="/login" className="mt-4 inline-flex min-h-11 items-center font-semibold text-emerald-700">
              Back to sign in
            </a>
          </>
        ) : (
          <p className="mt-3 text-stone-600">Verifying your secure HabFarms invitation…</p>
        )}
      </div>
    </main>
  );
}
