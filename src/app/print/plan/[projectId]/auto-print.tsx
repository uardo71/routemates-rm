"use client";

import { useEffect } from "react";

// Opens the browser print dialog on load so the customer-ready plan can be saved as PDF. A visible
// button is kept as a fallback (and for re-printing after the auto-dialog is dismissed).
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <button
      onClick={() => window.print()}
      className="fixed right-5 top-5 z-50 rounded-md bg-[#141F2B] px-4 py-2 text-sm font-medium text-white shadow-lg print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
