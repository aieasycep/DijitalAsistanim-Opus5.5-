/* global http, json, output, HARNESS_URL, ACTION, USER_KEY, SCENARIO, EMAIL, P_NOW, TYPES, PROBE, FIELD, EXPECT, PRODUCT */
// Maestro runScript bridge to the E2E harness (TEST_PLAN §9.1; scripts/e2e/harness-server.ts).
// Runs on the Maestro host (GraalJS: `http`, `json`, `output` and the env variables as globals).
// The harness listens on the host loopback, so the device never sees its secret key.
//
//   ACTION=seed   USER_KEY SCENARIO → output.user, output.ids, output.expect, output.t
//   ACTION=otp    EMAIL             → output.otp.code
//   ACTION=tick   P_NOW             → the scheduler tick at that instant
//   ACTION=drain  TYPES (a,b)       → worker runs until those job types are empty
//   ACTION=state  USER_KEY PROBE [FIELD EXPECT] → output.state; fails the flow on a mismatch
//   ACTION=revenuecat USER_KEY PRODUCT → the mock store reports the product active
//   ACTION=share_pdf                → adb ACTION_SEND of the synthetic PDF (Android CI)

var base =
  typeof HARNESS_URL !== 'undefined' && HARNESS_URL ? HARNESS_URL : 'http://127.0.0.1:8790';

function post(path, body) {
  var response = http.post(base + path, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error('harness ' + path + ' failed: ' + response.status + ' ' + response.body);
  }
  return json(response.body);
}

function get(path) {
  var response = http.get(base + path);
  if (!response.ok) {
    throw new Error('harness ' + path + ' failed: ' + response.status + ' ' + response.body);
  }
  return json(response.body);
}

var action = typeof ACTION !== 'undefined' ? ACTION : 'seed';

if (action === 'seed') {
  var seeded = post('/seed', {
    userKey: typeof USER_KEY !== 'undefined' ? USER_KEY : 'u_pro',
    scenario: typeof SCENARIO !== 'undefined' ? SCENARIO : 'canon',
  });
  output.user = seeded.user;
  output.ids = seeded.ids;
  output.expect = seeded.expect;
  output.t = seeded.t;
} else if (action === 'otp') {
  var code = '';
  for (var attempt = 0; attempt < 20 && code === ''; attempt++) {
    code = post('/otp', { email: EMAIL }).code;
  }
  if (code === '') throw new Error('harness: no OTP mail for ' + EMAIL);
  output.otp = { code: code };
} else if (action === 'tick') {
  post('/tick', { p_now: P_NOW });
} else if (action === 'drain') {
  post('/drain', { types: typeof TYPES !== 'undefined' && TYPES ? TYPES.split(',') : [] });
} else if (action === 'state') {
  var state = get(
    '/state?user=' + encodeURIComponent(USER_KEY) + '&probe=' + encodeURIComponent(PROBE),
  );
  output.state = state;
  if (typeof FIELD !== 'undefined' && FIELD) {
    var actual = String(state[FIELD]);
    if (actual !== String(EXPECT)) {
      throw new Error('probe ' + PROBE + '.' + FIELD + ' = ' + actual + ', expected ' + EXPECT);
    }
  }
} else if (action === 'revenuecat') {
  post('/revenuecat/activate', { userKey: USER_KEY, product: PRODUCT });
} else if (action === 'share_pdf') {
  post('/android/share-pdf', {});
} else {
  throw new Error('harness: unknown ACTION ' + action);
}
