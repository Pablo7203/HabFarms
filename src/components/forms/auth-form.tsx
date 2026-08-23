"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordAction, loginAction, resetPasswordAction, signupAction } from "@/app/actions/auth";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "login" | "signup" | "forgot" | "reset";
const configs = {
  login: { schema: loginSchema, title: "Welcome back", subtitle: "Sign in to manage your farm.", submit: "Sign in", pending: "Signing in..." },
  signup: { schema: signupSchema, title: "Create your account", subtitle: "Start with a secure workspace for your farm.", submit: "Create account", pending: "Creating account..." },
  forgot: { schema: forgotPasswordSchema, title: "Reset your password", subtitle: "We’ll email you a secure reset link.", submit: "Send reset link", pending: "Sending..." },
  reset: { schema: resetPasswordSchema, title: "Choose a new password", subtitle: "Use at least eight characters.", submit: "Update password", pending: "Updating..." },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const config = configs[mode]; const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  type AuthValues = { email: string; password: string; fullName: string };
  const resolver = zodResolver(config.schema) as unknown as Resolver<AuthValues>;
  const { register, handleSubmit, formState: { errors } } = useForm<AuthValues>({ resolver });
  const onSubmit = (values: Record<string, unknown>) => startTransition(async () => {
    const action = mode === "login" ? loginAction : mode === "signup" ? signupAction : mode === "forgot" ? forgotPasswordAction : resetPasswordAction;
    const result = await action(values); setMessage({ ok: result.ok, text: result.message }); if (result.ok && mode === "reset") router.push("/dashboard");
  });
  return <div className="w-full max-w-md"><div className="mb-8"><div className="mb-6 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-emerald-700 text-lg font-bold text-white">P</div><span className="font-semibold text-stone-900">Poultry Farm</span></div><h1 className="text-3xl font-bold tracking-tight text-stone-950">{config.title}</h1><p className="mt-2 text-stone-600">{config.subtitle}</p></div>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {mode === "signup" && <Field label="Full name" error={errors.fullName?.message as string | undefined}><Input autoComplete="name" {...register("fullName")} /></Field>}
      {mode !== "reset" && <Field label="Email address" error={errors.email?.message as string | undefined}><Input type="email" autoComplete="email" {...register("email")} /></Field>}
      {(mode === "login" || mode === "signup" || mode === "reset") && <Field label={mode === "reset" ? "New password" : "Password"} error={errors.password?.message as string | undefined}><Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} {...register("password")} /></Field>}
      {message && <p role="status" className={`rounded-lg border p-3 text-sm ${message.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{message.text}</p>}
      <Button className="w-full" disabled={pending}>{pending ? config.pending : config.submit}</Button>
    </form>
    <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600">{mode === "login" && <><Link className="font-medium text-emerald-700 hover:underline" href="/forgot-password">Forgot password?</Link><Link className="font-medium text-emerald-700 hover:underline" href="/signup">Create account</Link></>}{mode !== "login" && <Link className="font-medium text-emerald-700 hover:underline" href="/login">Back to sign in</Link>}</div>
  </div>;
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-stone-800">{label}<div className="mt-2">{children}</div>{error && <span className="mt-1 block text-sm text-red-700">{error}</span>}</label>; }
