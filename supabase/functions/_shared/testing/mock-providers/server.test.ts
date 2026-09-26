/** The mock provider server listens on loopback or a private IPv4 address only. */
import { assertEquals, assertThrows } from '@std/assert';
import { mockHostname } from './server.ts';

Deno.test(
  'mockHostname: loopback by default; loopback and private IPv4 (Docker bridge) accepted',
  () => {
    assertEquals(mockHostname(undefined), '127.0.0.1');
    assertEquals(mockHostname(' '), '127.0.0.1');
    for (const host of [
      '127.0.0.1',
      '127.0.0.2',
      'localhost',
      '::1',
      '172.17.0.1',
      '172.31.255.254',
      '10.0.0.5',
      '192.168.1.10',
    ]) {
      assertEquals(mockHostname(host), host);
    }
  },
);

Deno.test('mockHostname: wildcards, public addresses and names are refused', () => {
  for (const host of [
    '0.0.0.0',
    '::',
    '8.8.8.8',
    '172.32.0.1',
    '172.15.0.1',
    '192.169.0.1',
    '256.0.0.1',
    'example.com',
    'host.docker.internal',
  ]) {
    assertThrows(() => mockHostname(host), Error, 'MOCK_PROVIDERS_HOSTNAME');
  }
});
