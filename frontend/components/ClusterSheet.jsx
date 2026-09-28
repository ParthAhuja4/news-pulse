"use client";

import { useEffect, useRef } from "react";

// Bottom sheet for phones and tablets. Built on the native <dialog>, which
// provides the focus trap, Esc to close and the backdrop.
export default function ClusterSheet({ open, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Stop the page behind the sheet from scrolling.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label="Topic articles"
      onClose={onClose}
      onClick={(e) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (e.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] min-h-[50dvh] w-full max-w-none flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/50 open:flex motion-safe:open:animate-sheet-up sm:max-w-2xl"
    >
      <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border"
        />
        {children}
      </div>
    </dialog>
  );
}
