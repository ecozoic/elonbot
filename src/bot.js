require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  AttachmentBuilder,
} = require("discord.js");
const crypto = require("crypto");
const { imagine, answerQuestion } = require("./ai.js");
const { getPokemonStats, handlePokemonGame, getPokemonLeaderboard, queryPokemon } = require("./pokemon.js");

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
        if (isNaN(maybePokemonId) || maybePokemonId <= 0 || maybePokemonId > 151) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send(`<@${message.author.id}> - ${maybePokemonId} is invalid`));
          return;
        }
        const response = await queryPokemon(message.author.id, maybePokemonId);
        if (response != null) {
          client.channels.fetch(message.channelId)
            .then((channel) => channel.send(`<@${message.author.id}> - ${response}`));
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

client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.login(token);
