require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  AttachmentBuilder,
} = require("discord.js");
const crypto = require("crypto");
const { imagine } = require("./ai.js");

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
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.login(token);
