import { renderPrometheusMetrics } from "../utils/metricsState";

const SOL_FALLBACK_USD = 150;

export interface LandingMetrics {
  transfersSuccess: number;
  transfersFailed: number;
  transfersBlocked: number;
  threatsTotal: number;
  offrampDenied: number;
  offrampAllowed: number;
  rpcErrors: number;
  rpcOk: number;
  activeUsers24h: number;
  volumeUsdc24h: number;
  platformSavingsUsd: number;
  estimateFeeLamports: number;
}

/**
 * Parse Prometheus text exposition for dashboard + tests.
 */
export function parsePrometheusMetricsForLanding(text: string): LandingMetrics {
  const m: LandingMetrics = {
    transfersSuccess: 0,
    transfersFailed: 0,
    transfersBlocked: 0,
    threatsTotal: 0,
    offrampDenied: 0,
    offrampAllowed: 0,
    rpcErrors: 0,
    rpcOk: 0,
    activeUsers24h: 0,
    volumeUsdc24h: 0,
    platformSavingsUsd: 0,
    estimateFeeLamports: 5000,
  };
  const lines = text.split(/\r?\n/);
  const reTransfer = /^sendflow_transfers_total\{result="(success|failed|blocked)"\}\s+(\d+(?:\.\d+)?)\s*$/;
  const reThreat = /^sendflow_threats_detected_total\{category="((?:\\"|[^"])*)"\}\s+(\d+(?:\.\d+)?)\s*$/;
  const reOfframp = /^sendflow_offramp_attempts_total\{tier="(\d+)",result="(allowed|denied)"\}\s+(\d+(?:\.\d+)?)\s*$/;
  const reRpc = /^sendflow_rpc_calls_total\{rpc="([^"]+)",result="(ok|error)"\}\s+(\d+(?:\.\d+)?)\s*$/;
  const reGauge = /^(sendflow_active_users_24h|sendflow_volume_usdc_24h|sendflow_platform_savings_usd_total|sendflow_estimate_tx_fee_lamports)\s+(\d+(?:\.\d+)?)\s*$/;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    let mm = t.match(reTransfer);
    if (mm) {
      const v = Math.floor(Number(mm[2]));
      if (mm[1] === "success") m.transfersSuccess = v;
      else if (mm[1] === "failed") m.transfersFailed = v;
      else m.transfersBlocked = v;
      continue;
    }
    mm = t.match(reThreat);
    if (mm) {
      m.threatsTotal += Math.floor(Number(mm[2]));
      continue;
    }
    mm = t.match(reOfframp);
    if (mm) {
      const v = Math.floor(Number(mm[3]));
      if (mm[2] === "denied") m.offrampDenied += v;
      else m.offrampAllowed += v;
      continue;
    }
    mm = t.match(reRpc);
    if (mm) {
      const v = Math.floor(Number(mm[3]));
      if (mm[2] === "error") m.rpcErrors += v;
      else m.rpcOk += v;
      continue;
    }
    mm = t.match(reGauge);
    if (mm) {
      const v = Number(mm[2]);
      if (mm[1] === "sendflow_active_users_24h") m.activeUsers24h = Math.floor(v);
      else if (mm[1] === "sendflow_volume_usdc_24h") m.volumeUsdc24h = v;
      else if (mm[1] === "sendflow_platform_savings_usd_total") m.platformSavingsUsd = v;
      else if (mm[1] === "sendflow_estimate_tx_fee_lamports") m.estimateFeeLamports = Math.floor(v) || 5000;
    }
  }
  return m;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function feeUsdFromLamports(lamports: number, solUsd: number): number {
  return Math.round((lamports * solUsd * 1e6) / 1e9) / 1e6;
}

/** Inline SVG: green circle + white tick */
function checkSvg(): string {
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0"><circle cx="12" cy="12" r="12" fill="#1D9E75"/><path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M7 12l3 3 7-7"/></svg>`;
}

/**
 * Full HTML landing (inline CSS/JS). Server injects OG meta from live /metrics snapshot.
 */
export function landingPage(): string {
  const botRaw = process.env.TELEGRAM_BOT_USERNAME?.trim() || "SendFlowSol_bot";
  const bot = botRaw.replace(/^@/, "");
  const tgUrl = `https://t.me/${escHtml(bot)}`;
  const hackathon = escHtml(process.env.HACKATHON_NAME?.trim() || "Solana hackathon");
  const github = process.env.GITHUB_URL?.trim();
  const escrow = process.env.SENDFLOW_ESCROW_ADDRESS?.trim() || process.env.ESCROW_WALLET_PUBLIC_KEY?.trim() || "";
  const escrowShort = escrow.length > 12 ? `${escrow.slice(0, 6)}…${escrow.slice(-4)}` : escrow || "—";
  const solscanEscrow = escrow
    ? `https://solscan.io/account/${encodeURIComponent(escrow)}`
    : "https://solscan.io";

  const metricsText = renderPrometheusMetrics();
  const pm = parsePrometheusMetricsForLanding(metricsText);
  const totalTransfers = pm.transfersSuccess + pm.transfersFailed + pm.transfersBlocked;
  const volStr = pm.volumeUsdc24h.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const ogDesc = `${totalTransfers} transfers · ${volStr} USDC moved`;

  const lam = pm.estimateFeeLamports;
  const fee200 = feeUsdFromLamports(lam, SOL_FALLBACK_USD);
  const fee500 = feeUsdFromLamports(lam * 2, SOL_FALLBACK_USD);
  const fee100 = feeUsdFromLamports(lam, SOL_FALLBACK_USD);
  const sf200 = `$${fee200.toFixed(3)}`;
  const sf500 = `$${fee500.toFixed(3)}`;
  const sf100 = `$${fee100.toFixed(3)}`;
  const checkSvgJson = JSON.stringify(checkSvg());

  const ghBlock = github
    ? `<p class="stack-line"><a href="${escHtml(github)}" rel="noopener noreferrer">GitHub</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>SendFlow — Send money anywhere. Just type.</title>
  <meta property="og:title" content="SendFlow — Send money anywhere. Just type."/>
  <meta property="og:description" content="${escHtml(ogDesc)}"/>
  <meta property="og:image" content="/og-image.png"/>
  <meta property="og:type" content="website"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#1a1a1a;line-height:1.5}
    .wrap{max-width:860px;margin:0 auto;padding:0 24px}
    .hero{min-height:100dvh;display:flex;flex-direction:column;justify-content:center;padding:48px 0 32px}
    @media (min-width:701px){.hero{height:100dvh;min-height:100dvh;box-sizing:border-box}}
    @media (max-width:700px){.hero{min-height:auto;padding:32px 0 24px}}
    h1{font-size:clamp(1.85rem,5vw,2.75rem);font-weight:800;color:#512DA8;margin:0 0 12px;letter-spacing:-0.02em}
    .sub{font-size:1.125rem;color:#444;margin:0 0 28px;max-width:36em}
    .cta{display:inline-block;background:#512DA8;color:#fff!important;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:1.05rem}
    .cta:hover{filter:brightness(1.06)}
    .stats{margin-top:28px;font-size:0.95rem;color:#333;font-variant-numeric:tabular-nums}
    .stats strong{color:#1D9E75;transition:opacity .35s ease}
    section{padding:48px 0;border-top:1px solid #eee}
    h2{font-size:1.35rem;color:#512DA8;margin:0 0 20px}
    .steps{display:grid;gap:20px}
    @media (min-width:700px){.steps{grid-template-columns:repeat(3,1fr)}}
    .card{border:1px solid #e8e8e8;border-radius:12px;padding:20px;background:#fff}
    .card h3{margin:0 0 8px;font-size:1.05rem;color:#512DA8}
    .card p{margin:0;font-size:0.95rem;color:#555}
    .sec-grid{display:flex;flex-direction:column;gap:0}
    .sec-row{display:flex;align-items:center;gap:12px;padding:14px 16px;font-size:0.95rem}
    .sec-row:nth-child(odd){background:#F9F9F9}
    .sec-row:nth-child(even){background:#fff}
    table{width:100%;border-collapse:collapse;font-size:0.95rem;margin-top:12px}
    th,td{padding:12px 10px;text-align:left;border-bottom:1px solid #eee}
    th{color:#512DA8;font-weight:700}
    td.num{font-variant-numeric:tabular-nums}
    .fee-note{font-size:0.85rem;color:#666;margin-top:16px}
    .stack{font-size:0.95rem;color:#444}
    .stack-line{margin:8px 0}
    .stack a{color:#1D9E75}
    footer{padding:40px 0 48px;font-size:0.9rem;color:#666;border-top:1px solid #eee}
    footer a{color:#512DA8}
    code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:0.88em}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1>Send money anywhere. Just type.</h1>
      <p class="sub">No bank. No fees. No seed phrases. Works in Telegram.</p>
      <a class="cta" href="${tgUrl}" target="_blank" rel="noopener noreferrer">Try it now →</a>
      <p class="stats" id="liveStats" data-initial-t="${totalTransfers}" data-initial-v="${pm.volumeUsdc24h}" data-initial-u="${pm.activeUsers24h}">
        <strong id="stT">0</strong> transfers · <strong id="stV">0</strong> USDC moved today · <strong id="stU">0</strong> users
      </p>
    </header>

    <section>
      <h2>How it works</h2>
      <div class="steps">
        <div class="card"><h3>1. Open Telegram</h3><p>No app to download. No account to create.</p></div>
        <div class="card"><h3>2. Type what you want</h3><p>Send $50 to Mom. Create invoice for client. Just type.</p></div>
        <div class="card"><h3>3. Done in seconds</h3><p>USDC settles on Solana. Costs fractions of a cent.</p></div>
      </div>
    </section>

    <section>
      <h2>Security status — live</h2>
      <div class="sec-grid" id="secGrid">
        ${securityRowsHtml(pm)}
      </div>
    </section>

    <section>
      <h2>Fee comparison</h2>
      <table>
        <thead><tr><th></th><th>SendFlow</th><th>Western Union</th></tr></thead>
        <tbody>
          <tr><td>$200 to Mexico</td><td class="num" id="fee200">${sf200}</td><td class="num">$13.00</td></tr>
          <tr><td>$500 to India</td><td class="num" id="fee500">${sf500}</td><td class="num">$32.50</td></tr>
          <tr><td>$100 to Nigeria</td><td class="num" id="fee100">${sf100}</td><td class="num">$8.00</td></tr>
        </tbody>
      </table>
      <p class="fee-note">Fees calculated at current Solana rates. WU fees from westernunion.com.</p>
    </section>

    <section>
      <h2>Technical stack</h2>
      <div class="stack">
        <p class="stack-line">Built on: ElizaOS v2 · Solana · USDC · Jupiter v6 · Pyth Oracle · Nosana GPU</p>
        ${ghBlock}
        <p class="stack-line">Run locally: <code>git clone … && bun install && bun run start</code></p>
      </div>
    </section>

    <footer>
      <p>SendFlow · Built for ${hackathon}</p>
      <p>Escrow: <a href="${escHtml(solscanEscrow)}" rel="noopener noreferrer">${escHtml(escrowShort)}</a> (Solscan)</p>
    </footer>
  </div>
  <script>
(function(){
  var SOL_USD = ${SOL_FALLBACK_USD};
  var SVG = ${checkSvgJson};
  function parseMetrics(txt){
    var o={success:0,failed:0,blocked:0,threats:0,offDen:0,rpcErr:0,rpcOk:0,au:0,vol:0,feeLam:5000};
    txt.split(/\\n/).forEach(function(line){
      line=line.trim();
      if(!line||line[0]==="#")return;
      var m=line.match(/^sendflow_transfers_total\\{result="(success|failed|blocked)"\\}\\s+(\\d+)/);
      if(m){o[m[1]==="success"?"success":m[1]==="failed"?"failed":"blocked"]=+m[2];return}
      m=line.match(/^sendflow_threats_detected_total\\{category="([^"]*)"\\}\\s+(\\d+)/);
      if(m){o.threats+=+m[2];return}
      m=line.match(/^sendflow_offramp_attempts_total\\{tier="\\d+",result="(allowed|denied)"\\}\\s+(\\d+)/);
      if(m){if(m[1]==="denied")o.offDen+=+m[2];return}
      m=line.match(/^sendflow_rpc_calls_total\\{rpc="[^"]+",result="(ok|error)"\\}\\s+(\\d+)/);
      if(m){if(m[1]==="error")o.rpcErr+=+m[2];else o.rpcOk+=+m[2];return}
      m=line.match(/^sendflow_active_users_24h\\s+(\\d+)/);
      if(m){o.au=+m[1];return}
      m=line.match(/^sendflow_volume_usdc_24h\\s+([\\d.]+)/);
      if(m){o.vol=+m[1];return}
      m=line.match(/^sendflow_estimate_tx_fee_lamports\\s+(\\d+)/);
      if(m){o.feeLam=+m[1]||5000}
    });
    return o;
  }
  function feeUsd(lam){return Math.round(lam*SOL_USD*1e6/1e9)/1e6}
  function row(label,sub){return'<div class="sec-row">'+SVG+'<div><strong>'+label+'</strong> — '+sub+'</div></div>'}
  function buildSecHtml(p){
    var t1=p.blocked===0?"no transfers blocked today":p.blocked+" transfer(s) blocked today";
    var t2=p.threats===0?"no threats today":p.threats+" threats blocked today";
    var t3=p.offDen===0?"no denials today":p.offDen+" off-ramp check(s) denied";
    var t4=p.rpcErr===0?"no RPC errors logged":p.rpcErr+" RPC error(s) logged";
    var t5=p.failed===0?"no failed transfers":p.failed+" failed transfer(s) caught";
    var t6=p.success===0?"no settlements yet":p.success+" successful settlement(s)";
    var t7=p.au===0?"no active users in 24h window":p.au+" active user(s) (24h)";
    return row("Transfer firewall",t1)+row("AI threat classifier",t2)+row("Off-ramp policy",t3)+row("RPC monitoring",t4)+row("Validation layer",t5)+row("Settlement pipeline",t6)+row("Live activity",t7);
  }
  function animInt(el,from,to,ms){
    var start=performance.now();
    function tick(now){
      var x=Math.min(1,(now-start)/ms);
      var v=Math.round(from+(to-from)*(1-Math.pow(1-x,2)));
      el.textContent=v.toLocaleString("en-US");
      if(x<1)requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function animVol(el,from,to,ms){
    var start=performance.now(), tgt=Math.round(to);
    function tick(now){
      var x=Math.min(1,(now-start)/ms);
      var v=Math.round(from+(tgt-from)*(1-Math.pow(1-x,2)));
      el.textContent=v.toLocaleString("en-US");
      if(x<1)requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  var st=document.getElementById("liveStats");
  if(st){
    var it=+st.getAttribute("data-initial-t")||0,iv=+st.getAttribute("data-initial-v")||0,iu=+st.getAttribute("data-initial-u")||0;
    var eT=document.getElementById("stT"),eV=document.getElementById("stV"),eU=document.getElementById("stU");
    if(eT)animInt(eT,0,it,800);
    if(eV)animVol(eV,0,iv,800);
    if(eU)animInt(eU,0,iu,800);
  }
  function refresh(){
    fetch("/metrics",{cache:"no-store"}).then(function(r){return r.text()}).then(function(txt){
      var p=parseMetrics(txt);
      var tot=p.success+p.failed+p.blocked;
      var eT=document.getElementById("stT"),eV=document.getElementById("stV"),eU=document.getElementById("stU");
      if(eT){eT.style.opacity="0.85";eT.textContent=tot.toLocaleString("en-US");requestAnimationFrame(function(){eT.style.opacity="1"})}
      if(eV){eV.style.opacity="0.85";eV.textContent=Math.round(p.vol).toLocaleString("en-US");requestAnimationFrame(function(){eV.style.opacity="1"})}
      if(eU){eU.style.opacity="0.85";eU.textContent=p.au.toLocaleString("en-US");requestAnimationFrame(function(){eU.style.opacity="1"})}
      var g=document.getElementById("secGrid");
      if(g)g.innerHTML=buildSecHtml(p);
      var lam=p.feeLam||5000;
      var a=document.getElementById("fee200"),b=document.getElementById("fee500"),c=document.getElementById("fee100");
      if(a)a.textContent="$"+feeUsd(lam).toFixed(3);
      if(b)b.textContent="$"+feeUsd(lam*2).toFixed(3);
      if(c)c.textContent="$"+feeUsd(lam).toFixed(3);
    }).catch(function(){});
  }
  setInterval(refresh,10000);
})();</script>
</body>
</html>`;
}

function securityRowsHtml(pm: LandingMetrics): string {
  const rows: Array<{ label: string; sub: string }> = [
    {
      label: "Transfer firewall",
      sub: pm.transfersBlocked === 0 ? "no transfers blocked today" : `${pm.transfersBlocked} transfer(s) blocked today`,
    },
    {
      label: "AI threat classifier",
      sub: pm.threatsTotal === 0 ? "no threats today" : `${pm.threatsTotal} threats blocked today`,
    },
    {
      label: "Off-ramp policy",
      sub: pm.offrampDenied === 0 ? "no denials today" : `${pm.offrampDenied} off-ramp check(s) denied`,
    },
    {
      label: "RPC monitoring",
      sub: pm.rpcErrors === 0 ? "no RPC errors logged" : `${pm.rpcErrors} RPC error(s) logged`,
    },
    {
      label: "Validation layer",
      sub: pm.transfersFailed === 0 ? "no failed transfers" : `${pm.transfersFailed} failed transfer(s) caught`,
    },
    {
      label: "Settlement pipeline",
      sub: pm.transfersSuccess === 0 ? "no settlements yet" : `${pm.transfersSuccess} successful settlement(s)`,
    },
    {
      label: "Live activity",
      sub: pm.activeUsers24h === 0 ? "no active users in 24h window" : `${pm.activeUsers24h} active user(s) (24h)`,
    },
  ];
  return rows
    .map(
      (r) =>
        `<div class="sec-row">${checkSvg()}<div><strong>${escHtml(r.label)}</strong> — ${escHtml(r.sub)}</div></div>`
    )
    .join("");
}
