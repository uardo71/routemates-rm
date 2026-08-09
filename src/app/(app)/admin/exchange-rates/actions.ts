"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

const CURRENCIES = ["ALL", "EUR", "USD"] as const;

const ExchangeRateSchema = z
  .object({
    fromCurrency: z.enum(CURRENCIES),
    toCurrency: z.enum(CURRENCIES),
    rate: z.coerce.number().positive("Must be a positive number"),
    effectiveFrom: z.string().min(1, "Effective date is required"),
  })
  .refine((d) => d.fromCurrency !== d.toCurrency, {
    message: "From and to currency must be different",
    path: ["toCurrency"],
  });

export async function createExchangeRateAction(_prevState: string | undefined, formData: FormData) {
  await requirePermission("salaries:manage");

  const parsed = ExchangeRateSchema.safeParse({
    fromCurrency: formData.get("fromCurrency"),
    toCurrency: formData.get("toCurrency"),
    rate: formData.get("rate"),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  await prisma.exchangeRate.create({
    data: {
      fromCurrency: data.fromCurrency,
      toCurrency: data.toCurrency,
      rate: data.rate,
      effectiveFrom: new Date(data.effectiveFrom),
    },
  });

  revalidatePath("/admin/exchange-rates");
  redirect("/admin/exchange-rates");
}

export async function deleteExchangeRateAction(exchangeRateId: string) {
  await requirePermission("salaries:manage");

  await prisma.exchangeRate.delete({ where: { id: exchangeRateId } });
  revalidatePath("/admin/exchange-rates");
}
