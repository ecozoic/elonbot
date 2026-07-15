// Presentation helpers for Kalshi markets: the market card embed and the
// odds-over-time chart (rendered with node-canvas, same as the pokemon battle image).
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas } = require('canvas');

function fmtCloseTime(iso) {
    if (!iso) return 'unknown';
    return `${iso.replace('T', ' ').replace('Z', '')} UTC`;
}

// A market card: title, live YES/NO implied odds, volume, close time.
function buildMarketEmbed(market, { poolOpen = false } = {}) {
    const embed = new EmbedBuilder()
        .setColor('#00A0DC')
        .setTitle(market.title)
        .setDescription(
            `**YES** ${market.yesAskCents}¢  •  **NO** ${market.noAskCents}¢\n` +
            `Last traded: ${market.lastPriceCents}¢`
        )
        .addFields(
            { name: 'Ticker', value: `\`${market.ticker}\``, inline: true },
            { name: 'Volume', value: `${market.volume.toLocaleString()}`, inline: true },
            { name: 'Status', value: poolOpen ? '🟢 pool open' : market.status, inline: true },
            { name: 'Closes', value: fmtCloseTime(market.closeTime), inline: false }
        )
        .setFooter({ text: 'Fictional bets • real Kalshi odds' })
        .setTimestamp();
    return embed;
}

// Pull a timestamp (seconds) and a price (cents) out of one candlestick. The
// dollars-era API nests price stats; fall back across the shapes we might see.
function candlePoint(c) {
    const ts = c.end_period_ts ?? c.ts ?? null;
    const priceDollars =
        c.price?.mean_dollars ?? c.price?.close_dollars ??
        c.yes_ask?.close_dollars ?? c.price?.mean ?? c.price?.close ?? null;
    if (ts == null || priceDollars == null) return null;
    const cents = Math.round(parseFloat(priceDollars) * 100);
    if (!Number.isFinite(cents)) return null;
    return { ts, cents };
}

// Line chart of YES odds over time. Returns an AttachmentBuilder, or null if
// there isn't enough data to plot.
function renderOddsChart(candles, market) {
    const points = candles.map(candlePoint).filter(Boolean);
    if (points.length < 2) return null;

    const W = 800, H = 400, pad = 50;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    const xs = points.map((p) => p.ts);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const xSpan = maxX - minX || 1;
    // Y axis is fixed 0–100¢ (probability) so charts are comparable.
    const x = (ts) => pad + ((ts - minX) / xSpan) * (W - 2 * pad);
    const y = (cents) => H - pad - (cents / 100) * (H - 2 * pad);

    // gridlines + y labels at 0/25/50/75/100
    ctx.strokeStyle = '#30363d';
    ctx.fillStyle = '#8b949e';
    ctx.font = '14px sans-serif';
    ctx.lineWidth = 1;
    for (const c of [0, 25, 50, 75, 100]) {
        ctx.beginPath();
        ctx.moveTo(pad, y(c));
        ctx.lineTo(W - pad, y(c));
        ctx.stroke();
        ctx.fillText(`${c}¢`, 8, y(c) + 5);
    }

    // the odds line
    ctx.strokeStyle = '#00A0DC';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((p, i) => {
        const px = x(p.ts), py = y(p.cents);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // title + current value
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 16px sans-serif';
    const title = market.title.length > 70 ? market.title.slice(0, 67) + '…' : market.title;
    ctx.fillText(title, pad, 28);
    ctx.fillStyle = '#00A0DC';
    ctx.fillText(`YES now: ${points[points.length - 1].cents}¢`, pad, H - 16);

    return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'odds-chart.png' });
}

module.exports = { buildMarketEmbed, renderOddsChart };
