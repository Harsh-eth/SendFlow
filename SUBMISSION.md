# SendFlow — Cash to Cash. Zero Fees. 2 Seconds.

Ahmed works in Dubai and sends money home to Pakistan every month.
Western Union charges him 5% and takes 3 days.
On a $200 transfer he loses $10 every single month.
Over a year that is $120 — nearly a week's wages.

SendFlow solves this completely.

Ahmed opens Telegram and types "Sell 200 USDC for AED".
A local buyer in Dubai pays him AED cash via bank transfer.
USDC is held in escrow on Solana until Ahmed confirms payment.
Ahmed types "Send 200 USDC to Mom in Pakistan".
Mom receives USDC in her SendFlow wallet in 400 milliseconds.
Mom types "Sell 200 USDC for PKR".
A local buyer pays her EasyPaisa.
She confirms and USDC is released.

Total cost: less than $0.01.
Total time: under 5 minutes.
Western Union: $10 fee, 3 days.

This works because SendFlow is a P2P marketplace where people
trade USDC directly with each other using local payment methods —
UPI, GCash, M-Pesa, bank transfer, EasyPaisa.
There is no intermediary. There is no platform fee.
Solana escrow ensures neither party can cheat.

The agent is built on ElizaOS v2 with 5 custom Solana plugins,
running Qwen 3.5 9B inference on Nosana decentralized GPU.
Users interact entirely through natural language in Telegram.
New users get a custodial wallet created instantly.
No seed phrases. No app downloads. No bank account needed.

SendFlow is not a demo. It runs on Solana mainnet.
Real USDC. Real transfers. Real people.

Docker, tests, and `GET /health` (including live P2P counters) make
the stack easy to verify. README and `.env.example` document local
runs. Submitted April 2026 for the Nosana × ElizaOS builders challenge.
