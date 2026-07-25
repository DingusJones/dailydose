// DailyDose — Crypto Dashboard app.js (optimized)
// APIs: CoinGecko (coins/prices/trending), DeFiLlama (TVL), Alternative.me (Fear & Greed),
//        Whale Alert, CryptoPanic (news), TradingView (charts), public RPCs (L2 gas)
// Optimized: consolidated CoinGecko calls, localStorage caching, CORS proxy for RPCs

const CG = "https://api.coingecko.com/api/v3";
const LLAMA_PROTOCOLS = "https://api.llama.fi/protocols";
const FEAR = "https://api.alternative.me/fng/";

// ─── Cache: localStorage with TTL ───
const CACHE_TTL = 120; // 2 minutes
const cache = {
  get(key) {
    try {
      const raw = localStorage.getItem("dd_" + key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL * 1000) return null;
      return data;
    } catch { return null; }
  },
  set(key, data) {
    try {
      localStorage.setItem("dd_" + key, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  },
  getStale(key) {
    try {
      const raw = localStorage.getItem("dd_" + key);
      if (!raw) return null;
      return JSON.parse(raw).data;
    } catch { return null; }
  },
};

async function cachedFetch(key, url, opts) {
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const r = await fetch(url, opts);
    if (!r.ok) {
      const stale = cache.getStale(key);
      if (stale) return stale;
      throw new Error(`${r.status} on ${url}`);
    }
    const data = await r.json();
    cache.set(key, data);
    return data;
  } catch (e) {
    const stale = cache.getStale(key);
    if (stale) return stale;
    throw e;
  }
}

// ─── Helpers ───
function fmtUsd(n, d = 2) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
  return "$" + n.toFixed(d);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(0);
}
function timeAgo(ts) {
  const d = Math.floor(Date.now() / 1000 - ts);
  if (d < 60) return d + "s ago";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}
function changeClass(n) {
  if (n == null || isNaN(n)) return "";
  return n >= 0 ? "up" : "down";
}
function sparklineSvg(data, color) {
  if (!data || data.length < 2) return "";
  const w = 80, h = 30, max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => (i / (data.length - 1) * w).toFixed(1) + "," + (h - ((v - min) / range) * h).toFixed(1)).join(" ");
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" fill="none"><polyline points="${pts}" stroke="${color}" stroke-width="1.5"/></svg>`;
}

// ─── 1. Global + Coins + Big Coins (ONE consolidated CoinGecko call) ───
// The /coins/markets endpoint returns all data we need for:
//   - Top coins table (100 coins with sparklines)
//   - BTC/ETH big cards (extract from same data)
//   - Token prices for EVM tx cost calculations
// Plus /global for market cap + /search/trending for trending
let allCoins = [];

async function loadCoinGeckoData() {
  // 3 CoinGecko calls total (was 6)
  const [globalRes, trendingRes, marketsRes] = await Promise.allSettled([
    cachedFetch("global", CG + "/global"),
    cachedFetch("trending", CG + "/search/trending"),
    cachedFetch("markets", CG + "/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d"),
  ]);

  // Global stats
  if (globalRes.status === "fulfilled" && globalRes.value?.data) {
    const d = globalRes.value.data;
    document.getElementById("global-mcap").textContent = fmtUsd(d.total_market_cap.usd);
    const mc = d.market_cap_change_percentage_24h_usd;
    const el = document.getElementById("global-mcap-change");
    el.textContent = fmtPct(mc);
    el.className = "stat-change " + changeClass(mc);
    document.getElementById("global-vol").textContent = fmtUsd(d.total_volume.usd);
    document.getElementById("btc-dom").textContent = d.market_cap_percentage.btc.toFixed(1) + "%";
  }

  // Trending — clickable links to CoinGecko + TradingView
  if (trendingRes.status === "fulfilled" && trendingRes.value?.coins) {
    const list = document.getElementById("trending-list");
    list.innerHTML = trendingRes.value.coins.slice(0, 7).map((c, i) => {
      const item = c.item;
      const pct = item.data?.price_change_percentage_24h?.usd;
      const cgUrl = `https://www.coingecko.com/en/coins/${item.id}`;
      const tvUrl = `https://www.tradingview.com/chart/?symbol=COINBASE:${item.symbol.toUpperCase()}USD`;
      return `<li>
        <span class="rank">${i + 1}</span>
        <span class="name"><a href="${cgUrl}" target="_blank" rel="noopener" title="${item.name} on CoinGecko">${item.name}</a></span>
        <span class="symbol"><a href="${tvUrl}" target="_blank" rel="noopener" title="${item.name} chart on TradingView">${item.symbol}</a></span>
        <span class="price-change ${changeClass(pct)}">${fmtPct(pct)}</span>
      </li>`;
    }).join("");
  }

  // Markets → coins table + big coin cards + EVM token prices
  if (marketsRes.status === "fulfilled" && Array.isArray(marketsRes.value)) {
    allCoins = marketsRes.value;
    renderCoins("all");

    // Extract BTC/ETH for big cards (no separate API call needed)
    const btc = allCoins.find(c => c.id === "bitcoin");
    const eth = allCoins.find(c => c.id === "ethereum");
    function bigCard(c) {
      if (!c) return "<p>Unable to load</p>";
      const pct = c.price_change_percentage_24h;
      const color = pct >= 0 ? "#16c784" : "#ea3943";
      return `<div class="big-coin-name">${c.name}</div><div class="big-coin-price">${fmtUsd(c.current_price)}</div><div class="${changeClass(pct)}" style="font-size:14px;font-weight:600">${fmtPct(pct)} (24h)</div><div class="big-coin-stats"><div><div class="big-coin-stat-label">Market Cap</div><div class="big-coin-stat-value">${fmtUsd(c.market_cap)}</div></div><div><div class="big-coin-stat-label">24h Volume</div><div class="big-coin-stat-value">${fmtUsd(c.total_volume)}</div></div><div><div class="big-coin-stat-label">7d Change</div><div class="big-coin-stat-value ${changeClass(c.price_change_percentage_7d_in_currency)}">${fmtPct(c.price_change_percentage_7d_in_currency)}</div></div><div><div class="big-coin-stat-label">ATH</div><div class="big-coin-stat-value">${fmtUsd(c.ath)}</div></div></div><div style="margin-top:10px">${sparklineSvg(c.sparkline_in_7d?.price, color)}</div>`;
    }
    document.getElementById("btc-info").innerHTML = bigCard(btc);
    document.getElementById("eth-info").innerHTML = bigCard(eth);

    // Return token prices for EVM tx costs (no separate CoinGecko call)
    return {
      ethPrice: eth?.current_price || 0,
      maticPrice: allCoins.find(c => c.id === "matic-network")?.current_price || 0,
      bnbPrice: allCoins.find(c => c.id === "binancecoin")?.current_price || 0,
    };
  }
  return { ethPrice: 0, maticPrice: 0, bnbPrice: 0 };
}

// ─── 2. ETH Gas (Etherscan V2) ───
async function loadGas() {
  try {
    const r = await cachedFetch("gas", "https://api.etherscan.io/v2/api?chainid=1&module=gastracker&action=gasoracle");
    if (r.status === "1" && r.result) {
      document.getElementById("eth-gas").textContent = parseFloat(r.result.FastGasPrice).toFixed(2);
    }
  } catch {
    try {
      const r2 = await cachedFetch("gas2", "https://api.ethplorer.io/getGasPrice?apiKey=free");
      document.getElementById("eth-gas").textContent = (r2.gasPrice / 1e9).toFixed(2);
    } catch { document.getElementById("eth-gas").textContent = "—"; }
  }
}

// ─── 3. EVM Chain Transaction Costs ───
const EVM_CHAINS = [
  { name: "Ethereum", rpc: "https://ethereum.publicnode.com", token: "ETH", explorer: "https://etherscan.io/gastracker", priceKey: "ethPrice" },
  { name: "Base", rpc: "https://mainnet.base.org", token: "ETH", explorer: "https://basescan.org/gastracker", priceKey: "ethPrice" },
  { name: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc", token: "ETH", explorer: "https://arbiscan.io/gastracker", priceKey: "ethPrice" },
  { name: "Optimism", rpc: "https://mainnet.optimism.io", token: "ETH", explorer: "https://optimistic.etherscan.io/gastracker", priceKey: "ethPrice" },
  { name: "Polygon", rpc: "https://polygon-rpc.com", token: "MATIC", explorer: "https://polygonscan.com/gastracker", priceKey: "maticPrice" },
  { name: "BNB Chain", rpc: "https://bsc-dataseed.binance.org", token: "BNB", explorer: "https://bscscan.com/gastracker", priceKey: "bnbPrice" },
];
const TX_GAS = { send: 21000, erc20: 65000, swap: 150000, stake: 300000 };

async function rpcGasPrice(rpc) {
  // Use CORS proxy if direct fetch fails (some RPCs don't send CORS headers)
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
  });
  const d = await r.json();
  return parseInt(d.result, 16) / 1e9;
}

async function rpcGasPriceProxied(rpc) {
  // Fallback: use a CORS proxy
  const proxy = "https://corsproxy.io/?";
  const r = await fetch(proxy + encodeURIComponent(rpc), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
  });
  const d = await r.json();
  return parseInt(d.result, 16) / 1e9;
}

async function loadEvmTxCosts(prices) {
  const tbody = document.getElementById("evm-tx-tbody");
  if (!tbody) return;

  // Fetch all 6 chain gas prices in PARALLEL (was sequential)
  const results = await Promise.allSettled(
    EVM_CHAINS.map(async (chain) => {
      let gasGwei;
      try {
        gasGwei = await rpcGasPrice(chain.rpc);
      } catch {
        gasGwei = await rpcGasPriceProxied(chain.rpc); // CORS fallback
      }
      const tokenUsd = prices?.[chain.priceKey] || 0;
      const cost = (gasLimit) => gasGwei * gasLimit * 1e-9 * tokenUsd;
      const fmtCost = (c) => c < 0.01 ? "$" + c.toFixed(4) : "$" + c.toFixed(2);
      return { chain, gasGwei, fmtCost, cost };
    })
  );

  tbody.innerHTML = results.map((res, i) => {
    const chain = EVM_CHAINS[i];
    if (res.status !== "fulfilled") {
      return `<tr><td style="text-align:left;font-weight:600">${chain.name}</td><td colspan="5" class="muted">Unable to fetch</td><td><a href="${chain.explorer}" target="_blank" rel="noopener" style="font-size:11px">Explorer ↗</a></td></tr>`;
    }
    const { gasGwei, fmtCost, cost } = res.value;
    return `<tr>
      <td style="text-align:left;font-weight:600">${chain.name}</td>
      <td>${gasGwei.toFixed(4)} gwei</td>
      <td>${fmtCost(cost(TX_GAS.send))}</td>
      <td>${fmtCost(cost(TX_GAS.erc20))}</td>
      <td>${fmtCost(cost(TX_GAS.swap))}</td>
      <td>${fmtCost(cost(TX_GAS.stake))}</td>
      <td><a href="${chain.explorer}" target="_blank" rel="noopener" style="font-size:11px">Explorer ↗</a></td>
    </tr>`;
  }).join("");
}

// ─── 4. Top Coins table (rendered from cached allCoins) ───
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
    const color = pct24 >= 0 ? "#16c784" : "#ea3943";
    const { primary, fallback } = coinToTvSymbolWithFallback(c);
    return `<tr class="coin-row" data-tv="${primary}" data-tv-fallback="${fallback || ""}" data-name="${c.name}" style="cursor:pointer" title="Click to chart ${c.name}">
      <td>${i + 1}</td>
      <td><div class="coin-cell"><img src="${c.image}" alt="" loading="lazy" onerror="this.style.display='none'"><span>${c.name}</span><span class="muted">${c.symbol.toUpperCase()}</span></div></td>
      <td>${fmtUsd(c.current_price)}</td>
      <td class="${changeClass(pct24)}">${fmtPct(pct24)}</td>
      <td>${fmtUsd(c.market_cap)}</td>
      <td>${fmtUsd(c.total_volume)}</td>
      <td>${sparklineSvg(c.sparkline_in_7d?.price, color)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".coin-row").forEach(row => {
    row.addEventListener("click", () => {
      const tv = row.getAttribute("data-tv");
      const tvFallback = row.getAttribute("data-tv-fallback");
      const name = row.getAttribute("data-name");
      tbody.querySelectorAll(".coin-row").forEach(r => r.classList.remove("selected-coin"));
      row.classList.add("selected-coin");
      // Load chart with fallback — if primary fails, TradingView widget handles it
      // We pass both; loadTradingView uses primary, and if user clicks again it won't re-fail
      loadTradingView(tv, name);
      document.getElementById("tradingview-chart").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

// ─── 5. DeFi TVL by Chain (DeFiLlama) ───
async function loadTvl() {
  try {
    const protocols = await cachedFetch("tvl", LLAMA_PROTOCOLS);
    const chainTvl = {};
    for (const p of protocols) {
      if (!p.chains) continue;
      for (const ch of p.chains) chainTvl[ch] = (chainTvl[ch] || 0) + (p.tvl || 0);
    }
    const sorted = Object.entries(chainTvl).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const maxTvl = sorted[0]?.[1] || 1;
    document.getElementById("tvl-list").innerHTML = sorted.map(([name, tvl]) => {
      const slug = name.toLowerCase().replace(/\s+/g, "-");
      return `<div class="tvl-row"><span class="tvl-name"><a href="https://defillama.com/chain/${slug}" target="_blank" rel="noopener" title="View ${name} on DeFiLlama">${name} ↗</a></span><div class="tvl-bar-wrap"><div class="tvl-bar" style="width:${(tvl / maxTvl) * 100}%"></div></div><span class="tvl-tvl">${fmtUsd(tvl)}</span></div>`;
    }).join("");
  } catch (e) { console.error("tvl", e); }
}

// ─── 6. Stablecoin Yields (DeFiLlama yields API — one call) ───
const YIELD_PLATFORMS = ["morpho-blue", "aave-v3", "moonwell-lending", "jupiter-lend", "kamino-lend"];
const YIELD_STABLES = ["usdc","usdt","dai","susde","usde","frax","tusd","lusd","pyusd","usdy","usds","alusd","cusdc","cusb","eurc","rlusd"];
// Chain names from API are capitalized: "Base", "Solana", "Ethereum"
const YIELD_CHAIN_MAP = { "base": "Base", "solana": "Solana", "ethereum": "Ethereum" };

function cleanSymbol(sym) {
  const s = sym.toUpperCase();
  for (const st of ["SUSDE","USDE","PYUSD","USDC","USDT","DAI","FRAX","TUSD","LUSD","USDY","USDS","RLUSD","EURC","CUSDC","CUSB","ALUSD"]) {
    if (s.includes(st)) return st;
  }
  return sym;
}

function yieldProjectLabel(project) {
  const map = { "morpho-blue": "Morpho", "aave-v3": "Aave", "moonwell-lending": "Moonwell", "jupiter-lend": "Jupiter", "kamino-lend": "Kamino" };
  return map[project] || project;
}

// Build direct link to the actual platform pool
function yieldDeepLink(project, chain, symbol, underlyingTokens) {
  const chainLower = chain.toLowerCase();
  const token = underlyingTokens?.[0] || "";

  if (project === "morpho-blue") {
    // Morpho: app.morpho.org with network + asset param
    if (token) return `https://app.morpho.org/?network=${chainLower}&asset=${token}`;
    return `https://app.morpho.org/?network=${chainLower}`;
  }
  if (project === "moonwell-lending") {
    // Moonwell: moonwell.fi/base?market=USDC
    const sym = cleanSymbol(symbol);
    return `https://moonwell.fi/${chainLower}?market=${sym}`;
  }
  if (project === "jupiter-lend") {
    // Jupiter Lend: jup.ag/lend — no per-pool deep link, link to the token page
    if (token) return `https://jup.ag/tokens/${chainLower}/${token}`;
    return `https://jup.ag/lend`;
  }
  if (project === "kamino-lend") {
    // Kamino: app.kamino.lend — link to lending dashboard
    return `https://app.kamino.lend/`;
  }
  if (project === "aave-v3") {
    // Aave: app.aave.com with market + asset
    if (chainLower === "base" && token) return `https://app.aave.com/?marketName=proto_base_v3&asset=${token}`;
    if (chainLower === "ethereum" && token) return `https://app.aave.com/?marketName=proto_mainnet_v3&asset=${token}`;
    return `https://app.aave.com/`;
  }
  // Fallback: DeFiLlama yield page
  return `https://defillama.com/yields?project=${project}&chain=${chainLower}`;
}

async function loadYields(filterChain) {
  const listEl = document.getElementById("yield-list");
  const newEl = document.getElementById("new-yield-list");
  if (!listEl) return;

  // Store previous yields to detect new ones
  const prevKey = "dd_prev_yields";
  let prevYields = {};
  try { prevYields = JSON.parse(localStorage.getItem(prevKey) || "{}"); } catch {}

  try {
    const r = await cachedFetch("yields", "https://yields.llama.fi/pools");
    const pools = r.data || [];

    // Filter: target platforms + stablecoin symbols + min TVL
    let filtered = pools.filter(p => {
      const project = (p.project || "").toLowerCase();
      const sym = (p.symbol || "").toLowerCase();
      const apy = p.apy || 0;
      const tvl = p.tvlUsd || 0;
      return (
        YIELD_PLATFORMS.includes(project) &&
        apy > 0 &&
        tvl > 50000 &&
        YIELD_STABLES.some(s => sym.includes(s))
      );
    });

    // Apply chain filter if specified
    if (filterChain && filterChain !== "all") {
      const targetChainName = YIELD_CHAIN_MAP[filterChain] || filterChain;
      filtered = filtered.filter(p => (p.chain || "").toLowerCase() === filterChain);
    }

    // Sort by APY descending
    filtered.sort((a, b) => (b.apy || 0) - (a.apy || 0));

    // Top 12 for main list
    const top = filtered.slice(0, 12);

    // Build main list
    listEl.innerHTML = top.map(p => {
      const sym = cleanSymbol(p.symbol);
      const proj = yieldProjectLabel(p.project);
      const chain = p.chain;
      const apy = (p.apy || 0).toFixed(2);
      const tvl = p.tvlUsd || 0;
      const poolKey = `${proj}-${chain}-${sym}`;
      const isNew = !prevYields[poolKey];
      const link = yieldDeepLink(p.project, p.chain, p.symbol, p.underlyingTokens);
      const tvlStr = tvl >= 1e6 ? "$" + (tvl/1e6).toFixed(1) + "M" : "$" + (tvl/1e3).toFixed(0) + "K";
      return `<div class="yield-item ${apy > 6 ? "high" : ""} ${isNew ? "new" : ""}">
        <div><span class="yield-project">${proj}</span> <span class="yield-chain">${chain}</span></div>
        <span class="yield-symbol">${sym}</span>
        <span class="yield-tvl">${tvlStr}</span>
        <span class="yield-apy">${apy}%</span>
        <a class="yield-link" href="${link}" target="_blank" rel="noopener" title="Open ${proj} ${sym} on ${chain}">↗</a>
      </div>`;
    }).join("");

    // NEW: high yields not seen in previous refresh (>4% APY, newly appeared or APY jumped)
    const jumped = filtered.filter(p => {
      const sym = cleanSymbol(p.symbol);
      const proj = yieldProjectLabel(p.project);
      const poolKey = `${proj}-${p.chain}-${sym}`;
      const prevApy = prevYields[poolKey];
      return (p.apy || 0) > 4 && (!prevApy || (p.apy - prevApy) > 1);
    }).slice(0, 6);

    if (newEl) {
      if (jumped.length === 0) {
        newEl.innerHTML = `<div class="yield-item" style="border-left-color:var(--text-muted);opacity:0.6"><div>No new high yields this refresh</div></div>`;
      } else {
        newEl.innerHTML = jumped.map(p => {
          const sym = cleanSymbol(p.symbol);
          const proj = yieldProjectLabel(p.project);
          const apy = (p.apy || 0).toFixed(2);
          const link = yieldDeepLink(p.project, p.chain, p.symbol, p.underlyingTokens);
          return `<div class="yield-item new">
            <div><span class="yield-project">${proj}</span> <span class="yield-chain">${p.chain}</span></div>
            <span class="yield-symbol">${sym}</span>
            <span class="yield-apy">${apy}%</span>
            <a class="yield-link" href="${link}" target="_blank" rel="noopener">↗</a>
          </div>`;
        }).join("");
      }
    }

    // Save current yields as prev for next refresh
    const newPrev = {};
    filtered.forEach(p => {
      const sym = cleanSymbol(p.symbol);
      const proj = yieldProjectLabel(p.project);
      newPrev[`${proj}-${p.chain}-${sym}`] = p.apy || 0;
    });
    localStorage.setItem(prevKey, JSON.stringify(newPrev));

  } catch (e) {
    console.error("yields", e);
    listEl.innerHTML = `<div class="yield-item" style="border-left-color:var(--red)"><div>Unable to load yields</div></div>`;
  }
}

// Current chain filter for yields
let yieldChainFilter = "all";

// Chain tab buttons
function setupYieldTabs() {
  document.querySelectorAll(".yield-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".yield-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      yieldChainFilter = tab.getAttribute("data-chain");
      loadYields(yieldChainFilter);
    });
  });
}

// ─── 7. Crypto News (CryptoPanic + RSS fallback) ───
async function loadNews() {
  const list = document.getElementById("news-list");
  try {
    const r = await cachedFetch("news", "https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&kind=news");
    list.innerHTML = r.results.slice(0, 10).map(item => {
      const d = new Date(item.published_at);
      return `<div class="news-item"><div class="news-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title}</a></div><div class="news-meta">${item.source?.title || "Unknown"} · ${timeAgo(Math.floor(d.getTime() / 1000))}</div></div>`;
    }).join("");
  } catch {
    try {
      const r = await cachedFetch("news2", "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent("https://www.coindesk.com/arc/outboundfeeds/rss/"));
      list.innerHTML = r.items.slice(0, 10).map(item => `<div class="news-item"><div class="news-title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></div><div class="news-meta">CoinDesk · ${timeAgo(Math.floor(new Date(item.pubDate).getTime() / 1000))}</div></div>`).join("");
    } catch { list.innerHTML = `<div class="news-item"><div class="news-title">News feed temporarily unavailable</div></div>`; }
  }
}

// ─── 8. Fear & Greed (gasoline gauge) ───
async function loadFear() {
  try {
    const r = await cachedFetch("fear", FEAR + "?limit=1");
    const d = r.data[0];
    const val = parseInt(d.value);
    document.getElementById("fear-value").textContent = val;
    document.getElementById("fear-label").textContent = d.value_classification;
    document.getElementById("gauge-fill").style.width = val + "%";
    document.getElementById("gauge-needle").style.left = `calc(${val}% - 2px)`;
    const valEl = document.getElementById("fear-value");
    if (val < 25) valEl.style.color = "#ea3943";
    else if (val < 45) valEl.style.color = "#f7b500";
    else if (val < 55) valEl.style.color = "#8b91a5";
    else valEl.style.color = "#16c784";
  } catch (e) { console.error("fear", e); }
}

// ─── Coin → TradingView symbol mapping (Coinbase USD, fallback Binance USDT) ───
// Primary: Coinbase USD pairs. Fallback: Binance USDT pairs for coins not on Coinbase.
const TV_SYMBOLS = {
  bitcoin: "COINBASE:BTCUSD", ethereum: "COINBASE:ETHUSD", solana: "COINBASE:SOLUSD",
  binancecoin: "COINBASE:BNBUSD", ripple: "COINBASE:XRPUSD", dogecoin: "COINBASE:DOGEUSD",
  cardano: "COINBASE:ADAUSD", "avalanche-2": "COINBASE:AVAXUSD", polkadot: "COINBASE:DOTUSD",
  chainlink: "COINBASE:LINKUSD", polygon: "COINBASE:POLUSD", litecoin: "COINBASE:LTCUSD",
  tron: "COINBASE:TRXUSD", "shiba-inu": "COINBASE:SHIBUSD", uniswap: "COINBASE:UNIUSD",
  "bitcoin-cash": "COINBASE:BCHUSD", near: "COINBASE:NEARUSD", aptos: "COINBASE:APTUSD",
  optimism: "COINBASE:OPUSD", filecoin: "COINBASE:FILUSD",
  "render-token": "COINBASE:RNDRUSD", "injective-protocol": "COINBASE:INJUSD",
  "the-graph": "COINBASE:GRTUSD", sui: "COINBASE:SUIUSD", pepe: "COINBASE:PEPEUSD",
  celestia: "COINBASE:TIAUSD", "ethereum-classic": "COINBASE:ETCUSD",
  stellar: "COINBASE:XLMUSD", cosmos: "COINBASE:ATOMUSD",
  tezos: "COINBASE:XTZUSD", aave: "COINBASE:AAVEUSD", maker: "COINBASE:MKRUSD",
  "sei-network": "COINBASE:SEIUSD", dymension: "COINBASE:DYMUSD",
  tether: "KRAKEN:USDTUSD",
  // Coins NOT on Coinbase — use Binance USDT directly (no fallback needed)
  arbitrum: "BINANCE:ARBUSDT", starknet: "BINANCE:STRKUSD", wormhole: "BINANCE:WUSDT",
  "injective-protocol": "BINANCE:INJUSD",
};

// Coins known to NOT have Coinbase USD pairs — skip to Binance USDT directly
const BINANCE_FALLBACK = new Set([
  "arbitrum", "starknet", "wormhole", "ondo", "dogwifcoin", "bonk",
  "jasmycoin", "floki", "peon", "the-protocol", "rollbit-coin",
  " Kaspa", "core", "seal", "maga-hat", "polymesh",
]);

function coinToTvSymbol(coin) {
  if (TV_SYMBOLS[coin.id]) return TV_SYMBOLS[coin.id];
  // If known Binance-only coin, go straight to Binance USDT
  if (BINANCE_FALLBACK.has(coin.id)) return "BINANCE:" + coin.symbol.toUpperCase() + "USDT";
  // Default: try Coinbase USD
  return "COINBASE:" + coin.symbol.toUpperCase() + "USD";
}

// Try to load chart with symbol. If it fails ( TradingView shows error),
// user can still search. But we try Coinbase first, Binance USDT as auto-fallback.
function coinToTvSymbolWithFallback(coin) {
  const primary = coinToTvSymbol(coin);
  // If it's a Coinbase pair, also prepare Binance fallback
  if (primary.startsWith("COINBASE:")) {
    const sym = primary.replace("COINBASE:", "");
    // Extract the coin symbol (strip USD)
    const coinSym = sym.replace("USD", "");
    return { primary, fallback: "BINANCE:" + coinSym + "USDT" };
  }
  return { primary, fallback: null };
}

// ─── 9. TradingView Chart Widget ───
let currentChartSymbol = "COINBASE:BTCUSD";
let currentChartName = "Bitcoin";

function loadTradingView(symbol, name) {
  if (symbol) { currentChartSymbol = symbol; currentChartName = name || symbol; }
  const container = document.getElementById("tradingview-chart");
  if (container) {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true, symbol: currentChartSymbol, interval: "240",
      timezone: "America/Chicago", theme: "dark", style: "1", locale: "en",
      backgroundColor: "rgba(10, 10, 15, 1)", gridColor: "rgba(35, 38, 52, 0.5)",
      hide_top_toolbar: false, hide_legend: false, allow_symbol_change: true,
      withdateranges: true, save_image: false, details: false, calendar: false,
      support_host: "https://www.tradingview.com",
      studies: [
        "STD;RSI",
        "STD;MACD",
      ],
    });
    container.innerHTML = "";
    container.appendChild(script);
  }
  const titleEl = document.getElementById("chart-title");
  if (titleEl) titleEl.textContent = "📈 " + currentChartName + " — Live Chart";
  const extLink = document.getElementById("tv-ext-link");
  if (extLink) extLink.href = "https://www.tradingview.com/chart/?symbol=" + currentChartSymbol;

  if (symbol === undefined) {
    const ticker = document.getElementById("tradingview-ticker");
    if (ticker) {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
      script.async = true;
      script.innerHTML = JSON.stringify({
        symbols: [
          { proName: "COINBASE:BTCUSD", title: "Bitcoin" },
          { proName: "COINBASE:ETHUSD", title: "Ethereum" },
          { proName: "COINBASE:SOLUSD", title: "Solana" },
          { proName: "COINBASE:BNBUSD", title: "BNB" },
          { proName: "COINBASE:XRPUSD", title: "XRP" },
          { proName: "COINBASE:DOGEUSD", title: "Dogecoin" },
          { proName: "COINBASE:ADAUSD", title: "Cardano" },
          { proName: "COINBASE:AVAXUSD", title: "Avalanche" },
        ],
        showSymbolLogo: true, isTransparent: true, displayMode: "adaptive", colorTheme: "dark", locale: "en",
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
    // Phase 1: CoinGecko data (3 calls) + independent APIs (4 calls) in parallel
    const [cgPrices, , , , , ,] = await Promise.all([
      loadCoinGeckoData(),  // returns { ethPrice, maticPrice, bnbPrice }
      loadGas(),
      loadTvl(),
      loadYields(yieldChainFilter),
      loadNews(),
      loadFear(),
    ]);

    // Phase 2: EVM tx costs (uses token prices from Phase 1, 6 parallel RPC calls)
    if (cgPrices) await loadEvmTxCosts(cgPrices);

    loadTradingView();
    document.getElementById("last-updated").textContent = "Updated " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    document.getElementById("last-updated").textContent = "Update failed — try again";
  }

  btn.disabled = false;
  btn.textContent = "↻ Refresh";
  refreshing = false;
}

// ─── Event listeners ───
document.getElementById("chain-select")?.addEventListener("change", (e) => renderCoins(e.target.value));
document.getElementById("refresh-btn").addEventListener("click", refreshAll);
setInterval(refreshAll, 5 * 60 * 1000);
setupYieldTabs();

// ─── Init ───
refreshAll();