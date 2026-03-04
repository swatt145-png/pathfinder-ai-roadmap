export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  const code = Array.from(arr, b => chars[b % chars.length]).join('');
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
