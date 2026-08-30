import { BlockList, isIP } from 'node:net';

export type ClientIpHeader = 'cf-connecting-ip' | 'x-forwarded-for';

type ClientAddressOptions = {
  readonly clientIpHeader: ClientIpHeader;
  readonly directAddress: string | undefined;
  readonly headers: Headers;
  readonly trustedProxyCidrs: readonly string[];
};

function normalizedAddress(address: string): string | undefined {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(trimmed)?.[1];
  const normalized = mapped ?? trimmed;
  return isIP(normalized) === 0 ? undefined : normalized;
}

function trustedProxies(cidrs: readonly string[]): BlockList | undefined {
  const blockList = new BlockList();
  try {
    for (const cidr of cidrs) {
      const separator = cidr.lastIndexOf('/');
      if (separator <= 0) {
        return undefined;
      }
      const address = normalizedAddress(cidr.slice(0, separator));
      const prefix = Number(cidr.slice(separator + 1));
      if (address === undefined || !Number.isSafeInteger(prefix)) {
        return undefined;
      }
      const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
      const maximumPrefix = family === 'ipv4' ? 32 : 128;
      if (prefix < 0 || prefix > maximumPrefix) {
        return undefined;
      }
      blockList.addSubnet(address, prefix, family);
    }
    return blockList;
  } catch {
    return undefined;
  }
}

export function trustedProxyConfigurationValid(
  cidrs: readonly string[],
): boolean {
  return trustedProxies(cidrs) !== undefined;
}

function isTrusted(blockList: BlockList, address: string): boolean {
  return blockList.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}

export function clientAddress(options: ClientAddressOptions): string {
  const directAddress =
    options.directAddress === undefined
      ? undefined
      : normalizedAddress(options.directAddress);
  if (directAddress === undefined) {
    return 'unknown-source';
  }
  const blockList = trustedProxies(options.trustedProxyCidrs);
  if (
    blockList === undefined ||
    options.trustedProxyCidrs.length === 0 ||
    !isTrusted(blockList, directAddress)
  ) {
    return directAddress;
  }

  const header = options.headers.get(options.clientIpHeader);
  if (header === null) {
    return 'unknown-source';
  }
  if (options.clientIpHeader === 'cf-connecting-ip') {
    if (header.includes(',')) {
      return 'unknown-source';
    }
    return normalizedAddress(header) ?? 'unknown-source';
  }

  const chain = header
    .split(',')
    .map(normalizedAddress)
    .filter((address): address is string => address !== undefined);
  if (chain.length !== header.split(',').length) {
    return 'unknown-source';
  }
  chain.push(directAddress);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = chain[index];
    if (address !== undefined && !isTrusted(blockList, address)) {
      return address;
    }
  }
  return 'unknown-source';
}
