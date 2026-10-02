"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type ActionResult = { ok: boolean; message: string } | void;

type ConfirmActionDialogProps = {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  triggerClassName?: string;
  disabled?: boolean;
  onConfirm: () => Promise<ActionResult>;
};

export function ConfirmActionDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  triggerClassName,
  disabled = false,
  onConfirm,
}: ConfirmActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const titleId = useId();

  function close() {
    setError("");
    dialogRef.current?.close();
  }

  function confirm() {
    setError("");
    startTransition(async () => {
      try {
        const result = await onConfirm();
        if (result && !result.ok) {
          setError(result.message);
          return;
        }
        close();
      } catch {
        setError("We couldn't complete that action. Please try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => dialogRef.current?.showModal()}
        className={triggerClassName}
      >
        {triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-description`}
        onClick={(event) => {
          if (event.target === dialogRef.current && !pending) close();
        }}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/50"
      >
        <div className="p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
            Please confirm
          </p>
          <h2 id={titleId} className="mt-2 text-xl font-bold tracking-tight">
            {title}
          </h2>
          <p id={`${titleId}-description`} className="mt-2 text-sm leading-6 text-stone-600">
            {description}
          </p>
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={confirm}
              className="bg-red-700 text-white hover:bg-red-800"
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
