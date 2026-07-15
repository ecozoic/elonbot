# Kalshi Fictional Betting — Implementation Plan

Fake-currency betting layer on top of **real Kalshi market outcomes**. No real money, no
trading, no Kalshi account. We only *read* public market data and resolve fake bets when a
market settles.

## Decisions (locked)

- **Currency:** fake `coins`. Start balance **1000**, **+100/day** accrued lazily, capped at
  **7 days** (700) of unclaimed accrual so it can't balloon.
- **Odds:** real Kalshi odds, **price snapshotted at bet time**. You bet against infinite fake
  "house" liquidity — no peer matching.
- **Wager abstraction:** every bet stores `wager: { type: 'coins', amount }` so pokemon staking
  can drop in later without a schema change.
- **Scope:** betting commands work in **any channel** the bot is in. Pokemon game stays
  thread-locked (unchanged).
- **Pool creation restricted** to owner id `179704343619043328` (same gate as `/pokemon debug`).
- **Cron:** in-process `setInterval` in the already-running Fly bot process. Idempotent
  settlement + catch-up-on-boot. No separate Fly machine.

## Betting mechanic

- Prices are quoted in dollars 0.00–1.00 (= probability). Convert to **cents** (1–99) for display
  and math: `cents = round(price_dollars * 100)`.
- Bet: user stakes `S` coins on `yes` or `no` at current side price `P` cents.
  - contracts = `S / P` (fractional ok internally; display rounded)
  - potential payout = `round(S * 100 / P)` coins (each contract pays 100 if it wins)
  - profit if win = `payout - S`; loss if lose = `S` (already deducted at bet time)
- Example: stake 40 on YES at 40¢ → payout 100 (profit 60). Stake 400 at 40¢ → payout 1000.

## Verified Kalshi API (public, no auth)

Base: `https://external-api.kalshi.com/trade-api/v2`. ~30 req/s. Send `Accept: application/json`.

- `GET /events?status=open&limit=&cursor=` → `{ events:[{event_ticker, series_ticker, title,
  sub_title, category}], cursor }`. Used for **search** (client-side substring on title/sub_title;
  filter out multivariate `KXMV*` combos).
- `GET /markets?event_ticker=&status=&limit=&cursor=` → `{ markets:[...], cursor }`
- `GET /markets/{ticker}` → `{ market: {...} }` — single market
- `GET /series/{series_ticker}/markets/{ticker}/candlesticks?start_ts=&end_ts=&period_interval=`
  (`period_interval` ∈ {1,60,1440} min) → `{ candlesticks:[...] }` for the odds-over-time chart.

**Market object fields (prices are DOLLAR STRINGS, not cents):**
`ticker`, `event_ticker`, `title`, `yes_sub_title`, `no_sub_title`, `status`, `result`,
`close_time`, `expiration_time`, `volume_fp`,
`yes_ask_dollars`, `yes_bid_dollars`, `no_ask_dollars`, `no_bid_dollars`, `last_price_dollars`.

- `status`: `active` (tradable), `finalized`/`settled` (resolved), also `unopened`/`closed`.
- `result`: `""` while unresolved; `"yes"` / `"no"` once resolved. Anything else on a resolved
  market (e.g. void) → **refund** stakes.
- To buy a side use its **ask**: YES uses `yes_ask_dollars`, NO uses `no_ask_dollars`.
- `series_ticker` lives on the event; fetch `/events/{event_ticker}` at pool-create and store it
  (needed for candlesticks).

## Files

- `src/firebase.js` — extract shared Firestore init (`db`). Refactor `pokemon.js` to import it so
  both modules share ONE `initializeApp` (double-init currently avoided only by luck).
- `src/kalshi.js` — API client: `searchEvents(query)`, `getMarket(ticker)`, `getEvent(ticker)`,
  `getCandlesticks(seriesTicker, ticker, periodInterval)`. Parses `_dollars`/`_fp` strings → numbers.
- `src/betting.js` — `getBalance`, `applyDailyRegen`, `createPool`, `listPools`, `placeBet`,
  `getBalanceLeaderboard`, `resolvePools`. Uses `firebase.js`.
- `src/bot.js` — route new commands in ALL channels; start resolver interval + boot catch-up.

## Firestore schema

- `users/{id}`: add `coins` (number), `lastRegenTs` (ms). Existing pokemon fields untouched.
- `pools/{ticker}`: `ticker`, `eventTicker`, `seriesTicker`, `title`, `status`, `createdBy`,
  `channelId`, `messageId`, `resolved` (bool), `result`, `createdTs`.
- `bets/{autoId}`: `poolTicker`, `userId`, `side` (`yes`/`no`), `entryPriceCents`, `contracts`,
  `wager: {type:'coins', amount}`, `potentialPayout`, `status` (`open`/`won`/`lost`/`refunded`),
  `settledTs`.

## Commands

- `/kalshi search <query>` — top open-market matches with tickers (anyone)
- `/kalshi market <ticker>` — card: title, YES/NO %, volume, close time, status (anyone)
- `/kalshi chart <ticker>` — canvas line chart of odds over time (anyone)
- `/pool create <ticker>` — **owner only**; opens a pool, posts a card
- `/pool list` — active pools (anyone)
- `/bet <ticker> <yes|no> <coins>` — bet at live odds (anyone)
- `/balance` — coins + open positions (anyone)
- `/leaderboard` — top coin balances (anyone, all channels)

## Resolution loop

`setInterval` (~5 min) + once on boot: for each unresolved pool → `getMarket` → if resolved,
settle its open bets idempotently (only bets with `status:'open'`), credit payouts / refunds,
mark pool resolved, post a result summary to the pool's channel.
