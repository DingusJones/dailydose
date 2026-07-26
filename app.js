// DailyDose — Crypto Dashboard app.js (optimized)
// APIs: CoinGecko (coins/prices/trending), DeFiLlama (TVL), Alternative.me (Fear & Greed),
//        CoinDesk RSS (news), TradingView (charts), public RPCs (L2 gas)
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

async function cachedFetch(key, url, force) {
  if (!force) {
    const cached = cache.get(key);
    if (cached) return cached;
  }
  try {
    const r = await fetch(url);
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
    document.getElementById("btc-dom").textContent = d.market_cap_percentage.btc.toFixed(2) + "%";
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
    renderCoins(allCoins);

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
      document.getElementById("eth-gas").textContent = parseFloat(r.result.FastGasPrice).toFixed(3);
    }
  } catch {
    try {
      const r2 = await cachedFetch("gas2", "https://api.ethplorer.io/getGasPrice?apiKey=free");
      document.getElementById("eth-gas").textContent = (r2.gasPrice / 1e9).toFixed(3);
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
      return `<tr>
        <td data-label="Chain">${chain.name}</td>
        <td data-label="Gas Price" colspan="5" class="muted">Unable to fetch</td>
        <td data-label="Explorer"><a href="${chain.explorer}" target="_blank" rel="noopener" style="font-size:11px">Explorer ↗</a></td>
      </tr>`;
    }
    const { gasGwei, fmtCost, cost } = res.value;
    return `<tr>
      <td data-label="Chain">${chain.name}</td>
      <td data-label="Gas Price">${gasGwei.toFixed(4)} gwei</td>
      <td data-label="Send ETH">${fmtCost(cost(TX_GAS.send))}</td>
      <td data-label="ERC-20 Transfer">${fmtCost(cost(TX_GAS.erc20))}</td>
      <td data-label="DEX Swap">${fmtCost(cost(TX_GAS.swap))}</td>
      <td data-label="LP Stake">${fmtCost(cost(TX_GAS.stake))}</td>
      <td data-label="Link"><a href="${chain.explorer}" target="_blank" rel="noopener" style="font-size:11px">Explorer ↗</a></td>
    </tr>`;
  }).join("");
}

// ─── 4. Top Coins table (rendered from cached allCoins) ───
// Chain → CoinGecko category mapping
const CHAIN_CATEGORIES = {
  all: null,
  ethereum: "ethereum-ecosystem",
  solana: "solana-ecosystem",
  "binance-smart-chain": "binance-smart-chain",
  "polygon-pos": "polygon-ecosystem",
  "arbitrum-one": "arbitrum-ecosystem",
  "optimistic-ethereum": "optimism-ecosystem",
  base: "base-ecosystem",
  avalanche: "avalanche-ecosystem",
};

function renderCoins(coins) {
  const tbody = document.getElementById("coins-tbody");
  if (!coins || coins.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);padding:20px">No coins found for this chain</td></tr>`;
    return;
  }
  coins = coins.slice(0, 25);
  tbody.innerHTML = coins.map((c, i) => {
    const pct24 = c.price_change_percentage_24h;
    const color = pct24 >= 0 ? "#16c784" : "#ea3943";
    const { primary, fallback } = coinToTvSymbolWithFallback(c);
    const cgUrl = `https://www.coingecko.com/en/coins/${c.id}`;
    const dexScreenerUrl = `https://dexscreener.com/search?q=${c.symbol}`;
    return `<tr class="coin-row" data-tv="${primary}" data-tv-fallback="${fallback || ""}" data-name="${c.name}" title="Rank #${i + 1}">
      <td class="rank-cell">${i + 1}</td>
      <td><div class="coin-cell"><img src="${c.image}" alt="" loading="lazy" onerror="this.style.display='none'"><a href="${cgUrl}" target="_blank" rel="noopener" class="coin-name-link" title="Research ${c.name} on CoinGecko">${c.name}</a><a href="${cgUrl}" target="_blank" rel="noopener" class="coin-sym-link muted" title="${c.name} on CoinGecko">${c.symbol.toUpperCase()}</a></div></td>
      <td class="price-cell" style="cursor:pointer" title="Click to chart ${c.name}">${fmtUsd(c.current_price)}</td>
      <td class="pct-cell ${changeClass(pct24)}" style="cursor:pointer" data-ds="${dexScreenerUrl}" title="Click for ${c.name} charts & volume on DexScreener">${fmtPct(pct24)}</td>
      <td>${fmtUsd(c.market_cap)}</td>
      <td>${fmtUsd(c.total_volume)}</td>
      <td>${sparklineSvg(c.sparkline_in_7d?.price, color)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".coin-row").forEach(row => {
    const tv = row.getAttribute("data-tv");
    const name = row.getAttribute("data-name");
    // Price cell click → load TradingView chart above
    const priceCell = row.querySelector(".price-cell");
    if (priceCell) {
      priceCell.addEventListener("click", (e) => {
        e.stopPropagation();
        tbody.querySelectorAll(".coin-row").forEach(r => r.classList.remove("selected-coin"));
        row.classList.add("selected-coin");
        loadTradingView(tv, name);
        document.getElementById("tradingview-chart").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    // 24h% cell click → open DexScreener for volume/charts
    const pctCell = row.querySelector(".pct-cell");
    if (pctCell) {
      pctCell.addEventListener("click", (e) => {
        e.stopPropagation();
        const dsUrl = pctCell.getAttribute("data-ds");
        if (dsUrl) window.open(dsUrl, "_blank", "noopener");
      });
    }
  });
}

// Pre-fetch chain coins in background after initial load — makes switching chains instant
const preloadedChains = {};
function preloadChainCoins() {
  const chains = Object.keys(CHAIN_CATEGORIES).filter(k => k !== "all" && !preloadedChains[k]);
  chains.forEach(chain => {
    const category = CHAIN_CATEGORIES[chain];
    // Use stale-while-revalidate: if cached, skip; if not, fetch quietly
    const cacheKey = `coins_${chain}`;
    const cached = cache.get(cacheKey) || cache.getStale(cacheKey);
    if (cached) {
      preloadedChains[chain] = true;
      return;
    }
    // Fetch in background — don't block UI
    fetch(`${CG}/coins/markets?vs_currency=usd&category=${category}&order=market_cap_desc&per_page=25&page=1&sparkline=true&price_change_percentage=24h,7d`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { cache.set(cacheKey, data); preloadedChains[chain] = true; } })
      .catch(() => {});
  });
}

async function loadChainCoins(chain) {
  const tbody = document.getElementById("coins-tbody");
  const category = CHAIN_CATEGORIES[chain];
  if (!category) {
    renderCoins(allCoins);
    return;
  }
  const cacheKey = `coins_${chain}`;
  // Instant: show stale cached data if available
  const stale = cache.getStale(cacheKey);
  if (stale) renderCoins(stale);
  else tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);padding:20px">Loading…</td></tr>`;
  // Then fetch fresh data (cachedFetch returns instantly if fresh cache exists)
  try {
    const coins = await cachedFetch(cacheKey, `${CG}/coins/markets?vs_currency=usd&category=${category}&order=market_cap_desc&per_page=25&page=1&sparkline=true&price_change_percentage=24h,7d`);
    renderCoins(coins);
  } catch (e) {
    if (!stale) {
      console.error("chain coins", e);
      tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);padding:20px">Failed to load</td></tr>`;
    }
    // If we have stale data, keep showing it — don't show error
  }
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

// ─── 6. Stablecoin Yields ───
// Source strategy:
//   - Morpho: native Blue GraphQL API (exact vault names, real net APY, exact links)
//   - Moonwell: native REST API (baseSupplyApy, totalSupplyUsd)
//   - Aave / Jupiter / Kamino: DeFiLlama fallback (no reliable free native API without auth/RPC limits)
//   - DeFiLlama is STILL used for Global TVL, chain TVL, and other dashboard calls.
const YIELD_MIN_TVL = 100000;
const YIELD_MAX_APY = 50;
const YIELD_STABLES = ["usdc", "usdt", "dai", "susde", "usde", "pyusd", "usds"];

// --- Morpho Blue native API ---
const MORPHO_CHAIN_IDS = { base: 8453, ethereum: 1, arbitrum: 42161, polygon: 137, optimism: 10 };

function morphoVaultUrl(chain, address, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `https://app.morpho.org/${chain}/vault/${address}/${slug}#overview`;
}

async function loadMorphoYields() {
  const url = "https://blue-api.morpho.org/graphql";
  const results = [];
  try {
    for (const [chain, chainId] of Object.entries(MORPHO_CHAIN_IDS)) {
      const query = JSON.stringify({
        query: `{ vaults(where: { chainId_in: [${chainId}] }, first: 1000) { items { address name symbol asset { address symbol } state { totalAssetsUsd netApy fee } } } }`
      });
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: query });
      const d = await r.json();
      const vaults = d?.data?.vaults?.items || [];
      for (const v of vaults) {
        const assetSym = (v.asset?.symbol || "").toLowerCase();
        if (!YIELD_STABLES.some(s => assetSym.includes(s))) continue;
        const tvl = v.state?.totalAssetsUsd || 0;
        const apy = (v.state?.netApy || 0) * 100;
        if (tvl < YIELD_MIN_TVL || apy <= 0 || apy > YIELD_MAX_APY) continue;
        results.push({
          project: "morpho-blue",
          chain,
          chainDisplay: chain.charAt(0).toUpperCase() + chain.slice(1),
          name: v.name,
          symbol: v.symbol,
          asset: v.asset?.symbol || v.symbol,
          apy,
          tvlUsd: tvl,
          link: morphoVaultUrl(chain, v.address, v.name),
          source: "Morpho API"
        });
      }
    }
  } catch (e) { console.error("morpho yields", e); }
  return results;
}

// --- Moonwell native API ---
async function loadMoonwellYields() {
  const results = [];
  const stables = ["USDC", "USDT", "DAI", "USDS", "PYUSD", "EURC"];
  try {
    const r = await fetch("https://api.moonwell.fi/v1/markets", { headers: { "Accept": "application/json" } });
    const d = await r.json();
    // Current endpoint returns Base markets by default (meta.chain eip155:8453)
    const chain = "base";
    for (const m of d?.data || []) {
      const sym = (m.asset || "").toUpperCase();
      if (!stables.includes(sym)) continue;
      const apy = (m.totalSupplyApr || m.baseSupplyApy || 0) * 100;
      const tvl = m.totalSupplyUsd || 0;
      if (tvl < YIELD_MIN_TVL || apy <= 0 || apy > YIELD_MAX_APY) continue;
      results.push({
        project: "moonwell-lending",
        chain,
        chainDisplay: "Base",
        name: `Moonwell ${sym}`,
        symbol: `m${sym}`,
        asset: sym,
        apy,
        tvlUsd: tvl,
        link: `https://moonwell.fi/${chain}?market=${sym}`,
        source: "Moonwell API"
      });
    }
  } catch (e) { console.error("moonwell yields", e); }
  return results;
}

// --- Fallback: DeFiLlama for platforms without a reliable free native API ---
async function loadFallbackYields() {
  try {
    const r = await cachedFetch("yields", "https://yields.llama.fi/pools");
    const pools = r.data || [];
    return pools.filter(p => {
      const project = (p.project || "").toLowerCase();
      const chain = (p.chain || "").toLowerCase();
      const sym = (p.symbol || "").toLowerCase();
      const apy = p.apy || 0;
      const tvl = p.tvlUsd || 0;
      const platforms = ["aave-v3", "jupiter-lend", "kamino-lend"];
      const chains = ["base", "solana", "ethereum", "arbitrum", "polygon", "optimism"];
      return (
        platforms.includes(project) &&
        chains.includes(chain) &&
        apy > 0 && apy <= YIELD_MAX_APY &&
        tvl >= YIELD_MIN_TVL &&
        YIELD_STABLES.some(s => sym.includes(s))
      );
    }).map(p => ({
      project: p.project,
      chain: p.chain.toLowerCase(),
      chainDisplay: p.chain,
      name: cleanSymbol(p.symbol),
      symbol: p.symbol,
      asset: cleanSymbol(p.symbol),
      apy: p.apy,
      tvlUsd: p.tvlUsd,
      link: yieldDeepLink(p.project, p.chain, p.symbol, p.underlyingTokens),
      source: "DeFiLlama"
    }));
  } catch (e) { console.error("fallback yields", e); return []; }
}

function yieldDeepLink(project, chain, symbol, underlyingTokens) {
  const chainLower = chain.toLowerCase();
  const token = underlyingTokens?.[0] || "";
  const sym = cleanSymbol(symbol);
  if (project === "aave-v3") {
    if (chainLower === "base" && token) return `https://app.aave.com/?marketName=proto_base_v3&asset=${token}`;
    if (chainLower === "ethereum" && token) return `https://app.aave.com/?marketName=proto_mainnet_v3&asset=${token}`;
    if (chainLower === "arbitrum" && token) return `https://app.aave.com/?marketName=proto_arbitrum_v3&asset=${token}`;
    if (chainLower === "optimism" && token) return `https://app.aave.com/?marketName=proto_optimism_v3&asset=${token}`;
    if (chainLower === "polygon" && token) return `https://app.aave.com/?marketName=proto_polygon_v3&asset=${token}`;
    return `https://app.aave.com/?asset=${token}`;
  }
  if (project === "moonwell-lending") return `https://moonwell.fi/${chainLower}?market=${sym}`;
  if (project === "jupiter-lend") return token ? `https://jup.ag/lend?token=${token}` : "https://jup.ag/lend";
  if (project === "kamino-lend") return "https://app.kamino.finance/lend";
  return `https://defillama.com/yields?project=${project}&chain=${chainLower}`;
}

function cleanSymbol(sym) {
  const s = sym.toUpperCase();
  for (const st of ["SUSDE", "USDE", "PYUSD", "USDC", "USDT", "DAI", "FRAX", "TUSD", "LUSD", "USDY", "USDS", "RLUSD", "EURC", "CUSDC", "CUSB", "ALUSD"]) {
    if (s.includes(st)) return st;
  }
  return sym;
}

function yieldProjectLabel(project) {
  const map = { "morpho-blue": "Morpho", "aave-v3": "Aave", "moonwell-lending": "Moonwell", "jupiter-lend": "Jupiter", "kamino-lend": "Kamino" };
  return map[project] || project;
}

let yieldPlatformFilter = "all";
let yieldChainFilter = "all";

async function loadYields(filterPlatform, filterChain) {
  const listEl = document.getElementById("yield-list");
  if (!listEl) return;

  const prevKey = "dd_prev_yields";
  let prevYields = {};
  try { prevYields = JSON.parse(localStorage.getItem(prevKey) || "{}"); } catch {}

  try {
    const [morpho, moonwell, fallback] = await Promise.all([
      loadMorphoYields(),
      loadMoonwellYields(),
      loadFallbackYields()
    ]);

    let all = [...morpho, ...moonwell, ...fallback];

    if (filterPlatform && filterPlatform !== "all") {
      all = all.filter(p => p.project === filterPlatform);
    }
    if (filterChain && filterChain !== "all") {
      all = all.filter(p => p.chain === filterChain);
    }

    // Sort by APY descending
    all.sort((a, b) => b.apy - a.apy);
    const top = all.slice(0, 12);

    // Build main list
    listEl.innerHTML = top.map(p => {
      const apyStr = p.apy.toFixed(2);
      const tvlStr = p.tvlUsd >= 1e6 ? "$" + (p.tvlUsd/1e6).toFixed(1) + "M" : "$" + (p.tvlUsd/1e3).toFixed(0) + "K";
      const poolKey = `${p.project}-${p.chain}-${p.symbol}`;
      const isNew = !prevYields[poolKey];
      const proj = yieldProjectLabel(p.project);
      return `<a href="${p.link}" target="_blank" rel="noopener" class="yield-item-link" title="Open ${p.name} on ${p.chainDisplay}">
        <div class="yield-item ${p.apy > 6 ? "high" : ""} ${isNew ? "new" : ""}">
          <div class="yield-main">
            <span class="yield-name">${p.name} <span class="yield-chain-badge">${p.chainDisplay}</span></span>
            <span class="yield-project">${proj} · <span class="yield-source">${p.source}</span></span>
          </div>
          <span class="yield-tvl">${tvlStr}</span>
          <span class="yield-apy">${apyStr}%</span>
          <span class="yield-link-icon">↗</span>
        </div>
      </a>`;
    }).join("");

    // Save current yields as prev for next refresh
    const newPrev = {};
    all.forEach(p => {
      newPrev[`${p.project}-${p.chain}-${p.symbol}`] = p.apy;
    });
    localStorage.setItem(prevKey, JSON.stringify(newPrev));

  } catch (e) {
    console.error("yields", e);
    listEl.innerHTML = `<div class="yield-item" style="border-left-color:var(--red)"><div>Unable to load yields</div></div>`;
  }
}

function setupYieldTabs() {
  document.querySelectorAll(".yield-platform-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".yield-platform-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      yieldPlatformFilter = tab.getAttribute("data-platform");
      loadYields(yieldPlatformFilter, yieldChainFilter);
    });
  });
  document.querySelectorAll(".yield-chain-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".yield-chain-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      yieldChainFilter = tab.getAttribute("data-chain");
      loadYields(yieldPlatformFilter, yieldChainFilter);
    });
  });
}

// ─── 7. Crypto News (multi-source RSS, filterable, infinite scroll) ───
const NEWS_FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph" },
  { url: "https://decrypt.co/feed", source: "Decrypt" },
  { url: "https://www.theblock.co/rss.xml", source: "The Block" },
  { url: "https://news.bitcoin.com/feed/", source: "Bitcoin.com" },
  { url: "https://www.newsbtc.com/feed/", source: "NewsBTC" },
  { url: "https://cryptopotato.com/feed/", source: "CryptoPotato" },
  { url: "https://coinjournal.net/feed/", source: "CoinJournal" },
];

// Category keyword mapping — match article title + categories against unified taxonomy
// Use \b word boundaries for short keywords to avoid false positives (e.g. "ai" in "prediction")
const NEWS_CATEGORIES = [
  { key: "Markets", keywords: ["market", "price", "surge", "rally", "dump", "pump", "trading", "altcoin", "crash", "drop", "volume", /\bcoin\b/, /\btoken\b/, /\bgain\b/, /\bloss\b/] },
  { key: "Policy", keywords: ["policy", "regulation", /\bsec\b/, "cftc", "congress", "senate", /\blaw\b/, "legal", "court", "lawsuit", /\bban\b/, "sanction", "government", "trump", "white house", "democrat", "republican", "clarity act", "mica", "russia", "china", "korea", "regulator"] },
  { key: "DeFi", keywords: ["defi", "liquidity", "vault", /\byield\b/, "lending", "borrow", "staking", "uniswap", /\baave\b/, "morpho", "compound", /\bcurve\b/, /\bmaker\b/, "total value locked", /\btvl\b/, /\bdex\b/, "hyperliquid", /\bperp\b/] },
  { key: "Business", keywords: ["funding", /\braise\b/, "investment", "acquisition", "merger", "partnership", /\blaunch\b/, "startup", "exchange", "bitmart", "robinhood", "sberbank", "company", /\bfirm\b/, "corporate", /\bdeal\b/] },
  { key: "Opinion", keywords: ["opinion", "commentary", "editorial", "guest post", /\breview\b/, "perspective"] },
  { key: "Tech", keywords: ["technology", "upgrade", /\bfork\b/, "layer 2", /\bl2\b/, "scaling", "rollup", "zero-knowledge", /\bzk\b/, "protocol", "blockchain", /\bnode\b/, "validator", "miner", "mining", /\bhash\b/, "infrastructure"] },
  { key: "AI", keywords: [/\bai\b/, "artificial intelligence", "machine learning", "openai", "chatgpt", "deepfake", /\bllm\b/, "sam altman", "world network"] },
];

function classifyArticle(title, categories) {
  const text = (title + " " + categories.join(" ")).toLowerCase();
  const matched = [];
  for (const cat of NEWS_CATEGORIES) {
    if (cat.keywords.some(kw => {
      if (kw instanceof RegExp) return kw.test(text);
      return text.includes(kw);
    })) {
      matched.push(cat.key);
    }
  }
  return matched.length > 0 ? matched : ["Markets"]; // default to Markets if no match
}

let allNewsItems = [];
let newsFilter = "all";
let newsDisplayCount = 15;
const NEWS_PAGE_SIZE = 15;

async function loadNews() {
  const list = document.getElementById("news-list");
  const sentinel = document.getElementById("news-sentinel");
  if (!list) return;

  try {
    // Fetch all feeds in parallel — single Promise.allSettled
    const results = await Promise.allSettled(
      NEWS_FEEDS.map(feed =>
        cachedFetch(`news_${feed.source}`, "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed.url))
      )
    );

    // Merge all items into unified pool
    const seen = new Set();
    allNewsItems = [];

    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== "fulfilled" || !results[i].value?.items) continue;
      const source = NEWS_FEEDS[i].source;
      for (const item of results[i].value.items) {
        // Deduplicate by title (different sources may cover same story)
        const titleKey = (item.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 60);
        if (seen.has(titleKey)) continue;
        seen.add(titleKey);

        const rawCats = (item.categories || []).map(c => c.trim());
        const articleCats = classifyArticle(item.title || "", rawCats);
        const imgUrl = item.enclosure?.link || item.thumbnail || "";

        allNewsItems.push({
          title: item.title || "",
          link: item.link || "#",
          desc: (item.description || item.content || "").replace(/<[^>]*>/g, "").substring(0, 200),
          pubDate: item.pubDate || "",
          author: item.author || "",
          categories: articleCats,
          image: imgUrl,
          source: source,
          timestamp: new Date(item.pubDate || 0).getTime(),
        });
      }
    }

    // Sort by date descending (newest first)
    allNewsItems.sort((a, b) => b.timestamp - a.timestamp);

    newsDisplayCount = NEWS_PAGE_SIZE;
    renderNews();
  } catch (e) {
    console.error("news", e);
    list.innerHTML = `<div class="news-item"><div class="news-item-body"><div class="news-title">News feed temporarily unavailable</div></div></div>`;
    if (sentinel) sentinel.classList.add("hidden");
  }
}

function renderNews() {
  const list = document.getElementById("news-list");
  const sentinel = document.getElementById("news-sentinel");
  if (!list) return;

  let filtered = allNewsItems;
  if (newsFilter !== "all") {
    filtered = allNewsItems.filter(item =>
      item.categories.includes(newsFilter)
    );
  }

  const visible = filtered.slice(0, newsDisplayCount);

  if (visible.length === 0) {
    list.innerHTML = `<div class="news-item"><div class="news-item-body"><div class="news-title">No articles in this category</div></div></div>`;
    if (sentinel) sentinel.classList.add("hidden");
    return;
  }

  list.innerHTML = visible.map(item => {
    const d = new Date(item.timestamp);
    const ts = Math.floor(d.getTime() / 1000);
    const catBadges = item.categories.slice(0, 2).map(c => `<span class="news-cat-badge">${c}</span>`).join("");
    const imgHtml = item.image
      ? `<img src="${item.image}" alt="" class="news-item-img" loading="lazy" onerror="this.style.display='none'">`
      : "";
    const descHtml = item.desc
      ? `<div class="news-desc">${item.desc.substring(0, 180)}</div>`
      : "";
    return `<div class="news-item">
      ${imgHtml}
      <div class="news-item-body">
        <div class="news-title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></div>
        ${descHtml}
        <div class="news-meta">
          <span class="news-source">${item.source}</span>
          ${item.author ? `<span>· ${item.author}</span>` : ""}
          <span>· ${timeAgo(ts)}</span>
          ${catBadges}
        </div>
      </div>
    </div>`;
  }).join("");

  // Show/hide sentinel based on whether there's more to load
  if (sentinel) {
    if (newsDisplayCount >= filtered.length) {
      sentinel.classList.add("hidden");
    } else {
      sentinel.classList.remove("hidden");
    }
  }
}

// Infinite scroll — load more when sentinel is visible
function setupNewsScroll() {
  const sentinel = document.getElementById("news-sentinel");
  const scrollContainer = document.getElementById("news-scroll");
  if (!sentinel || !scrollContainer) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        let filtered = allNewsItems;
        if (newsFilter !== "all") {
          filtered = allNewsItems.filter(item => item.categories.includes(newsFilter));
        }
        if (newsDisplayCount < filtered.length) {
          newsDisplayCount += NEWS_PAGE_SIZE;
          renderNews();
        }
      }
    });
  }, { root: scrollContainer, rootMargin: "100px", threshold: 0 });

  observer.observe(sentinel);
}

function setupNewsFilterTabs() {
  document.querySelectorAll(".news-filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".news-filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      newsFilter = tab.getAttribute("data-filter");
      newsDisplayCount = NEWS_PAGE_SIZE;
      renderNews();
    });
  });
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
    buildPriceTicker();
  }
}

// ─── Custom auto-scrolling price ticker (mobile-friendly) ───
function buildPriceTicker() {
  const container = document.getElementById("price-ticker");
  if (!container) return;
  if (!allCoins.length) return;

  const tickerCoins = allCoins.slice(0, 12);
  const items = tickerCoins.map(c => {
    const pct = c.price_change_percentage_24h;
    const changeColor = pct >= 0 ? "#16c784" : "#ea3943";
    const changeStr = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
    const tvUrl = `https://www.tradingview.com/chart/?symbol=COINBASE:${c.symbol.toUpperCase()}USD`;
    return `<a href="${tvUrl}" target="_blank" rel="noopener" class="ticker-item" title="${c.name} chart on TradingView">
      <img src="${c.image}" alt="" loading="lazy" onerror="this.style.display='none'">
      <span class="tk-name">${c.symbol.toUpperCase()}</span>
      <span class="tk-price">${fmtUsd(c.current_price)}</span>
      <span class="tk-change" style="color:${changeColor}">${changeStr}</span>
    </a>`;
  }).join("");

  // Duplicate content for seamless loop
  container.innerHTML = `<div class="ticker-track">${items}${items}</div>`;

  // Touch/drag support — pause animation, let user drag, smooth resume
  const track = container.querySelector(".ticker-track");
  let isDragging = false;
  let startX = 0;
  let dragOffset = 0;
  let baseOffset = 0;
  let resumeTimer = null;

  function getX(e) {
    return e.touches ? e.touches[0].clientX : e.clientX;
  }

  function onStart(e) {
    isDragging = true;
    startX = getX(e);
    const matrix = window.getComputedStyle(track).transform;
    baseOffset = 0;
    if (matrix && matrix !== "none") {
      const match = matrix.match(/matrix.*\(([^)]+)\)/);
      if (match) baseOffset = parseFloat(match[1].split(",")[4]) || 0;
    }
    track.style.animationPlayState = "paused";
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  }

  function onMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    dragOffset = getX(e) - startX;
    track.style.transform = `translateX(${baseOffset + dragOffset}px)`;
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    const trackWidth = track.scrollWidth / 2;
    let newOffset = baseOffset + dragOffset;
    while (newOffset > 0) newOffset -= trackWidth;
    while (newOffset < -trackWidth) newOffset += trackWidth;
    track.style.transform = `translateX(${newOffset}px)`;
    resumeTimer = setTimeout(() => {
      track.style.transform = "";
      track.style.animationPlayState = "";
      resumeTimer = null;
    }, 2000);
  }

  // Touch events — passive:false on touchmove so preventDefault works
  track.addEventListener("touchstart", onStart, { passive: false });
  track.addEventListener("touchmove", onMove, { passive: false });
  track.addEventListener("touchend", onEnd);
  track.addEventListener("touchcancel", onEnd);
  // Mouse events (desktop)
  track.addEventListener("mousedown", onStart);
  track.addEventListener("mousemove", (e) => { if (isDragging) onMove(e); });
  track.addEventListener("mouseup", onEnd);
  track.addEventListener("mouseleave", onEnd);
  track.addEventListener("dragstart", (e) => e.preventDefault());
}

// ─── Refresh logic ───
let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;

  document.getElementById("last-updated").textContent = "Updating…";

  try {
    // Phase 1: CoinGecko data (3 calls) + independent APIs (4 calls) in parallel
    // allSettled so one API failure can't nuke everything else
    const [cgRes] = await Promise.allSettled([
      loadCoinGeckoData(),
      loadGas(),
      loadTvl(),
      loadYields(yieldPlatformFilter, yieldChainFilter),
      loadNews(),
      loadFear(),
    ]);

    if (cgRes.status === "fulfilled" && cgRes.value) lastCgPrices = cgRes.value;

    // Phase 2: EVM tx costs (uses token prices from Phase 1, 6 parallel RPC calls)
    if (lastCgPrices.ethPrice > 0) await loadEvmTxCosts(lastCgPrices);

    loadTradingView();
    document.getElementById("last-updated").textContent = "Updated " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    document.getElementById("last-updated").textContent = "Update failed — try again";
  }

  refreshing = false;
}

let lastCgPrices = { ethPrice: 0, maticPrice: 0, bnbPrice: 0 };

// ─── Per-section refresh handlers ───
const refreshHandlers = {
  async market(btn) {
    btn.classList.add("spinning");
    await loadCoinGeckoData().then(p => { if (p) lastCgPrices = p; });
    btn.classList.remove("spinning");
  },
  async chart(btn) {
    btn.classList.add("spinning");
    loadTradingView();
    btn.classList.remove("spinning");
  },
  async coins(btn) {
    btn.classList.add("spinning");
    const sel = document.getElementById("chain-select");
    await loadChainCoins(sel?.value || "all");
    btn.classList.remove("spinning");
  },
  async trending(btn) {
    btn.classList.add("spinning");
    // Re-fetch trending only via CoinGecko search/trending
    try {
      const r = await cachedFetch("trending", CG + "/search/trending", true);
      if (r?.coins) {
        const list = document.getElementById("trending-list");
        list.innerHTML = r.coins.slice(0, 7).map((c, i) => {
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
    } catch (e) { console.error("trending refresh", e); }
    btn.classList.remove("spinning");
  },
  async tvl(btn) {
    btn.classList.add("spinning");
    await loadTvl();
    btn.classList.remove("spinning");
  },
  async yields(btn) {
    btn.classList.add("spinning");
    await loadYields(yieldPlatformFilter, yieldChainFilter);
    btn.classList.remove("spinning");
  },
  async news(btn) {
    btn.classList.add("spinning");
    await loadNews();
    newsDisplayCount = NEWS_PAGE_SIZE;
    renderNews();
    btn.classList.remove("spinning");
  },
  async evm(btn) {
    btn.classList.add("spinning");
    await loadEvmTxCosts(lastCgPrices);
    btn.classList.remove("spinning");
  },
  async fear(btn) {
    btn.classList.add("spinning");
    await loadFear();
    btn.classList.remove("spinning");
  },
  async btc(btn) {
    btn.classList.add("spinning");
    try {
      const r = await cachedFetch("markets_btc", CG + "/coins/markets?vs_currency=usd&ids=bitcoin&sparkline=true&price_change_percentage=24h,7d", true);
      const btc = r?.[0];
      if (btc) {
        const pct = btc.price_change_percentage_24h;
        const color = pct >= 0 ? "#16c784" : "#ea3943";
        document.getElementById("btc-info").innerHTML = `<div class="big-coin-name">${btc.name}</div><div class="big-coin-price">${fmtUsd(btc.current_price)}</div><div class="${changeClass(pct)}" style="font-size:14px;font-weight:600">${fmtPct(pct)} (24h)</div><div class="big-coin-stats"><div><div class="big-coin-stat-label">Market Cap</div><div class="big-coin-stat-value">${fmtUsd(btc.market_cap)}</div></div><div><div class="big-coin-stat-label">24h Volume</div><div class="big-coin-stat-value">${fmtUsd(btc.total_volume)}</div></div><div><div class="big-coin-stat-label">7d Change</div><div class="big-coin-stat-value ${changeClass(btc.price_change_percentage_7d_in_currency)}">${fmtPct(btc.price_change_percentage_7d_in_currency)}</div></div><div><div class="big-coin-stat-label">ATH</div><div class="big-coin-stat-value">${fmtUsd(btc.ath)}</div></div></div><div style="margin-top:10px">${sparklineSvg(btc.sparkline_in_7d?.price, color)}</div>`;
      }
    } catch (e) { console.error("btc refresh", e); }
    btn.classList.remove("spinning");
  },
  async eth(btn) {
    btn.classList.add("spinning");
    try {
      const r = await cachedFetch("markets_eth", CG + "/coins/markets?vs_currency=usd&ids=ethereum&sparkline=true&price_change_percentage=24h,7d", true);
      const eth = r?.[0];
      if (eth) {
        const pct = eth.price_change_percentage_24h;
        const color = pct >= 0 ? "#16c784" : "#ea3943";
        document.getElementById("eth-info").innerHTML = `<div class="big-coin-name">${eth.name}</div><div class="big-coin-price">${fmtUsd(eth.current_price)}</div><div class="${changeClass(pct)}" style="font-size:14px;font-weight:600">${fmtPct(pct)} (24h)</div><div class="big-coin-stats"><div><div class="big-coin-stat-label">Market Cap</div><div class="big-coin-stat-value">${fmtUsd(eth.market_cap)}</div></div><div><div class="big-coin-stat-label">24h Volume</div><div class="big-coin-stat-value">${fmtUsd(eth.total_volume)}</div></div><div><div class="big-coin-stat-label">7d Change</div><div class="big-coin-stat-value ${changeClass(eth.price_change_percentage_7d_in_currency)}">${fmtPct(eth.price_change_percentage_7d_in_currency)}</div></div><div><div class="big-coin-stat-label">ATH</div><div class="big-coin-stat-value">${fmtUsd(eth.ath)}</div></div></div><div style="margin-top:10px">${sparklineSvg(eth.sparkline_in_7d?.price, color)}</div>`;
      }
    } catch (e) { console.error("eth refresh", e); }
    btn.classList.remove("spinning");
  },
};

document.querySelectorAll(".section-refresh").forEach(btn => {
  btn.addEventListener("click", () => {
    const section = btn.getAttribute("data-refresh");
    const handler = refreshHandlers[section];
    if (handler) handler(btn);
  });
});
document.getElementById("chain-select")?.addEventListener("change", (e) => loadChainCoins(e.target.value));
setInterval(refreshAll, 5 * 60 * 1000);
setupYieldTabs();
setupNewsFilterTabs();
setupNewsScroll();
// Pre-fetch chain coins in background after 3s (don't compete with initial load)
setTimeout(preloadChainCoins, 3000);

// ─── Init ───
refreshAll();