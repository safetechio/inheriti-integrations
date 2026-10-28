let pendingAuth = null;

function currentAuth() {
  return pendingAuth;
}

function reserveAuth(auth) {
  if (pendingAuth) throw new Error('AUTH_IN_PROGRESS');
  pendingAuth = auth;
}

function clearAuth(auth) {
  if (pendingAuth === auth) pendingAuth = null;
}

async function cancelPendingAuthAndWait() {
  const auth = currentAuth();
  if (!auth) return;
  if (!auth.committing) {
    cancelPendingAuth();
    return;
  }
  if (auth.callbackPromise) await auth.callbackPromise;
}

function cancelPendingAuth() {
  if (!currentAuth()) return false;
  const auth = currentAuth();
  if (auth.committing) return false;
  clearAuth(auth);
  auth.cancelled = true;
  if (auth.listening) auth.callbackServer.close();
  auth.reject(new Error('AUTH_CANCELLED'));
  return true;
}

module.exports = {
  currentAuth,
  reserveAuth,
  clearAuth,
  cancelPendingAuth,
  cancelPendingAuthAndWait,
};
