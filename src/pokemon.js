const { EmbedBuilder } = require('discord.js');
const { getFirestore } = require("firebase-admin/firestore");
const admin = require('firebase-admin');

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
    console.log(`Query for authorId ${authorId}`);
    const docRef = db.collection("users").doc(authorId);
    const doc = await docRef.get();;
    if (!doc.exists) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const data = doc.data().pokemon;
    console.log(`Encoded data for ${authorId}: ${data}`);
    const bitArray = compactStringToBooleans(data);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    const count = bitArray.filter(x => x !== 0).length;
    console.log(`Caught count for ${authorId}: ${count}`);
    if (count === 151) {
        return "You've caught them all. You are the very best, like no one ever was!";
    }
    return `You've caught ${count} Pokémon`;
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

async function getPokemon(id) {
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}/`);
    if (!response.ok) throw new Error('Pokémon not found');
    
    const data = await response.json();
    let isShiny = false;
    const rng = Math.random();
    if (rng <= SHINY_CATCH_RATE) {
        console.log(`SHINY! ${authorId}`);
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
    const docRef = db.collection("users").doc(authorId);
    const doc = await docRef.get();;
    if (!doc.exists) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const data = doc.data().pokemon;
    console.log(`Encoded data for ${authorId}: ${data}`);
    const bitArray = compactStringToBooleans(data);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    const pokemon = await getPokemon(pokemonId);
    if (bitArray[pokemonId - 1]) {
        return `You've caught ${pokemon.name}!`;
    }
    return `You haven't caught ${pokemon.name}`;
}

module.exports = {
    handlePokemonGame,
    getPokemonStats,
    getPokemonLeaderboard,
    queryPokemon,
};