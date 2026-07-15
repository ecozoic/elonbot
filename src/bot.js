require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder,
} = require("discord.js");
const crypto = require("crypto");
const { imagine, answerQuestion } = require("./ai.js");
const { getPokemonStats, handlePokemonGame, getPokemonLeaderboard, queryPokemon, debugPokemon, doPokemonBattle, MAX_POKEMON_ID } = require("./pokemon.js");
const betting = require("./betting.js");
const kalshi = require("./kalshi.js");
const { buildMarketEmbed, renderOddsChart } = require("./kalshi-display.js");

const token = process.env.BOT_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const ENABLE_FX_TWITTER = true;
const ENABLE_DREAM = true;
const POKEMON_THREAD_ID = '1364333853220667484';
const RESOLVE_INTERVAL_MS = 5 * 60 * 1000; // poll Kalshi for settlements every 5 min

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

client.on(Events.MessageCreate, async (message) => {
  if (
    ENABLE_FX_TWITTER &&
    (message.content.includes("https://twitter.com") ||
      message.content.includes("https://x.com"))
  ) {
    client.channels.fetch(message.channelId).then((channel) =>
      channel
        .send(
          `<@${message.author.id}> - ${message.content
            .replace("twitter.com", "fxtwitter.com")
            .replace("x.com", "fxtwitter.com")}`
        )
        .then(() => {
          message.delete();
        })
    );
  } else if (message.content.startsWith("can you believe that shit")) {
    client.channels
      .fetch(message.channelId)
      .then((channel) => channel.send("shit's fucked"));
  } else if (ENABLE_DREAM && message.content.startsWith("/dream")) {
    const prompt = message.content.substring(7);
    try {
      const b64 = await imagine(prompt);
      const buffer = new Buffer.from(b64, "base64");
      const attach = new AttachmentBuilder(buffer, {
        name: `dream-${crypto.randomUUID()}.png`,
      });
      client.channels
        .fetch(message.channelId)
        .then((channel) => channel.send({ files: [attach] }));
    } catch (err) {
      client.channels
        .fetch(message.channelId)
        .then((channel) => channel.send(err.message));
    }
  }  else if (message.content.toLowerCase().startsWith("hey elon")) {
    try {
      await client.channels
        .fetch(message.channelId)
        .then((channel) => channel.sendTyping());
      const response = await answerQuestion(message.content.substring(10));
      if (response != null) {
        client.channels.fetch(message.channelId)
          .then((channel) => channel.send(response));
      }
    } catch (err) {
        client.channels
          .fetch(message.channelId)
          .then((channel) => channel.send(err.message));
    }
  } else if (await handleBettingCommand(message)) {
    // Kalshi betting / help commands — work in any channel. Handled above.
  } else if (
    message.channel.isThread() &&
    message.channelId === POKEMON_THREAD_ID &&
    !message.author.bot
  ) {
    try {
      if (message.content.startsWith("/pokemon leaderboard")) {
        const response = await getPokemonLeaderboard();
        if (response != null) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send(response));
        }
      } else if (message.content.startsWith("/pokemon count")) {
        const maybePokemonId = parseInt(message.content.slice(15), 10);
        if (isNaN(maybePokemonId) || maybePokemonId <= 0 || maybePokemonId > MAX_POKEMON_ID) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send(`<@${message.author.id}> - ${maybePokemonId} is invalid`));
          return;
        }
        const response = await queryPokemon(message.author.id, maybePokemonId);
        if (response != null) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send(`<@${message.author.id}> - ${response}`));
        }
      } else if (message.content.startsWith("/pokemon debug") && message.author.id === '179704343619043328') {
        const [displayName, pokemonIndex, isShiny] = message.content.slice(15).split(',');
        const embed = await debugPokemon(displayName, pokemonIndex, isShiny === 'shiny');
        if (embed != null) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send({ embeds: [embed] }));
        }
      } else if (message.content.startsWith("/pokemon battle")) {
        if (message.mentions.users.size === 0) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send('Must specify an opponent'));
        } else if (message.mentions.users.size > 1) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send('Must specify one opponent'));
        } else {
          const opponent = message.mentions.users.first();
          if (opponent.id === message.author.id) {
            client.channels.fetch(message.channelId)
            .then((channel) => channel.send('Cannot battle yourself'));
          } else {
            const {response, embed, attachment} = await doPokemonBattle({id: message.author.id, displayName: message.author.displayName}, {id: opponent.id, displayName: opponent.displayName });
            if (embed != null && attachment != null && response != null) {
              client.channels.fetch(message.channelId)
                .then((channel) => channel.send({ embeds: [embed], files: [attachment] }));
              await delay(1000);
              client.channels.fetch(message.channelId)
                .then((channel) => channel.send(response));
            }
          }
        }
      } else if (message.content.startsWith("/pokemon")) {
        const response = await getPokemonStats(message.author.id);
        if (response != null) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send(`<@${message.author.id}> - ${response}`));
        }
      } else {
        const embed = await handlePokemonGame(message.author.id, message.author.displayName);
        if (embed != null) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send({ embeds: [embed] }));
        }
      }
    } catch (err) {
      client.channels
        .fetch(message.channelId)
        .then((channel) => channel.send(err.message));
    }
  }
});

// ---- Kalshi betting command routing -----------------------------------------

// Returns true if the message was a betting/kalshi/help command (and was handled),
// false otherwise so the pokemon handler can take over. Works in ANY channel.
async function handleBettingCommand(message) {
  if (message.author.bot) return false;
  const parts = message.content.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const userId = message.author.id;

  const handlers = {
    "/help": () => sendHelp(message.channel),
    "/balance": () => sendBalance(message, userId),
    "/leaderboard": () => sendLeaderboard(message.channel),
    "/bet": () => handleBet(message, userId, args),
    "/pool": () => handlePool(message, userId, args),
    "/kalshi": () => handleKalshi(message, args),
  };

  const handler = handlers[cmd];
  if (!handler) return false;

  try {
    await handler();
  } catch (err) {
    console.error(`betting command '${cmd}' failed:`, err);
    await message.channel.send(`⚠️ ${err.message}`);
  }
  return true;
}

function medal(i) {
  return ["🥇", "🥈", "🥉"][i] || "▫️";
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function sendBalance(message, userId) {
  const coins = await betting.getBalance(userId);
  const positions = await betting.getUserPositions(userId);
  let desc = `**${coins}** 🪙`;
  if (positions.length) {
    desc += "\n\n**Open bets:**\n" + positions
      .map((p) => `• ${p.wager.amount} on **${p.side.toUpperCase()}** @ ${p.entryPriceCents}¢ — \`${p.poolTicker}\` (payout ${p.potentialPayout})`)
      .join("\n");
  }
  const embed = new EmbedBuilder()
    .setColor("#F1C40F")
    .setTitle(`${message.author.displayName}'s balance`)
    .setDescription(desc);
  await message.channel.send({ embeds: [embed] });
}

async function sendLeaderboard(channel) {
  const rows = await betting.getBalanceLeaderboard(10);
  if (!rows.length) {
    await channel.send("No one has any coins yet. Start betting with `/bet`!");
    return;
  }
  const body = rows
    .map((r, i) => `${medal(i)} <@${r.userId}> — ${r.coins} 🪙`)
    .join("\n");
  const embed = new EmbedBuilder()
    .setColor("#F1C40F")
    .setTitle("💰 Coin Leaderboard")
    .setDescription(body);
  await channel.send({ embeds: [embed] });
}

async function handleBet(message, userId, args) {
  if (args.length < 3) {
    await message.channel.send("Usage: `/bet <ticker> <yes|no> <coins>`");
    return;
  }
  const [ticker, side, amountStr] = args;
  const amount = parseInt(amountStr, 10);
  const res = await betting.placeBet(userId, ticker, side, amount);
  if (res.error) {
    await message.channel.send(`❌ ${res.error}`);
    return;
  }
  const profit = res.potentialPayout - res.bet.wager.amount;
  await message.channel.send(
    `✅ <@${userId}> bet **${res.bet.wager.amount}** 🪙 on **${res.bet.side.toUpperCase()}** @ ${res.priceCents}¢\n` +
    `_${truncate(res.market.title, 100)}_\n` +
    `Potential payout: **${res.potentialPayout}** 🪙 (profit +${profit})\n` +
    `New balance: **${res.balanceAfter}** 🪙`
  );
}

async function handlePool(message, userId, args) {
  const sub = (args[0] || "").toLowerCase();
  if (sub === "create") {
    const ticker = args[1];
    if (!ticker) {
      await message.channel.send("Usage: `/pool create <ticker>`");
      return;
    }
    const res = await betting.createPool(ticker, { createdBy: userId, channelId: message.channelId });
    if (res.error) {
      await message.channel.send(`❌ ${res.error}`);
      return;
    }
    const embed = buildMarketEmbed(res.market, { poolOpen: true });
    const sent = await message.channel.send({
      content: `🎲 **Betting is open!** Place bets with \`/bet ${res.market.ticker} yes|no <coins>\``,
      embeds: [embed],
    });
    try {
      await require("./firebase.js").db.collection("pools").doc(res.market.ticker).update({ messageId: sent.id });
    } catch (_) { /* messageId is best-effort */ }
  } else if (sub === "list") {
    const pools = await betting.listPools();
    if (!pools.length) {
      await message.channel.send("No open betting pools right now.");
      return;
    }
    const body = pools
      .map((p) => `• \`${p.ticker}\` — ${truncate(p.title, 80)}`)
      .join("\n");
    const embed = new EmbedBuilder()
      .setColor("#00A0DC")
      .setTitle("🎲 Open Betting Pools")
      .setDescription(body);
    await message.channel.send({ embeds: [embed] });
  } else {
    await message.channel.send("Usage: `/pool create <ticker>` or `/pool list`");
  }
}

async function handleKalshi(message, args) {
  const sub = (args[0] || "").toLowerCase();
  if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      await message.channel.send("Usage: `/kalshi search <query>`");
      return;
    }
    const markets = await kalshi.searchMarkets(query);
    if (!markets.length) {
      await message.channel.send(`No open markets match "${query}".`);
      return;
    }
    const body = markets
      .map((m) => `• \`${m.ticker}\` — ${truncate(m.title, 60)} — YES ${m.yesAskCents}¢`)
      .join("\n");
    const embed = new EmbedBuilder()
      .setColor("#00A0DC")
      .setTitle(`🔎 Results for "${query}"`)
      .setDescription(body)
      .setFooter({ text: "Bet with /bet <ticker> yes|no <coins>" });
    await message.channel.send({ embeds: [embed] });
  } else if (sub === "market") {
    const ticker = args[1];
    if (!ticker) {
      await message.channel.send("Usage: `/kalshi market <ticker>`");
      return;
    }
    const market = await kalshi.getMarket(ticker.toUpperCase());
    if (!market) {
      await message.channel.send(`No Kalshi market found for \`${ticker}\`.`);
      return;
    }
    const pool = await betting.getPool(ticker);
    await message.channel.send({ embeds: [buildMarketEmbed(market, { poolOpen: pool && !pool.resolved })] });
  } else if (sub === "chart") {
    const ticker = (args[1] || "").toUpperCase();
    if (!ticker) {
      await message.channel.send("Usage: `/kalshi chart <ticker>`");
      return;
    }
    const market = await kalshi.getMarket(ticker);
    if (!market) {
      await message.channel.send(`No Kalshi market found for \`${ticker}\`.`);
      return;
    }
    const pool = await betting.getPool(ticker);
    let seriesTicker = pool?.seriesTicker;
    if (!seriesTicker) {
      const event = await kalshi.getEvent(market.eventTicker);
      seriesTicker = event?.series_ticker;
    }
    if (!seriesTicker) {
      await message.channel.send("Couldn't determine the series for this market, so I can't chart it.");
      return;
    }
    const candles = await kalshi.getCandlesticks(seriesTicker, ticker, { periodInterval: 60 });
    const attachment = renderOddsChart(candles, market);
    if (!attachment) {
      await message.channel.send("Not enough price history to chart this market yet.");
      return;
    }
    await message.channel.send({ content: `📈 **${truncate(market.title, 100)}**`, files: [attachment] });
  } else {
    await message.channel.send("Usage: `/kalshi search|market|chart ...`");
  }
}

async function sendHelp(channel) {
  const embed = new EmbedBuilder()
    .setColor("#FF0000")
    .setTitle("🤖 elonbot — command guide")
    .setDescription("Everything elonbot can do.")
    .addFields(
      {
        name: "✨ General",
        value:
          "• Paste a `twitter.com`/`x.com` link → auto-rewritten to fxtwitter\n" +
          "• `/dream <prompt>` — generate an AI image\n" +
          "• `hey elon <question>` — ask the bot anything",
      },
      {
        name: "🔴 Pokémon (in the Pokémon thread)",
        value:
          "• Chat in the thread for a chance to catch a Pokémon\n" +
          "• `/pokemon` — your caught count\n" +
          "• `/pokemon count <id>` — have you caught #id?\n" +
          "• `/pokemon leaderboard` — top collectors\n" +
          "• `/pokemon battle @user` — quick battle",
      },
      {
        name: "🎲 Kalshi betting (any channel)",
        value:
          "• `/kalshi search <query>` — find markets to bet on\n" +
          "• `/kalshi market <ticker>` — live odds card\n" +
          "• `/kalshi chart <ticker>` — odds over time\n" +
          "• `/pool create <ticker>` — open a pool *(owner only)*\n" +
          "• `/pool list` — open pools\n" +
          "• `/bet <ticker> <yes|no> <coins>` — bet at live odds\n" +
          "• `/balance` — your coins + open bets\n" +
          "• `/leaderboard` — richest players",
      },
      {
        name: "💡 How betting works",
        value:
          "Start with **1000** 🪙, +100/day. Buy YES/NO at the live Kalshi price " +
          "(in ¢). A contract costs its price and pays 100 if it wins — so YES @ 40¢ " +
          "means risk 40 to win 100. Bets settle automatically when the real market resolves.",
      }
    );
  await channel.send({ embeds: [embed] });
}

// ---- settlement loop --------------------------------------------------------

async function resolveAndAnnounce() {
  let summaries;
  try {
    summaries = await betting.resolvePools();
  } catch (err) {
    console.error("resolvePools failed:", err);
    return;
  }
  for (const s of summaries) {
    if (!s.settlements.length) continue;
    try {
      const channel = await client.channels.fetch(s.pool.channelId);
      const resultLabel = s.result ? s.result.toUpperCase() : "VOID — stakes refunded";
      const lines = s.settlements.map((x) => {
        if (x.outcome === "won") return `<@${x.userId}> won **+${x.delta}** 🪙`;
        if (x.outcome === "refunded") return `<@${x.userId}> refunded ${x.delta} 🪙`;
        return `<@${x.userId}> lost ${x.stake} 🪙`;
      });
      await channel.send(
        `🏁 **Market resolved:** ${truncate(s.pool.title, 150)}\n` +
        `Outcome: **${resultLabel}**\n${lines.join("\n")}`
      );
    } catch (err) {
      console.error(`announce failed for ${s.pool.ticker}:`, err);
    }
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  // Catch up on anything that settled while we were down, then poll on a timer.
  resolveAndAnnounce();
  setInterval(resolveAndAnnounce, RESOLVE_INTERVAL_MS);
});

client.login(token);
