// DailyDose — Crypto Dashboard app.js
// APIs: CoinGecko (coins/prices/trending), DeFiLlama (TVL), Alternative.me (Fear & Greed),
//        Whale Alert (large transactions), CryptoPanic (news), TradingView (charts)
// All APIs are free / no-key tiers unless noted.

const CG = "https://api.coingecko.com/api/v3";
const LLAMA = "https://api.llama.fi";
const LLAMA_PROTOCOLS = "https://api.llama.fi/protocols";
const FEAR = "https://api.alternative.me/fng/";
const NEWS = "https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&kind=news&filter=hot";

// ─── Helpers ───
function fmtUsd(n, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
  return "$" + n.toFixed(decimals);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(0);
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function changeClass(n) {
  if (n == null || isNaN(n)) return "";
  return n >= 0 ? "up" : "down";
}

function sparklineSvg(data, color) {
  if (!data || data.length < 2) return "";
  const w = 80, h = 30, max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" fill="none"><polyline points="${pts}" stroke="${color}" stroke-width="1.5"/></svg>`;
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.json();
}

// ─── 1. Global Market Stats (CoinGecko) ───
async function loadGlobal() {
  try {
    const g = await fetchJson(CG + "/global");
    const d = g.data;
    document.getElementById("global-mcap").textContent = fmtUsd(d.total_market_cap.usd);
    const mcapChange = d.market_cap_change_percentage_24h_usd;
    const el = document.getElementById("global-mcap-change");
    el.textContent = fmtPct(mcapChange);
    el.className = "stat-change " + changeClass(mcapChange);
    document.getElementById("global-vol").textContent = fmtUsd(d.total_volume.usd);
    document.getElementById("btc-dom").textContent = d.market_cap_percentage.btc.toFixed(1) + "%";
  } catch (e) { console.error("global", e); }
}

// ─── 2. ETH Gas (Etherscan V2 — free, no key needed, rate-limited) ───
async function loadGas() {
  try {
    const r = await fetchJson("https://api.etherscan.io/v2/api?chainid=1&module=gastracker&action=gasoracle");
    if (r.status === "1" && r.result) {
      // FastGasPrice is in gwei already in V2
      const fast = parseFloat(r.result.FastGasPrice);
      const standard = parseFloat(r.result.ProposeGasPrice);
      document.getElementById("eth-gas").textContent = fast.toFixed(1);
    } else {
      throw new Error("Etherscan API error");
    }
  } catch {
    // Fallback: try ethplorer
    try {
      const r2 = await fetchJson("https://api.ethplorer.io/getGasPrice?apiKey=free");
      document.getElementById("eth-gas").textContent = (r2.gasPrice / 1e9).toFixed(1);
    } catch {
      document.getElementById("eth-gas").textContent = "—";
    }
  }
}

// ─── 3. Trending Coins (CoinGecko) ───
async function loadTrending() {
  try {
    const t = await fetchJson(CG + "/search/trending");
    const list = document.getElementById("trending-list");
    list.innerHTML = t.coins.slice(0, 7).map((c, i) => {
      const item = c.item;
      const pct = item.data?.price_change_percentage_24h?.usd;
      return `<li>
        <span class="rank">${i + 1}</span>
        <span class="name">${item.name}</span>
        <span class="symbol">${item.symbol}</span>
        <span class="price-change ${changeClass(pct)}">${fmtPct(pct)}</span>
      </li>`;
    }).join("");
  } catch (e) { console.error("trending", e); }
}

// ─── 4. Top Coins by Chain (CoinGecko markets + sparkline) ───
let allCoins = [];
async function loadCoins() {
  try {
    const data = await fetchJson(CG + "/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d");
    allCoins = data;
    renderCoins("all");
  } catch (e) { console.error("coins", e); }
}

function renderCoins(chain) {
  const tbody = document.getElementById("coins-tbody");
  let coins = allCoins;
  if (chain !== "all") {
    coins = allCoins.filter(c => c.asset_platform_id === chain);
    if (coins.length === 0) coins = allCoins;
  }
  coins = coins.slice(0, 25);
  tbody.innerHTML = coins.map((c, i) => {
    const pct24 = c.price_change_percentage_24h;
    const pct7d = c.price_change_percentage_7d_in_currency;
    const color = pct24 >= 0 ? "#16c784" : "#ea3943";
    const tvSym = coinToTvSymbol(c);
    return `<tr class="coin-row" data-tv="${tvSym}" data-name="${c.name}" style="cursor:pointer" title="Click to chart ${c.name} on TradingView">
      <td>${i + 1}</td>
      <td><div class="coin-cell">
        <img src="${c.image}" alt="" loading="lazy" onerror="this.style.display='none'">
        <span>${c.name}</span>
        <span class="muted">${c.symbol.toUpperCase()}</span>
      </div></td>
      <td>${fmtUsd(c.current_price)}</td>
      <td class="${changeClass(pct24)}">${fmtPct(pct24)}</td>
      <td>${fmtUsd(c.market_cap)}</td>
      <td>${fmtUsd(c.total_volume)}</td>
      <td>${sparklineSvg(c.sparkline_in_7d?.price, color)}</td>
    </tr>`;
  }).join("");

  // Click handler — swap TradingView chart to clicked coin
  tbody.querySelectorAll(".coin-row").forEach(row => {
    row.addEventListener("click", () => {
      const tv = row.getAttribute("data-tv");
      const name = row.getAttribute("data-name");
      tbody.querySelectorAll(".coin-row").forEach(r => r.classList.remove("selected-coin"));
      row.classList.add("selected-coin");
      loadTradingView(tv, name);
      document.getElementById("tradingview-chart").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

// ─── 5. DeFi TVL by Chain (DeFiLlama) ───
async function loadTvl() {
  try {
    const protocols = await fetchJson(LLAMA_PROTOCOLS);
    // Group by chain
    const chainTvl = {};
    for (const p of protocols) {
      if (!p.chains) continue;
      for (const ch of p.chains) {
        chainTvl[ch] = (chainTvl[ch] || 0) + (p.tvl || 0);
      }
    }
    // Top 15 chains by TVL
    const sorted = Object.entries(chainTvl)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    const maxTvl = sorted[0]?.[1] || 1;
    const list = document.getElementById("tvl-list");
    list.innerHTML = sorted.map(([name, tvl]) => {
      const pct = (tvl / maxTvl) * 100;
      // DeFiLlama chain URL: lowercase, spaces → hyphens
      const chainSlug = name.toLowerCase().replace(/\s+/g, "-");
      const llamaUrl = `https://defillama.com/chain/${chainSlug}`;
      return `<div class="tvl-row">
        <span class="tvl-name"><a href="${llamaUrl}" target="_blank" rel="noopener" title="View ${name} on DeFiLlama">${name} ↗</a></span>
        <div class="tvl-bar-wrap"><div class="tvl-bar" style="width:${pct}%"></div></div>
        <span class="tvl-tvl">${fmtUsd(tvl)}</span>
      </div>`;
    }).join("");
  } catch (e) { console.error("tvl", e); }
}

// ─── 6. Whale Alerts (Whale Alert API — free tier) ───
// Whale Alert free API requires a key. We'll use a fallback: Ethereum large tx via Etherscan-free
async function loadWhales() {
  const list = document.getElementById("whale-list");
  try {
    // Try Whale Alert public demo (no key, limited)
    // Fallback: use Whale Alert API v1 with free key placeholder
    // Since we don't have a whale alert API key, use an alternative:
    // Fetch large ETH transactions from a public endpoint
    const r = await fetchJson("https://api.whale-alert.io/v1/transactions?api_key=free&min_value=1000000&start=" + Math.floor(Date.now() / 1000 - 3600) + "&limit=10");
    list.innerHTML = r.transactions.slice(0, 8).map(tx => {
      const icon = tx.blockchain === "ethereum" ? "Ξ" : tx.blockchain === "bitcoin" ? "₿" : "🐋";
      return `<div class="whale-item">
        <span class="whale-icon">${icon}</span>
        <div class="whale-info">
          <div class="whale-amount">${fmtNum(tx.amount)} ${tx.symbol}</div>
          <div class="whale-usd">${fmtUsd(tx.amount_usd)} · ${tx.blockchain} → ${tx.to.owner || "unknown"}</div>
        </div>
        <span class="whale-time">${timeAgo(tx.timestamp)}</span>
      </div>`;
    }).join("");
  } catch {
    // Fallback: show placeholder
    list.innerHTML = `<div class="whale-item"><span class="whale-icon">🐋</span><div class="whale-info"><div class="whale-amount">Whale API needs key</div><div class="whale-usd">Get free key at whale-alert.io → add to app.js</div></div></div>`;
  }
}

// ─── 7. Crypto News (CryptoPanic free + CoinGecko status updates) ───
async function loadNews() {
  const list = document.getElementById("news-list");
  try {
    // CryptoPanic free API (auth_token=free works for basic access)
    const r = await fetchJson("https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&kind=news");
    list.innerHTML = r.results.slice(0, 10).map(item => {
      const d = new Date(item.published_at);
      const source = item.source?.title || "Unknown";
      return `<div class="news-item">
        <div class="news-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title}</a></div>
        <div class="news-meta">${source} · ${timeAgo(Math.floor(d.getTime() / 1000))}</div>
      </div>`;
    }).join("");
  } catch {
    // Fallback: RSS-to-JSON via Google Feed API for CoinDesk/CoinTelegraph
    try {
      const feeds = [
        "https://corsproxy.io/?https://www.coindesk.com/arc/outboundfeeds/rss/",
        "https://corsproxy.io/?https://cointelegraph.com/rss",
      ];
      const r = await fetchJson("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent("https://www.coindesk.com/arc/outboundfeeds/rss/"));
      list.innerHTML = r.items.slice(0, 10).map(item => {
        return `<div class="news-item">
          <div class="news-title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></div>
          <div class="news-meta">CoinDesk · ${timeAgo(Math.floor(new Date(item.pubDate).getTime() / 1000))}</div>
        </div>`;
      }).join("");
    } catch {
      list.innerHTML = `<div class="news-item"><div class="news-title">News feed temporarily unavailable</div></div>`;
    }
  }
}

// ─── 8. Fear & Greed Index (Alternative.me) — gasoline gauge style ───
async function loadFear() {
  try {
    const r = await fetchJson(FEAR + "?limit=1");
    const d = r.data[0];
    const val = parseInt(d.value); // 0-100

    // Update value text
    document.getElementById("fear-value").textContent = val;
    document.getElementById("fear-label").textContent = d.value_classification;

    // Update gauge fill + needle position (0-100 → 0-100%)
    const fill = document.getElementById("gauge-fill");
    const needle = document.getElementById("gauge-needle");
    if (fill) fill.style.width = val + "%";
    if (needle) needle.style.left = `calc(${val}% - 2px)`;

    // Color the value text based on zone
    const valEl = document.getElementById("fear-value");
    if (val < 25) valEl.style.color = "#ea3943";       // Extreme Fear — red
    else if (val < 45) valEl.style.color = "#f7b500";   // Fear — yellow
    else if (val < 55) valEl.style.color = "#8b91a5";   // Neutral — gray
    else if (val < 75) valEl.style.color = "#16c784";   // Greed — light green
    else valEl.style.color = "#16c784";                 // Extreme Greed — green
  } catch (e) { console.error("fear", e); }
}

// ─── 9. BTC & ETH Big Cards (CoinGecko) ───
async function loadBigCoins() {
  try {
    const data = await fetchJson(CG + "/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=true&price_change_percentage=24h,7d");
    const btc = data.find(c => c.id === "bitcoin");
    const eth = data.find(c => c.id === "ethereum");

    function bigCard(c) {
      if (!c) return "<p>Unable to load</p>";
      const pct = c.price_change_percentage_24h;
      const color = pct >= 0 ? "#16c784" : "#ea3943";
      return `<div class="big-coin-name">${c.name}</div>
        <div class="big-coin-price">${fmtUsd(c.current_price)}</div>
        <div class="${changeClass(pct)}" style="font-size:14px;font-weight:600">${fmtPct(pct)} (24h)</div>
        <div class="big-coin-stats">
          <div><div class="big-coin-stat-label">Market Cap</div><div class="big-coin-stat-value">${fmtUsd(c.market_cap)}</div></div>
          <div><div class="big-coin-stat-label">24h Volume</div><div class="big-coin-stat-value">${fmtUsd(c.total_volume)}</div></div>
          <div><div class="big-coin-stat-label">7d Change</div><div class="big-coin-stat-value ${changeClass(c.price_change_percentage_7d_in_currency)}">${fmtPct(c.price_change_percentage_7d_in_currency)}</div></div>
          <div><div class="big-coin-stat-label">ATH</div><div class="big-coin-stat-value">${fmtUsd(c.ath)}</div></div>
        </div>
        <div style="margin-top:10px">${sparklineSvg(c.sparkline_in_7d?.price, color)}</div>`;
    }
    document.getElementById("btc-info").innerHTML = bigCard(btc);
    document.getElementById("eth-info").innerHTML = bigCard(eth);
  } catch (e) { console.error("bigcoins", e); }
}

// ─── Coin → TradingView symbol mapping ───
// Maps CoinGecko coin IDs to TradingView ticker symbols
// Most stablecoins chart fine as XXX/USDT on Binance (e.g. BINANCE:USDCUSDT ~$1.00)
// Tether is the exception — USDT/USDT is meaningless, so chart it against USD on Kraken
const TV_SYMBOLS = {
  bitcoin: "BINANCE:BTCUSDT", ethereum: "BINANCE:ETHUSDT", solana: "BINANCE:SOLUSDT",
  binancecoin: "BINANCE:BNBUSDT", ripple: "BINANCE:XRPUSDT", dogecoin: "BINANCE:DOGEUSDT",
  cardano: "BINANCE:ADAUSDT", "avalanche-2": "BINANCE:AVAXUSDT", polkadot: "BINANCE:DOTUSDT",
  chainlink: "BINANCE:LINKUSDT", polygon: "BINANCE:POLUSDT", litecoin: "BINANCE:LTCUSDT",
  tron: "BINANCE:TRXUSDT", "shiba-inu": "BINANCE:SHIBUSDT", uniswap: "BINANCE:UNIUSDT",
  "bitcoin-cash": "BINANCE:BCHUSDT", near: "BINANCE:NEARUSDT", aptos: "BINANCE:APTUSDT",
  arbitrum: "BINANCE:ARBUSDT", optimism: "BINANCE:OPUSDT", filecoin: "BINANCE:FILUSDT",
  "render-token": "BINANCE:RNDRUSDT", "injective-protocol": "BINANCE:INJUSDT",
  "the-graph": "BINANCE:GRTUSDT", sui: "BINANCE:SUIUSDT", pepe: "BINANCE:PEPEUSDT",
  celestia: "BINANCE:TIAUSDT", starknet: "BINANCE:STRKUSDT", wormhole: "BINANCE:WUSDT",
  "ethereum-classic": "BINANCE:ETCUSDT", stellar: "BINANCE:XLMUSDT", cosmos: "BINANCE:ATOMUSDT",
  tezos: "BINANCE:XTZUSDT", aave: "BINANCE:AAVEUSDT", maker: "BINANCE:MKRUSDT",
  "sei-network": "BINANCE:SEIUSDT", dymension: "BINANCE:DYMUSDT",
  // Tether: USDT/USDT is meaningless — chart against USD on Kraken instead
  tether: "KRAKEN:USDTUSD",
};

function coinToTvSymbol(coin) {
  if (TV_SYMBOLS[coin.id]) return TV_SYMBOLS[coin.id];
  return "BINANCE:" + coin.symbol.toUpperCase() + "USDT";
}

// ─── 10. TradingView Chart Widget ───
let currentChartSymbol = "BINANCE:BTCUSDT";
let currentChartName = "Bitcoin";

function loadTradingView(symbol, name) {
  if (symbol) { currentChartSymbol = symbol; currentChartName = name || symbol; }

  // TradingView embedded widget — chart for selected coin
  const container = document.getElementById("tradingview-chart");
  if (container) {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: currentChartSymbol,
      interval: "240",
      timezone: "America/Chicago",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(10, 10, 15, 1)",
      gridColor: "rgba(35, 38, 52, 0.5)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: true,
      withdateranges: true,
      save_image: false,
      details: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.innerHTML = "";
    container.appendChild(script);
  }

  // Update chart title
  const titleEl = document.getElementById("chart-title");
  if (titleEl) titleEl.textContent = "📈 " + currentChartName + " — Live Chart";

  // Update external TradingView link
  const extLink = document.getElementById("tv-ext-link");
  if (extLink) extLink.href = "https://www.tradingview.com/chart/?symbol=" + currentChartSymbol;

  // TradingView Ticker Tape (load once on init, not on every coin click)
  if (symbol === undefined) {
    const ticker = document.getElementById("tradingview-ticker");
    if (ticker) {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
      script.async = true;
      script.innerHTML = JSON.stringify({
        symbols: [
          { proName: "BINANCE:BTCUSDT", title: "Bitcoin" },
          { proName: "BINANCE:ETHUSDT", title: "Ethereum" },
          { proName: "BINANCE:SOLUSDT", title: "Solana" },
          { proName: "BINANCE:BNBUSDT", title: "BNB" },
          { proName: "BINANCE:XRPUSDT", title: "XRP" },
          { proName: "BINANCE:DOGEUSDT", title: "Dogecoin" },
          { proName: "BINANCE:ADAUSDT", title: "Cardano" },
          { proName: "BINANCE:AVAXUSDT", title: "Avalanche" },
        ],
        showSymbolLogo: true,
        isTransparent: true,
        displayMode: "adaptive",
        colorTheme: "dark",
        locale: "en",
      });
      ticker.innerHTML = "";
      ticker.appendChild(script);
    }
  }
}

// ─── Refresh logic ───
let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;
  btn.textContent = "↻ Loading…";
  document.getElementById("last-updated").textContent = "Updating…";

  try {
    await Promise.allSettled([
      loadGlobal(),
      loadGas(),
      loadTrending(),
      loadCoins(),
      loadTvl(),
      loadWhales(),
      loadNews(),
      loadFear(),
      loadBigCoins(),
    ]);
    loadTradingView();
    document.getElementById("last-updated").textContent = "Updated " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    document.getElementById("last-updated").textContent = "Update failed — try again";
  }

  btn.disabled = false;
  btn.textContent = "↻ Refresh";
  refreshing = false;
}

// ─── Chain selector ───
document.getElementById("chain-select")?.addEventListener("change", (e) => {
  renderCoins(e.target.value);
});

// ─── Refresh button ───
document.getElementById("refresh-btn").addEventListener("click", refreshAll);

// ─── Auto-refresh every 5 minutes ───
setInterval(refreshAll, 5 * 60 * 1000);

// ─── Init ───
refreshAll();