import { describe, it, expect } from 'vitest';
import { resolveSsmDocument } from '../../src/utils/ssm';

describe('ssm', () => {
  describe('resolveSsmDocument', () => {
    it('should forward to the managed node itself for loopback hosts', () => {
      for (const host of ['localhost', '127.0.0.1', '::1', '', '  ', undefined]) {
        expect(resolveSsmDocument(host)).toBe('AWS-StartPortForwardingSession');
      }
    });

    it('should forward through the managed node for any other host', () => {
      for (const host of ['db.eu-west-1.rds.amazonaws.com', '10.0.1.15', ' cache.internal ']) {
        expect(resolveSsmDocument(host)).toBe(
          'AWS-StartPortForwardingSessionToRemoteHost',
        );
      }
    });
  });
});
