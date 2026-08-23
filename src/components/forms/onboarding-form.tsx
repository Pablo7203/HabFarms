"use client";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createFarmAction } from "@/app/actions/farm";
import { farmNameSchema } from "@/lib/validation/farm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const schema = z.object({ name: farmNameSchema });
export function OnboardingForm() { const [pending, startTransition] = useTransition(); const [error, setError] = useState(""); const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) }); return <form className="mt-8 space-y-5" onSubmit={handleSubmit(({ name }) => startTransition(async () => { const result = await createFarmAction(name); if (!result.ok) setError(result.message); }))}><label className="block text-sm font-medium">Farm name<Input className="mt-2" autoFocus placeholder="e.g. Green Valley Layers" {...register("name")} /></label>{errors.name && <p className="text-sm text-red-700">{errors.name.message}</p>}{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<Button className="w-full" disabled={pending}>{pending ? "Creating farm..." : "Create farm"}</Button></form>; }
