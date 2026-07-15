// Fictional betting on real Kalshi outcomes. Fake `coins` only.
//
// Coins live on the same users/{id} doc as the pokemon game (merged, never
// clobbered). Bets are placed at Kalshi's live price (snapshotted), against
// infinite fake "house" liquidity — no peer matching. When a market settles,
// resolvePools() pays out idempotently.

const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('./firebase.js');
const kalshi = require('./kalshi.js');

const STARTING_BALANCE = 1000;
const DAILY_REGEN = 100;
const MAX_REGEN_DAYS = 7; // cap unclaimed accrual so it can't balloon
const DAY_MS = 24 * 3600 * 1000;
const OWNER_ID = '179704343619043328';

// --- balances & daily regen ---------------------------------------------------

// Pure helper: given a user's current doc data (or null for a brand-new user)
// and `now`, compute their regen'd coin balance and new lastRegenTs. Advances
// the clock by the FULL elapsed days so we never double-grant, even though the
// grant itself is capped at MAX_REGEN_DAYS. `changed` says whether a write is
// needed. Must be called INSIDE a transaction so the read+write is atomic.
function computeRegen(data, now) {
    if (!data || data.coins == null) {
        return { coins: STARTING_BALANCE, lastRegenTs: now, changed: true };
    }
    const last = data.lastRegenTs || now;
    const elapsedDays = Math.floor((now - last) / DAY_MS);
    if (elapsedDays >= 1) {
        const grant = Math.min(elapsedDays, MAX_REGEN_DAYS) * DAILY_REGEN;
        return { coins: data.coins + grant, lastRegenTs: last + elapsedDays * DAY_MS, changed: true };
    }
    return { coins: data.coins, lastRegenTs: last, changed: false };
}

// Ensure a user has a coins balance, then lazily grant daily regen atomically.
// Returns the user's current coin balance. Uses merge so pokemon fields are
// never touched.
async function getBalance(userId) {
    const userRef = db.collection('users').doc(userId);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const r = computeRegen(snap.exists ? snap.data() : null, now);
        if (r.changed) {
            tx.set(userRef, { coins: r.coins, lastRegenTs: r.lastRegenTs }, { merge: true });
        }
        return r.coins;
    });
}

// --- pools --------------------------------------------------------------------

async function createPool(ticker, { createdBy, channelId }) {
    if (createdBy !== OWNER_ID) {
        return { error: 'Only the owner can create betting pools.' };
    }
    ticker = ticker.trim().toUpperCase();

    const existing = await db.collection('pools').doc(ticker).get();
    if (existing.exists && !existing.data().resolved) {
        return { error: `A pool for \`${ticker}\` is already open.` };
    }

    const market = await kalshi.getMarket(ticker);
    if (!market) return { error: `No Kalshi market found for \`${ticker}\`.` };
    if (market.resolved) return { error: `Market \`${ticker}\` has already resolved.` };
    if (market.status !== 'active') {
        return { error: `Market \`${ticker}\` is not open for betting (status: ${market.status}).` };
    }

    // series_ticker (needed for candlestick charts) lives on the event.
    let seriesTicker = null;
    try {
        const event = await kalshi.getEvent(market.eventTicker);
        seriesTicker = event?.series_ticker || null;
    } catch (_) { /* charts just won't work; not fatal */ }

    const pool = {
        ticker: market.ticker,
        eventTicker: market.eventTicker,
        seriesTicker,
        title: market.title,
        yesSubTitle: market.yesSubTitle,
        noSubTitle: market.noSubTitle,
        status: market.status,
        createdBy,
        channelId,
        resolved: false,
        result: null,
        createdTs: Date.now(),
    };
    await db.collection('pools').doc(market.ticker).set(pool);
    return { pool, market };
}

async function listPools() {
    const snap = await db.collection('pools').where('resolved', '==', false).get();
    return snap.docs.map((d) => d.data());
}

async function getPool(ticker) {
    const doc = await db.collection('pools').doc(ticker.trim().toUpperCase()).get();
    return doc.exists ? doc.data() : null;
}

// --- betting ------------------------------------------------------------------

async function placeBet(userId, ticker, side, amount) {
    ticker = ticker.trim().toUpperCase();
    side = side.trim().toLowerCase();

    if (side !== 'yes' && side !== 'no') {
        return { error: 'Side must be `yes` or `no`.' };
    }
    if (!Number.isInteger(amount) || amount <= 0) {
        return { error: 'Bet amount must be a positive whole number of coins.' };
    }

    const pool = await getPool(ticker);
    if (!pool) return { error: `No open pool for \`${ticker}\`. Ask the owner to \`/pool create ${ticker}\`.` };
    if (pool.resolved) return { error: `That market has already resolved.` };

    // Live price snapshot at bet time.
    const market = await kalshi.getMarket(ticker);
    if (!market || market.resolved || market.status !== 'active') {
        return { error: `Market \`${ticker}\` is no longer open for betting.` };
    }
    const priceCents = side === 'yes' ? market.yesAskCents : market.noAskCents;
    if (priceCents <= 0 || priceCents >= 100) {
        return { error: `No tradable ${side.toUpperCase()} price right now (${priceCents}¢). Try the other side or wait.` };
    }

    // contracts each cost `priceCents` and pay 100 on a win.
    const contracts = amount / priceCents;
    const potentialPayout = Math.round((amount * 100) / priceCents);

    const bet = {
        poolTicker: ticker,
        userId,
        side,
        entryPriceCents: priceCents,
        contracts,
        wager: { type: 'coins', amount },
        potentialPayout,
        status: 'open',
        createdTs: Date.now(),
    };

    // Apply daily regen, guard against overspend, deduct the stake, and record
    // the bet — ALL in one transaction so we can never deduct coins without a
    // matching bet doc, and never bet against a stale (pre-regen) balance.
    const userRef = db.collection('users').doc(userId);
    const betRef = db.collection('bets').doc();
    const now = Date.now();
    let balanceAfter;
    try {
        balanceAfter = await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            const r = computeRegen(snap.exists ? snap.data() : null, now);
            if (r.coins < amount) {
                throw new Error(`INSUFFICIENT:${r.coins}`);
            }
            tx.set(userRef, { coins: r.coins - amount, lastRegenTs: r.lastRegenTs }, { merge: true });
            tx.set(betRef, bet);
            return r.coins - amount;
        });
    } catch (e) {
        if (String(e.message).startsWith('INSUFFICIENT:')) {
            const have = e.message.split(':')[1];
            return { error: `Not enough coins — you have ${have}, tried to bet ${amount}. \`/balance\` to check.` };
        }
        throw e;
    }

    return { bet, market, balanceAfter, priceCents, potentialPayout };
}

// --- leaderboard & positions --------------------------------------------------

// orderBy('coins') implicitly excludes users who have never touched betting
// (no coins field), which is exactly what we want.
async function getBalanceLeaderboard(limit = 10) {
    const snap = await db.collection('users').orderBy('coins', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ userId: d.id, coins: d.data().coins }));
}

async function getUserPositions(userId) {
    const snap = await db.collection('bets').where('userId', '==', userId).get();
    return snap.docs.map((d) => d.data()).filter((b) => b.status === 'open');
}

// --- resolution ---------------------------------------------------------------

// Poll every unresolved pool; settle any whose market has finalized. Idempotent:
// only bets still marked 'open' are paid, and each pool is flipped to resolved so
// it's skipped next tick. Returns per-pool summaries for the bot to announce.
async function resolvePools() {
    const pools = await listPools();
    const summaries = [];

    for (const pool of pools) {
        let market;
        try {
            market = await kalshi.getMarket(pool.ticker);
        } catch (e) {
            console.error(`resolvePools: failed to fetch ${pool.ticker}: ${e.message}`);
            continue;
        }
        if (!market || !market.resolved) continue;

        const result = market.result; // 'yes' | 'no' | null (void -> refund)
        const betsSnap = await db.collection('bets').where('poolTicker', '==', pool.ticker).get();
        const settlements = [];

        for (const betDoc of betsSnap.docs) {
            const bet = betDoc.data();
            if (bet.status !== 'open') continue;

            let outcome, delta;
            if (result === null) {
                outcome = 'refunded';
                delta = bet.wager.amount; // give the stake back
            } else if (bet.side === result) {
                outcome = 'won';
                delta = bet.potentialPayout;
            } else {
                outcome = 'lost';
                delta = 0;
            }

            // Idempotent per-bet: re-check 'open' inside the transaction.
            await db.runTransaction(async (tx) => {
                const fresh = await tx.get(betDoc.ref);
                if (!fresh.exists || fresh.data().status !== 'open') return;
                tx.update(betDoc.ref, { status: outcome, settledTs: Date.now() });
                if (delta > 0) {
                    tx.set(db.collection('users').doc(bet.userId), { coins: FieldValue.increment(delta) }, { merge: true });
                }
            });

            settlements.push({ userId: bet.userId, side: bet.side, outcome, delta, stake: bet.wager.amount });
        }

        await db.collection('pools').doc(pool.ticker).update({ resolved: true, result: result ?? 'void', status: market.status });
        summaries.push({ pool, market, result, settlements });
    }

    return summaries;
}

module.exports = {
    OWNER_ID,
    STARTING_BALANCE,
    getBalance,
    createPool,
    listPools,
    getPool,
    placeBet,
    getBalanceLeaderboard,
    getUserPositions,
    resolvePools,
};
