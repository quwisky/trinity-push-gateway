/**
 * Reads a request body as UTF-8 text, giving up as soon as it exceeds `limit`
 * bytes. Returns `null` (after cancelling the stream) when the limit is crossed,
 * so an oversized chunked body is never buffered beyond `limit` plus one chunk.
 */
export async function readTextWithLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string | null> {
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        // The verdict is already decided: a stream that cannot be cancelled
        // must not turn the 413 into a 500.
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
