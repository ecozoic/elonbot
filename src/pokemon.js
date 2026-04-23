const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const {createCanvas, loadImage} = require('canvas');
const { getFirestore } = require("firebase-admin/firestore");
const admin = require('firebase-admin');

const TYPE_CHART = require('./pokemon-type-chart.js');

const jsonString = Buffer.from(
    process.env.FIREBASE_CREDENTIALS_BASE64,
    'base64'
).toString('utf8');
const credential = admin.credential.cert(JSON.parse(jsonString));
const app = admin.initializeApp({
    credential,
});
const db = getFirestore(app);

const POKEMON_CATCH_RATE = 0.20;
const SHINY_CATCH_RATE = 0.05;
const POKEMON_CATCH_ICD = 5; // seconds
const COOLDOWNS = new Map(); // userID -> timestamp when cooldown ends

async function handlePokemonGame(authorId, displayName) {
    const docRef = db.collection("users").doc(authorId);
    let doc = await docRef.get();
    if (!doc.exists) {
        console.log(`No entry for ${authorId}, initializing DB...`);
        await initializeDB(authorId, docRef);
        doc = await docRef.get();
    }
    if (!shouldCatch(authorId)) {
        console.log(`No catch for ${authorId}`);
        return null;
    }
    console.log(`Catching pokemon for ${authorId}`);
    const indexToFlip = Math.floor(Math.random() * 151);
    console.log(`index for ${authorId}: ${indexToFlip}`);
    const pokemonToCatch = indexToFlip + 1;
    console.log(`pokemon number for ${authorId}: ${pokemonToCatch}`);
    const data = doc.data().pokemon;
    console.log(`Encoded data for ${authorId}: ${data}`);
    const bitArray = compactStringToBooleans(data);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    if (bitArray[indexToFlip] === 0) {
        console.log(`Flipping value at ${indexToFlip} for ${authorId}`);
        bitArray[indexToFlip] = 1;
        console.log(`New decoded data for ${authorId}: ${bitArray}`);
        const encoded = booleansToCompactString(bitArray);
        console.log(`New Encoded data for ${authorId}: ${data}`);
        await docRef.update({
            pokemon: encoded,
        });
    }
    const pokemon = await getPokemon(pokemonToCatch);
    console.log('pokemon', pokemon);
    return getEmbed(displayName, pokemon);
}

function getEmbed(displayName, pokemon) {
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(pokemon.shiny ? `${displayName} caught 🌟 SHINY 🌟 ${pokemon.name}!` : `${displayName} caught ${pokemon.name}!`)
        .setDescription(`Type: ${pokemon.types.map(t => t.type.name).join(', ')}`)
        .setImage(pokemon.picture)
        .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png')
        .setFooter({ text: 'Powered by PokéAPI' })
        .setTimestamp();
    return embed;
}

async function getPokemonStats(authorId) {
    const bitArray = await getPokemonForUser(authorId);
    if (bitArray == null) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const count = bitArray.filter(x => x !== 0).length;
    console.log(`Caught count for ${authorId}: ${count}`);
    if (count === 151) {
        return "You've caught them all. You are the very best, like no one ever was!";
    }
    return `You've caught ${count} Pokémon`;
}

async function getPokemonForUser(userId) {
    console.log(`Query for userId ${userId}`);
    const docRef = db.collection("users").doc(userId);
    const doc = await docRef.get();;
    if (!doc.exists) {
        return null;
    }
    const data = doc.data().pokemon;
    console.log(`Encoded data for ${userId}: ${data}`);
    const bitArray = compactStringToBooleans(data);
    console.log(`Decoded data for ${userId}: ${bitArray}`);
    return bitArray;
}

function shouldCatch(authorId) {
    const rng = Math.random();
    console.log(`rng: ${rng}, rate: ${POKEMON_CATCH_RATE}`);
    if (rng >= POKEMON_CATCH_RATE) {
        console.log(`bad luck ${authorId}`);
        return false;
    }
    const now = Date.now();
    const cooldownMs = POKEMON_CATCH_ICD * 1000;
    const cooldownEnd = COOLDOWNS.get(authorId);
    if (cooldownEnd && now < cooldownEnd) {
        const remaining = Math.ceil((cooldownEnd - now) / 1000);
        console.log(`${authorId} is on cooldown for ${remaining} more seconds`);
        return false;
    }
    COOLDOWNS.set(authorId, now + cooldownMs);
    return true;
}

async function initializeDB(authorId, docRef) {
    const bitArray = Array(151).fill(0);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    const data = booleansToCompactString(bitArray);
    console.log(`Encoded data for ${authorId}: ${data}`);
    await docRef.set({
        pokemon: data,
    });
}

function booleansToCompactString(flags) {
    const bitCount = flags.length;
    const byteCount = Math.ceil(bitCount / 8);
    const bytes = new Uint8Array(byteCount);

    for (let i = 0; i < bitCount; i++) {
        if (flags[i]) {
            const byteIndex = Math.floor(i / 8);
            const bitIndex  = 7 - (i % 8);
            bytes[byteIndex] |= (1 << bitIndex);
        }
    }

    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function compactStringToBooleans(base64url, expectedLength = 151) {
    let base64 = base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    
    while (base64.length % 4 !== 0) {
        base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    const flags = new Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex  = 7 - (i % 8);
        flags[i] = (bytes[byteIndex] & (1 << bitIndex)) === 0 ? 0 : 1;
    }

    return flags;
}

async function getPokemon(id, shinyOverride = false) {
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}/`);
    if (!response.ok) throw new Error('Pokémon not found');
    
    const data = await response.json();
    let isShiny = false;
    const rng = Math.random();
    if (rng <= SHINY_CATCH_RATE || shinyOverride) {
        console.log(`SHINY!`);
        isShiny = true;
    }
    
    return {
      name: data.name.charAt(0).toUpperCase() + data.name.slice(1),  // Capitalize
      id: data.id,
      types: data.types,
      picture: isShiny ?
        (data.sprites.other?.official_artwork?.front_shiny || data.sprites.front_shiny) :
        (data.sprites.other?.official_artwork?.front_default || data.sprites.front_default),
      shiny: isShiny,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getPokemonLeaderboard() {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();
    let results = snapshot.docs.map(doc => ({
        authorId: doc.id,
        score: compactStringToBooleans(doc.data().pokemon).filter(x => x !== 0).length
    }));
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, 11);
    return results.map((result, idx) => `${getEmoji(idx)}<@${result.authorId}> - ${result.score} Pokémon`).join('\n');
}

function getEmoji(idx) {
    if (idx === 0) {
        return '⭐';
    }
    return '';
}

async function queryPokemon(authorId, pokemonId) {
    console.log(`Query for authorId ${authorId}, pokemonId ${pokemonId}`);
    const bitArray = await getPokemonForUser(authorId);
    if (bitArray == null) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const pokemon = await getPokemon(pokemonId);
    if (bitArray[pokemonId - 1]) {
        return `You've caught ${pokemon.name}!`;
    }
    return `You haven't caught ${pokemon.name}`;
}

async function debugPokemon(displayName, pokemonIndex, isShiny) {
    const pokemon = await getPokemon(pokemonIndex, isShiny);
    return getEmbed(displayName, pokemon);
}

async function doPokemonBattle(player1, player2) {
    console.log(`Pokemon battle for ${player1.displayName} vs ${player2.displayName}`);
    const p1Pokemon = await getPokemonForUser(player1.id);
    if (p1Pokemon == null) {
        return { response: `<@${player1.displayName}> has no Pokémon!`, embed: null };
    }
    const p2Pokemon = await getPokemonForUser(player2.id);
    if (p2Pokemon == null) {
        return { response: `<@${player2.displayName}> has no Pokémon!`, embed: null };
    }

    const p1PokemonToBattle = selectRandomPokemon(p1Pokemon);
    const p2PokemonToBattle = selectRandomPokemon(p2Pokemon);

    const pokemon1 = await getPokemon(p1PokemonToBattle);
    const pokemon2 = await getPokemon(p2PokemonToBattle);

    const {embed, attachment} = await getBattleEmbed(player1, pokemon1, player2, pokemon2);

    const result = simulateQuickBattle(player1, pokemon1, player2, pokemon2);
    const flavor = getEffectivenessFlavor(result.effWinnerOnLoser);

    const message = 
    `⚔️ **Quick Battle**\n` +
    `**${pokemon1.name}** vs **${pokemon2.name}**\n` +
    `${flavor}\n` +
    `**${result.winner.displayName}** wins! 🔥`;

    return {response: message, embed, attachment};
}

function getEffectiveness(attackerTypes, defenderTypes) {
  let best = 1.0;

  for (const aType of attackerTypes) {
    let mult = 1.0;
    for (const dType of defenderTypes) {
      mult *= TYPE_CHART[aType]?.[dType] ?? 1.0;
    }
    if (mult > best) best = mult;
  }

  return best;
}

function getEffectivenessFlavor(multiplier) {
  if (multiplier === 0) return "❌ **It's immune!**";
  if (multiplier >= 2.0) return "🔥 **It's super effective!**";
  if (multiplier <= 0.5) return "🌿 **It's not very effective...**";
  return ""; // neutral = no extra text
}

function simulateQuickBattle(player1, pokemon1, player2, pokemon2) {
  const typesA = pokemon1.types.map(t => t.type.name.toLowerCase());
  const typesB = pokemon2.types.map(t => t.type.name.toLowerCase());

  const effAonB = getEffectiveness(typesA, typesB);   // How strong A is against B
  const effBonA = getEffectiveness(typesB, typesA);   // How strong B is against A

  // Base weighted probability
  let winProbA = (effAonB + effBonA) === 0 ? 0.5 : effAonB / (effAonB + effBonA);

  // Add tiny randomness (±10% max swing, keeps it feeling fair)
  const randomness = (Math.random() - 0.5) * 0.2; // -0.1 to +0.1
  winProbA = Math.max(0.1, Math.min(0.9, winProbA + randomness));

  const aWins = Math.random() < winProbA;
  
  return {
    winner: aWins ? player1 : player2,
    loser: aWins ? player2 : player1,
    effWinnerOnLoser: aWins ? effAonB : effBonA,
    effLoserOnWinner: aWins ? effBonA : effAonB
  };
}

function selectRandomPokemon(bitArray) {
    const ones = [];
    for (let i = 0; i < bitArray.length; i++) {
        if (bitArray[i] === 1) {
            ones.push(i);
        }
    }
    if (ones.length === 0) {
        return null;
    }
    const randomPos = Math.floor(Math.random() * ones.length);
    return ones[randomPos] + 1;
}

async function getBattleEmbed(player1, pokemon1, player2, pokemon2) {
    const attachment = await combineTwoImages(pokemon1.picture, pokemon2.picture);
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`${player1.displayName}'s ${pokemon1.name} vs. ${player2.displayName}'s ${pokemon2.name}`)
        .setImage('attachment://combined-image.png')
        .setURL('https://example.com')
        .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png')
        .setFooter({ text: 'Powered by PokéAPI' })
        .setTimestamp();

    return {embed, attachment};
}

async function combineTwoImages(url1, url2) {
    // Load both images
    const img1 = await loadImage(url1);
    const img2 = await loadImage(url2);

    const padding = 20;
    const canvasWidth = img1.width + img2.width + padding;
    const canvasHeight = Math.max(img1.height, img2.height);

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Draw first image on the left
    ctx.drawImage(img1, 0, 0);

    // Draw second image on the right
    ctx.drawImage(img2, img1.width + padding, 0);

    // Convert to buffer for Discord
    const buffer = canvas.toBuffer('image/png');

    return new AttachmentBuilder(buffer, { name: 'combined-image.png' });
}

module.exports = {
    handlePokemonGame,
    getPokemonStats,
    getPokemonLeaderboard,
    queryPokemon,
    debugPokemon,
    doPokemonBattle,
};