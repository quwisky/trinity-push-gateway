import { ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** App-owned subset of Spartan Helm's class-merging utility. */
export const hlm = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
