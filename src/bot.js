require('dotenv').config();

const {Client, Events, GatewayIntentBits} = require('discord.js');

const token = process.env.BOT_TOKEN;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.on(Events.MessageCreate, async message => {
    if (message.content.startsWith('https://twitter.com') || message.content.startsWith('https://x.com')) {
        client.channels
            .fetch(message.channelId)
            .then(channel => channel.send(message.content.replace('twitter.com', 'fxtwitter.com').replace('x.com', 'fxtwitter.com')));
    } else if (message.content.startsWith('can you believe that shit')) {
        client.channels
            .fetch(message.channelId)
            .then(channel => channel.send("shit's fucked"));
    }
});

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.login(token);
