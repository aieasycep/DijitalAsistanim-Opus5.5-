import { test } from 'node:test';
import assert from 'node:assert/strict';
import { junitFailures } from '../junit-failures.ts';

test('failed and errored Maestro test cases are listed with their reason', () => {
  const xml = [
    '<?xml version="1.0"?><testsuites><testsuite name="Test Suite" tests="4" failures="2">',
    '<testcase id="a" name="E2E-M-01 · Onboarding" classname="E2E-M-01" time="3.1"/>',
    '<testcase id="b" name="E2E-M-02 · Auth" classname="E2E-M-02">',
    '<failure message="Element not found: Id matching regex: auth.code.input"></failure>',
    '</testcase>',
    '<testcase id="c" name="E2E-E · Plan &quot;Planla&quot; → proposal" classname="E2E-E">',
    '<error>harness /seed failed: 500 &lt;boom&gt; &amp; more\nstack</error></testcase>',
    '<testcase id="d" name="E2E-S-01" classname="E2E-S-01"></testcase>',
    '</testsuite></testsuites>',
  ].join('\n');
  assert.deepEqual(junitFailures(xml), [
    { name: 'E2E-M-02 · Auth', message: 'Element not found: Id matching regex: auth.code.input' },
    {
      name: 'E2E-E · Plan "Planla" → proposal',
      message: 'harness /seed failed: 500 <boom> & more\nstack',
    },
  ]);
  assert.deepEqual(junitFailures(''), []);
  assert.deepEqual(junitFailures('<testcase name="x"'), []);
});
