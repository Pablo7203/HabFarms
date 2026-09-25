import { redirect } from "next/navigation";

export const metadata = { title: "Sign in" };

export default function SignupPage() {
  redirect("/login");
}
