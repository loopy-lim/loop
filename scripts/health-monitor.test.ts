import { expect, test } from 'bun:test';
import { advanceFindings } from './health-monitor';

test('monitor alerts only after two consecutive observations and does not repeat', () => {
  const finding = ['default:run-1:owner_lost_in_flight'];
  const first = advanceFindings({}, finding);
  expect(first.alerts).toEqual([]);
  const second = advanceFindings(first.state, finding);
  expect(second.alerts).toEqual(finding);
  expect(advanceFindings(second.state, finding).alerts).toEqual([]);
  const cleared = advanceFindings(second.state, []);
  expect(advanceFindings(cleared.state, finding).alerts).toEqual([]);
});
