import { getP2pHealthSnapshot } from "./p2pMarket";

export function getP2PMarketSummaryHtml(): string {
  const s = getP2pHealthSnapshot();
  return [
    ``,
    `<b>P2P market right now</b>`,
    `Sell offers: <b>${s.openSellOffers}</b> · Buy ads: <b>${s.openBuyOffers}</b>`,
    `Active trades: <b>${s.activeTrades}</b>`,
    `Completed today: <b>${s.completedToday}</b> (<b>${s.volumeTodayUsdc.toFixed(1)} USDC</b>)`,
    `Disputes open: <b>${s.disputeCount}</b>`,
  ].join("\n");
}
