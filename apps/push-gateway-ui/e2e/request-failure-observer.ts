import type { Page, Request } from '@playwright/test';

type ObservedRequestFailure = Readonly<{
  errorText: string;
  expectedCancellation: boolean;
  request: Request;
}> & {
  classification?: Promise<string | undefined>;
};

const formatRequestFailure = (request: Request, errorText: string): string =>
  `${request.method()} ${request.url()}: ${errorText}`;

export const classifyRequestFailure = async (
  page: Page,
  request: Request,
  errorText: string,
): Promise<string | undefined> => {
  if (errorText !== 'net::ERR_ABORTED') {
    return formatRequestFailure(request, errorText);
  }

  try {
    const response = await request.response();
    const contentLengthHeader = response?.headers()['content-length'];
    const contentLength =
      contentLengthHeader !== undefined && /^\d+$/u.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : undefined;
    const requestStartTime = request.timing().startTime;
    const resourceTiming = await page.evaluate(
      ({ requestStartTime, url }) => {
        const candidates = performance
          .getEntriesByType('resource')
          .filter(
            (entry): entry is PerformanceResourceTiming => entry.name === url,
          )
          .map((entry) => ({
            encodedBodySize: entry.encodedBodySize,
            requestStartDelta: Math.abs(
              performance.timeOrigin + entry.startTime - requestStartTime,
            ),
            responseEnd: entry.responseEnd,
            responseStatus: entry.responseStatus,
          }))
          .sort(
            (left, right) => left.requestStartDelta - right.requestStartDelta,
          );
        return candidates.at(0);
      },
      { requestStartTime, url: request.url() },
    );

    // Chromium can emit requestfailed after Angular has rendered a response.
    // The caller asserts that rendered state before resolving observations.
    // Resource Timing supplies the actual encoded bytes; Playwright's sizes()
    // can copy Content-Length even when the response was truncated.
    if (
      response?.ok() === true &&
      Number.isSafeInteger(contentLength) &&
      resourceTiming?.requestStartDelta !== undefined &&
      resourceTiming.requestStartDelta < 10 &&
      resourceTiming.responseEnd > 0 &&
      resourceTiming.responseStatus === response.status() &&
      resourceTiming.encodedBodySize === contentLength
    ) {
      return undefined;
    }
  } catch {
    // Missing response evidence is itself evidence that the failure is real.
  }

  return formatRequestFailure(request, errorText);
};

export const observeRequestFailures = (
  page: Page,
): Readonly<{
  beginExpectedCancellation: () => void;
  unexpectedFailures: () => Promise<string[]>;
}> => {
  const observed: ObservedRequestFailure[] = [];
  let expectCancellation = false;
  page.on('requestfailed', (request) => {
    observed.push({
      errorText: request.failure()?.errorText ?? 'unknown error',
      expectedCancellation: expectCancellation,
      request,
    });
  });

  return {
    beginExpectedCancellation: () => {
      expectCancellation = true;
    },
    unexpectedFailures: async () =>
      (
        await Promise.all(
          observed.map((failure) => {
            failure.classification ??= failure.expectedCancellation
              ? Promise.resolve(undefined)
              : classifyRequestFailure(
                  page,
                  failure.request,
                  failure.errorText,
                );
            return failure.classification;
          }),
        )
      ).filter((failure): failure is string => failure !== undefined),
  };
};
