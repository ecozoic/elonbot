const { EmbedBuilder } = require('discord.js');
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, doc, setDoc, getDoc } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const POKEMON_CATCH_RATE = 0.25;
const POKEMON_CATCH_ICD = 5; // seconds
const COOLDOWNS = new Map(); // userID -> timestamp when cooldown ends

async function handlePokemonGame(authorId, displayName) {
    const docRef = doc(db, "users", authorId);
    let docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
        console.log(`No entry for ${authorId}, initializing DB...`);
        await initializeDB(authorId, docRef);
        docSnap = await getDoc(docRef);
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
    const data = docSnap.data().pokemon;
    console.log(`Encoded data for ${authorId}: ${data}`);
    const bitArray = compactStringToBooleans(data);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    if (bitArray[indexToFlip] === 0) {
        console.log(`Flipping value at ${indexToFlip} for ${authorId}`);
        bitArray[indexToFlip] = 1;
        console.log(`New decoded data for ${authorId}: ${bitArray}`);
        const encoded = booleansToCompactString(bitArray);
        console.log(`New Encoded data for ${authorId}: ${data}`);
        await setDoc(docRef, {
            pokemon: encoded,
        });
    }
    const pokemon = await getPokemon(pokemonToCatch);
    console.log('pokemon', pokemon);
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`${displayName} caught ${pokemon.name}!`)
        .setDescription(`Type: ${pokemon.types.map(t => t.type.name).join(', ')}`)
        .setImage(pokemon.picture)
        .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png')
        .setFooter({ text: 'Powered by PokéAPI' })
        .setTimestamp();
    return embed;
}

async function getPokemonStats(authorId) {
    console.log(`Query for authorId ${authorId}`);
    const docRef = doc(db, "users", authorId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const data = docSnap.data().pokemon;
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
    if (!Math.random() < POKEMON_CATCH_RATE) {
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
    await setDoc(docRef, {
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
    
    return {
      name: data.name.charAt(0).toUpperCase() + data.name.slice(1),  // Capitalize
      id: data.id,
      types: data.types,
      picture: data.sprites.other?.official_artwork?.front_default || 
               data.sprites.front_default  // fallback to classic sprite
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

module.exports = {
    handlePokemonGame,
    getPokemonStats,
};