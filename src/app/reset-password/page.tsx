import { AuthForm } from "@/components/forms/auth-form";
export const metadata = { title: "Reset password" }; export default function ResetPage() { return <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12"><AuthForm mode="reset" /></main>; }
