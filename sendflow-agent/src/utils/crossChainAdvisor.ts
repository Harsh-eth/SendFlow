export function detectChain(address: string): "solana" | "ethereum" | "bitcoin" | "unknown" {
  const t = address.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) && !t.startsWith("0x")) return "solana";
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return "ethereum";
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(t)) return "bitcoin";
  return "unknown";
}

export function getCrossChainAdvice(fromChain: string, toChain: string): string {
  if (fromChain === "solana" && toChain === "ethereum") {
    return [
      `🌉 <b>Cross-Chain Detected</b>`,
      `That looks like an <b>Ethereum</b> address.`,
      `SendFlow operates on <b>Solana</b> only.`,
      ``,
      `<b>Options:</b>`,
      `• Use <a href="https://wormhole.com">Wormhole</a> to bridge USDC between chains`,
      `• Ask the recipient for their <b>Solana</b> wallet address`,
    ].join("\n");
  }
  if (toChain === "bitcoin") {
    return [
      `🌉 <b>Cross-Chain Detected</b>`,
      `That looks like a <b>Bitcoin</b> address.`,
      `SendFlow sends USDC on <b>Solana</b> only.`,
      ``,
      `Ask for a Solana address or use a bridge service.`,
    ].join("\n");
  }
  return `SendFlow sends USDC on Solana. Please use a Solana wallet address.`;
}
