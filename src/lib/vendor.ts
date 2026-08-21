import type { VendorPaymentStatus } from "@prisma/client";

export const VENDOR_STATUS_LABEL: Record<VendorPaymentStatus, string> = {
  TO_PAY: "To pay",
  PAID: "Paid",
};

export const VENDOR_DOC_KIND_LABEL: Record<string, string> = {
  VENDOR_INVOICE: "Vendor invoice",
  PAYMENT_RECEIPT: "Payment receipt",
  OTHER: "Other",
};
