import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/context";
export default async function Home() { redirect((await getCurrentUser()) ? "/dashboard" : "/login"); }
