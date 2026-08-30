import type { Env } from './cloudflare-env';
import { cloudflareRuntime } from './cloudflare-runtime';
import {
  createRuntimeGateway,
  gatewayStorageUnavailableResponse,
  type GatewayDependencies,
  type GatewayRuntimeEnvironment,
} from './gateway';

type GatewayHandler = {
  readonly fetch: (
    request: Request,
    env: Env,
    context: ExecutionContext,
  ) => Promise<Response>;
  readonly scheduled: (
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ) => Promise<void>;
};

export function createGateway(
  dependencies: GatewayDependencies,
): GatewayHandler {
  const runtimeGateway = createRuntimeGateway(dependencies);
  const runtimeEnvironment = (env: Env): GatewayRuntimeEnvironment => ({
    ...env,
    ...cloudflareRuntime(env),
    sourceKey: (request) =>
      request.headers.get('cf-connecting-ip') ?? 'unknown-source',
  });
  return {
    async fetch(request, env): Promise<Response> {
      try {
        return await runtimeGateway.fetch(request, runtimeEnvironment(env));
      } catch {
        console.info({ event: 'storage_failure', outcome: 'retryable' });
        return gatewayStorageUnavailableResponse();
      }
    },
    async scheduled(controller, env): Promise<void> {
      const runtime = runtimeEnvironment(env);
      await runtimeGateway.cleanup(runtime, controller.scheduledTime);
    },
  };
}

export default createGateway({
  log(event) {
    console.info(event);
  },
  now: Date.now,
});
