const { shell } = require('electron');
const { handle } = require('../lib/ipc-guard.cjs');
const { bearerApiFetch } = require('../lib/api-transport.cjs');
const { disconnectBusinessSocket } = require('../lib/business-socket.cjs');

function register(runtimeReady, runtime) {
  let pendingController;
  let pendingLogin;

  async function requestFor(subject, path) {
    const token = await runtime.getAccountAccessToken(subject);
    if (!token) return null;
    const response = await bearerApiFetch({
      method: 'GET', path, token, environment: runtime.environment,
    });
    return runtime.accounts.includes(subject) ? response : null;
  }

  async function session() {
    const capture = runtime.capture();
    if (!capture.subject) return null;
    const local = await runtime.sessionDescriptor();
    if (!local || !runtime.isCurrent(capture)) return null;
    const token = await runtime.getAccessToken(capture);
    if (!token || !runtime.isCurrent(capture)) return null;
    const response = await bearerApiFetch({
      method: 'GET', path: '/integrations/v1/importer/profile', token,
      environment: runtime.environment,
    });
    if (!runtime.isCurrent(capture)) return null;
    if (response.status === 401 || response.status === 403) return null;
    if (response.status !== 200) throw new Error('AUTH_PROFILE_UNAVAILABLE');
    const userId = response.body?.result?.id;
    if (typeof userId !== 'string' || !userId) return null;
    return {
      sessionFamilyId: local.sessionFamilyId,
      userId,
      expiresAt: local.expiresAt,
    };
  }

  async function login(activate = true) {
    if (pendingLogin) throw new Error('AUTH_IN_PROGRESS');
    const previous = runtime.capture();
    pendingController = new AbortController();
    const pending = runtime.login((url) => shell.openExternal(url), pendingController.signal, { activate });
    pendingLogin = pending;
    try {
      await pending;
      if (runtime.isCurrent(previous) && !activate) return null;
      disconnectBusinessSocket();
      const descriptor = await session();
      if (!descriptor) throw new Error('AUTH_SESSION_EXPIRED');
      return descriptor;
    } finally {
      if (pendingLogin === pending) {
        pendingLogin = undefined;
        pendingController = undefined;
      }
    }
  }

  async function cancelPending() {
    pendingController?.abort();
    if (pendingLogin) await pendingLogin.catch(() => {});
  }

  handle('auth:login', async () => { await runtimeReady; return login(); });
  handle('auth:add', async () => { await runtimeReady; return login(false); });
  handle('auth:accounts', async () => {
    await runtimeReady;
    return runtime.accounts.map((subject) => ({ key: subject, subject, active: subject === runtime.activeSubject }));
  });
  handle('auth:destinations', async () => {
    await runtimeReady;
    const subjects = Array.from(runtime.accounts);
    const results = await Promise.all(subjects.map(async (subject) => {
      const organizations = await requestFor(subject, '/integrations/v1/importer/organizations');
      if (!organizations || organizations.status === 401 || organizations.status === 403)
        return { accountKey: subject, subject, status: 'sign_in_required', organizations: [] };
      if (organizations.status !== 200 || !Array.isArray(organizations.body?.result?.items))
        throw new Error('AUTH_DESTINATIONS_FAILED');
      const profile = await requestFor(subject, '/integrations/v1/importer/profile');
      const person = profile?.status === 200 ? profile.body?.result : null;
      const displayName = [person?.firstName, person?.lastName]
        .filter((part) => typeof part === 'string' && part.trim()).join(' ').trim().slice(0, 80);
      return {
        accountKey: subject, subject, status: 'ready',
        displayName: displayName || (typeof person?.email === 'string' ? person.email.slice(0, 80) : ''),
        email: typeof person?.email === 'string' ? person.email.slice(0, 120) : '',
        organizations: organizations.body.result.items
          .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string')
          .map((item) => ({ id: item.id, name: item.name })),
      };
    }));
    return results.filter((result) => runtime.accounts.includes(result.subject));
  });
  handle('auth:activate', async (_event, subject) => {
    await runtimeReady;
    const response = await requestFor(subject, '/integrations/v1/importer/profile');
    if (response?.status !== 200) throw new Error('AUTH_SESSION_EXPIRED');
    disconnectBusinessSocket();
    runtime.activate(subject);
    const descriptor = await session();
    if (!descriptor) throw new Error('AUTH_SESSION_EXPIRED');
    return descriptor;
  });
  handle('auth:remove', async (_event, subject) => {
    await runtimeReady;
    await cancelPending();
    if (subject === runtime.activeSubject) disconnectBusinessSocket();
    return runtime.remove(subject);
  });
  handle('auth:logoutAll', async () => {
    await runtimeReady;
    await cancelPending();
    disconnectBusinessSocket();
    return runtime.logoutAll();
  });
  handle('auth:cancel', cancelPending);
  handle('auth:logout', async () => {
    await runtimeReady;
    await cancelPending();
    disconnectBusinessSocket();
    return runtime.activeSubject ? runtime.remove(runtime.activeSubject) : { remoteRevocationFailed: false };
  });
  handle('auth:session', async () => { await runtimeReady; return session(); });
}

module.exports = { register };
