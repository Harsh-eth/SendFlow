export function shortWallet(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function htmlWallet(address: string): string {
  return `<code>${shortWallet(address)}</code>`;
}

export function solscanTxLink(txHash: string, label = "View on Solscan"): string {
  return `<a href="https://solscan.io/tx/${txHash}">${label}</a>`;
}

export function solscanAddrLink(address: string, label?: string): string {
  return `<a href="https://solscan.io/account/${address}">${label ?? shortWallet(address)}</a>`;
}
