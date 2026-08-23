import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function logUnexpected(error: unknown, context: { route?: string; userId?: string; farmId?: string } = {}) {
  const requestId = crypto.randomUUID().slice(0, 8).toUpperCase();
  const detail = error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError", message: "Non-error failure" };
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), request_id: requestId, category: "unexpected", ...context, ...detail }));
  return requestId;
}
export function userMessage(error: unknown) {
  const requestId = logUnexpected(error);
  return `We couldn't complete that request. Please try again. Reference: ${requestId}`;
}
