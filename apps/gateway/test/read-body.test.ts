import { describe, expect, it } from 'vitest';
import { readTextWithLimit } from '../src/notify/read-body';

const bytes = (...values: number[]) => new Uint8Array(values);

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('readTextWithLimit', () => {
  it('treats a missing body as empty text', async () => {
    expect(await readTextWithLimit(null, 10)).toBe('');
  });

  it('joins chunks and decodes a character split across them', async () => {
    // "é" is 0xC3 0xA9.
    const text = await readTextWithLimit(
      streamOf(bytes(0x61, 0xc3), bytes(0xa9, 0x62)),
      10,
    );
    expect(text).toBe('aéb');
  });

  it('accepts exactly the limit', async () => {
    expect(await readTextWithLimit(streamOf(bytes(1, 2, 3)), 3)).toBe(
      '\u0001\u0002\u0003',
    );
  });

  it('returns null one byte over the limit, across chunks', async () => {
    expect(
      await readTextWithLimit(streamOf(bytes(1, 2), bytes(3, 4)), 3),
    ).toBeNull();
  });

  it('still returns null when cancelling the stream rejects', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(bytes(1, 2, 3, 4));
      },
      cancel() {
        return Promise.reject(new Error('cancel failed'));
      },
    });
    expect(await readTextWithLimit(stream, 3)).toBeNull();
  });

  it('releases the reader lock after going over the limit', async () => {
    const stream = streamOf(bytes(1, 2, 3, 4));
    await readTextWithLimit(stream, 3);
    expect(stream.locked).toBe(false);
  });

  it('releases the reader lock and rethrows when the stream errors', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('stream broke');
      },
    });
    await expect(readTextWithLimit(stream, 3)).rejects.toThrow('stream broke');
    expect(stream.locked).toBe(false);
  });
});
