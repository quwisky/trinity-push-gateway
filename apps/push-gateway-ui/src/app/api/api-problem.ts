import { HttpErrorResponse } from '@angular/common/http';
import { apiProblemSchema } from '../core/validation/schemas';

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

  const parsed = apiProblemSchema.safeParse(error.error);
  if (!parsed.success) {
    return {
      title: 'The Push Gateway UI request failed.',
      status: error.status || undefined,
    };
  }

  const title = parsed.data.title
    ? cleanText(parsed.data.title, 160)
    : 'The Push Gateway UI request failed.';
  const detail = parsed.data.detail
    ? cleanText(parsed.data.detail, 500)
    : undefined;

  return {
    title: title || 'The Push Gateway UI request failed.',
    ...(detail ? { detail } : {}),
    status: parsed.data.status ?? (error.status || undefined),
  };
};
