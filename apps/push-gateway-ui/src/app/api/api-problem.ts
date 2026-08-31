import { HttpErrorResponse } from '@angular/common/http';
import {
  ADMIN_PROBLEM_CATALOG,
  ADMIN_PROBLEM_SCHEMA,
} from './admin-contract.generated';

export type SafeApiProblem = Readonly<{
  title: string;
  detail?: string;
  status?: number;
}>;

const cleanText = (value: string, maximumLength: number): string =>
  value
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, maximumLength);

export const toSafeApiProblem = (error: unknown): SafeApiProblem => {
  if (!(error instanceof HttpErrorResponse)) {
    return { title: 'The Push Gateway UI request failed.' };
  }

  const parsed = ADMIN_PROBLEM_SCHEMA.safeParse(error.error);
  if (!parsed.success) {
    return {
      title: 'The Push Gateway UI request failed.',
      status: error.status || undefined,
    };
  }
  const definition = ADMIN_PROBLEM_CATALOG[parsed.data.code];

  const detail =
    typeof parsed.data.detail === 'string'
      ? cleanText(parsed.data.detail, 500)
      : undefined;

  return {
    title: definition.title,
    ...(detail ? { detail } : {}),
    status: definition.status,
  };
};
