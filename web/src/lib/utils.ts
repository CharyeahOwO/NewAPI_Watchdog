import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function percent(value?: number | null) {
  if (value === null || value === undefined) return "-"
  return `${Math.round(value * 1000) / 10}%`
}

export function seconds(value?: number | null) {
  if (value === null || value === undefined) return "-"
  return `${Math.round(value / 10) / 100}秒`
}
