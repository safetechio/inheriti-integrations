const { app, session } = require('electron');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const environment = process.env.INHERITI_ENV || 'local';
const issuer = `${process.env.SAFEID_URL || ''}/realms/${process.env.SAFEID_REALM || ''}`;
const apiOrigin = process.env.INHERITI_API_ORIGIN || '';
const registryPath = path.join(app.getPath('userData'), 'importer-accounts.json');
const contexts = new Map();
let activeKey;
let generation = 0;

function accountKey(subject) {
  if (typeof subject !== 'string' || !subject) throw new Error('AUTH_SUBJECT_INVALID');
  return createHash('sha256')
    .update(JSON.stringify([environment, apiOrigin, issuer, subject]))
    .digest('hex');
}

function newContext(subject, partition) {
  const key = accountKey(subject);
  return {
    key,
    subject,
    partition,
    session: session.fromPartition(partition),
    csrfToken: null,
    csrfInFlight: null,
  };
}

function activeContext() {
  return activeKey ? contexts.get(activeKey) : undefined;
}

function captureActiveContext() {
  return { context: activeContext(), generation };
}

function isCurrent(capture) {
  return capture.generation === generation && capture.context === activeContext();
}

function saveRegistry() {
  const contents = JSON.stringify({
    environment,
    apiOrigin,
    issuer,
    activeKey,
    profiles: Array.from(contexts.values(), ({ subject, partition }) => ({ subject, partition })),
  });
  const temporary = `${registryPath}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { mode: 0o600 });
  try {
    fs.renameSync(temporary, registryPath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

async function initializeSessions() {
  // The old partition contains only an obsolete login; do not adopt it.
  await session.fromPartition('persist:inheriti-api').clearStorageData({ storages: ['cookies'] });
  try {
    const saved = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (
      saved.environment !== environment ||
      saved.apiOrigin !== apiOrigin ||
      saved.issuer !== issuer ||
      !Array.isArray(saved.profiles)
    )
      return;
    for (const profile of saved.profiles) {
      if (
        typeof profile?.subject === 'string' &&
        profile.subject &&
        typeof profile.partition === 'string' &&
        /^persist:inheriti-api-[a-f0-9]{64}-[a-f0-9]{32}$/.test(profile.partition) &&
        profile.partition.startsWith(`persist:inheriti-api-${accountKey(profile.subject)}-`)
      ) {
        const context = newContext(profile.subject, profile.partition);
        contexts.set(context.key, context);
      }
    }
    if (typeof saved.activeKey === 'string' && contexts.has(saved.activeKey))
      activeKey = saved.activeKey;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function retainContext(context, makeActive) {
  const previous = contexts.get(context.key);
  const previousActive = activeKey;
  contexts.set(context.key, context);
  if (makeActive) activeKey = context.key;
  try {
    saveRegistry();
  } catch (error) {
    if (previous) contexts.set(context.key, previous);
    else contexts.delete(context.key);
    activeKey = previousActive;
    throw error;
  }
  if (previousActive !== activeKey || (previous && previousActive === context.key)) generation++;
  return previous;
}

function activateContext(context) {
  if (!context || context.revoked || contexts.get(context.key) !== context)
    throw new Error('AUTH_ACCOUNT_NOT_FOUND');
  if (activeKey === context.key) return;
  const previous = activeKey;
  activeKey = context.key;
  try {
    saveRegistry();
    generation++;
  } catch (error) {
    activeKey = previous;
    throw error;
  }
}

async function removeContext(context, beforeClear) {
  if (!context) return;
  const previousActive = activeKey;
  context.revoked = true;
  contexts.delete(context.key);
  if (activeKey === context.key) activeKey = undefined;
  try {
    saveRegistry();
  } catch (error) {
    contexts.set(context.key, context);
    activeKey = previousActive;
    context.revoked = false;
    throw error;
  }
  if (previousActive !== activeKey) generation++;
  let result;
  try {
    if (beforeClear) result = await beforeClear(context);
  } finally {
    await context.session.clearStorageData({ storages: ['cookies'] });
  }
  return result;
}

async function removeAllContexts(beforeClear) {
  const previous = new Map(contexts);
  const previousActive = activeKey;
  for (const context of contexts.values()) context.revoked = true;
  contexts.clear();
  activeKey = undefined;
  try {
    saveRegistry();
  } catch (error) {
    for (const [key, context] of previous) {
      context.revoked = false;
      contexts.set(key, context);
    }
    activeKey = previousActive;
    throw error;
  }
  generation++;
  const results = await Promise.allSettled(
    Array.from(previous.values(), async (context) => {
      let result;
      try {
        if (beforeClear) result = await beforeClear(context);
      } finally {
        await context.session.clearStorageData({ storages: ['cookies'] });
      }
      return result;
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.some((result) => result.value === true);
}

function stagedContext(subject) {
  return newContext(
    subject,
    `persist:inheriti-api-${accountKey(subject)}-${randomBytes(16).toString('hex')}`,
  );
}

function temporaryContext(subject) {
  return {
    key: accountKey(subject),
    subject,
    session: session.fromPartition(`inheriti-api-login-${randomBytes(16).toString('hex')}`),
    csrfToken: null,
    csrfInFlight: null,
  };
}

function contextForKey(key) {
  return contexts.get(key);
}
function listContexts() {
  return Array.from(contexts.values(), ({ key, subject }) => ({
    key,
    subject,
    active: key === activeKey,
  }));
}

module.exports = {
  activeContext,
  accountKey,
  captureActiveContext,
  isCurrent,
  initializeSessions,
  retainContext,
  activateContext,
  removeContext,
  removeAllContexts,
  temporaryContext,
  stagedContext,
  contextForKey,
  listContexts,
};
