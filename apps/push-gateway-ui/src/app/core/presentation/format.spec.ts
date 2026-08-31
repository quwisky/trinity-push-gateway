import {
  formatBytes,
  formatDuration,
  humanizeToken,
  operatorLabel,
} from './format';

describe('presentation formatting', () => {
  it('formats bounded byte and duration values without false precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toContain('1.5 KiB');
    expect(formatDuration(30)).toBe('30 sec');
    expect(formatDuration(3600)).toBe('1 hr');
    expect(formatDuration(172_800)).toBe('2 days');
  });

  it('turns fixed tokens and safe identities into readable labels', () => {
    expect(humanizeToken('outcome_unknown')).toBe('Outcome unknown');
    expect(
      operatorLabel({
        issuer: 'https://identity.example.test',
        subject: 'operator-1',
        displayName: 'Gateway Operator',
      }),
    ).toBe('Gateway Operator');
    expect(operatorLabel(null)).toBe('System or CLI');
  });
});
