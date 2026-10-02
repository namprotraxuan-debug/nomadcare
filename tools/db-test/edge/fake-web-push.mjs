// Fake npm:web-push for tools/db-test/edge/run-push.mjs: records calls; endpoints containing 'gone' answer 410,
// 'flaky' answer 500 (like a push service error), everything else 201.
export const calls = [];
const webpush = {
  vapid: null,
  setVapidDetails(subject, pub, priv) { webpush.vapid = { subject, pub, priv }; },
  async sendNotification(sub, payload, options) {
    calls.push({ sub, payload, options });
    if (/gone/.test(sub.endpoint)) { const e = new Error('Received unexpected response code'); e.statusCode = 410; throw e; }
    if (/flaky/.test(sub.endpoint)) { const e = new Error('Received unexpected response code'); e.statusCode = 500; throw e; }
    return { statusCode: 201, body: '', headers: {} };
  }
};
export default webpush;
