import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** Resolves after `ms` milliseconds — used by mock services to simulate latency. */
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
