/** A Matrix-style JSON error response: `{ errcode, error }`. */
export function errorResponse(
  status: number,
  errcode: string,
  error: string,
): Response {
  return Response.json({ errcode, error }, { status });
}
