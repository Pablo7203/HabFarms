"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md text-center"><h1 className="text-2xl font-bold">Something went wrong</h1><p className="mt-3 text-stone-600">We couldn’t load this page. Please try again.</p>{error.digest&&<p className="mt-2 text-xs text-stone-500">Reference: {error.digest}</p>}<Button className="mt-6" onClick={reset}>Try again</Button></div></main>; }
