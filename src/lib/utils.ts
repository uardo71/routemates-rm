import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parses a comma-separated multi-select filter value from a URL search param. */
export function parseList(value: string | undefined | null): string[] {
  return value ? value.split(",").filter(Boolean) : []
}
