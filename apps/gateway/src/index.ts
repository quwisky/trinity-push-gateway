import { Hono } from 'hono';
import { errorResponse } from './errors';

export const NOTIFY_PATH = '/_matrix/push/v1/notify';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));

// Method fallbacks. They sit after the real routes so only unsupported methods reach them.
app.all('/health', () =>
  errorResponse(405, 'M_UNRECOGNIZED', 'Method not allowed'),
);
app.all(NOTIFY_PATH, () =>
  errorResponse(405, 'M_UNRECOGNIZED', 'Method not allowed'),
);

app.notFound(() => errorResponse(404, 'M_NOT_FOUND', 'Not found'));

export default app;
