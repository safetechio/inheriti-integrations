const status = document.getElementById('status');
const select = document.getElementById('organization');
const signIn = document.getElementById('sign-in');
const signOut = document.getElementById('sign-out');
function render(state) {
  status.textContent = state.message || ({ 'signed-out': 'Sign in to choose a Business organization.', authorizing: 'Waiting for sign-in…', 'signed-in': 'Signed in.', error: 'Sign-in failed.' })[state.status];
  signIn.hidden = state.status === 'signed-in';
  signIn.disabled = state.status === 'authorizing';
  signOut.hidden = state.status !== 'signed-in' && state.status !== 'authorizing';
  signOut.textContent = state.status === 'authorizing' ? 'Cancel sign-in' : 'Sign out';
  select.replaceChildren();
  const placeholder = new Option('Choose an organization', '');
  select.add(placeholder);
  for (const organization of state.organizations) select.add(new Option(organization.name, organization.id));
  select.value = state.selectedId || '';
  select.disabled = state.status !== 'signed-in' || state.organizations.length === 0;
}
signIn.addEventListener('click', () => void window.inheritiTray.signIn().then(render));
signOut.addEventListener('click', () => void window.inheritiTray.signOut().then(render));
select.addEventListener('change', () => { if (select.value) void window.inheritiTray.select(select.value).then(render); });
document.getElementById('business').addEventListener('click', () => void window.inheritiTray.openBusiness().catch(() => { status.textContent = 'Set INHERITI_BUSINESS_URL to open Business.'; }));
window.inheritiTray.onStateChanged(render);
window.inheritiTray.onAction((action) => { status.textContent = `${action} is coming in the next release.`; });
void window.inheritiTray.state().then(render);
