export function accountDisplayName(account) {
  const name = account.name?.trim();
  return name && name !== account.subject && !name.includes('@') && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(name)
    ? name : 'Saved account';
}
