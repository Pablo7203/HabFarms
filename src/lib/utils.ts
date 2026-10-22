import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ZodError } from "zod";
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

/** Convert a database/service failure into safe, useful action feedback. Keep the
 * original details in server logs; never return arbitrary Postgres text to a user. */
export function actionErrorMessage(error: unknown, fallback: string) {
  const requestId = logUnexpected(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const detail = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message).toLowerCase()
    : "";

  if (code === "42501" || /permission denied|access denied|not authorized/.test(detail)) {
    return "You don't have permission to make this change. Ask a farm administrator if you need access.";
  }
  if (code === "23505" || /already exists|duplicate key/.test(detail)) {
    return "A record with these details already exists. Check the existing records and try again.";
  }
  if (code === "23503" || /foreign key/.test(detail)) {
    return "One of the selected records is no longer available. Refresh the page, review your selections, and try again.";
  }
  if (code === "23514" || /check constraint/.test(detail)) {
    return `Some values are outside the allowed range. Review the form and try again. Reference: ${requestId}`;
  }
  return `${fallback} Reference: ${requestId}`;
}

/** Replace Zod's low-level invalid-type wording with field-level guidance. */
export function validationMessage(error: ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Some information is missing. Review the form and try again.";
  if (issue.message.startsWith("Invalid input: expected")) {
    const field = issue.path.map(part => String(part).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()).join(" ");
    return field
      ? `Check ${field}; it is missing or has an invalid value. Choose or enter a valid value, then try again.`
      : "A required value is missing or invalid. Review the form and try again.";
  }
  return issue.message;
}
