const { EmbedBuilder } = require('discord.js');

const DB = new Map();

const POKEMON_CATCH_RATE = 0.25;

async function handlePokemonGame(authorId, displayName) {
    if (!DB.has(authorId)) {
        console.log(`No entry for ${authorId}, initializing DB...`);
        initializeDB(authorId);
    }
    if (!shouldCatch()) {
        console.log(`No catch for ${authorId}`);
        return null;
    }
    console.log(`Catching pokemon for ${authorId}`);
    const indexToFlip = Math.floor(Math.random() * 151);
    console.log(`index for ${authorId}: ${indexToFlip}`);
    const pokemonToCatch = indexToFlip + 1;
    console.log(`pokemon number for ${authorId}: ${pokemonToCatch}`);
    const data = DB.get(authorId);
    console.log(`Encoded data for ${authorId}: ${data}`);
    const bitArray = compactStringToBooleans(data);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    if (bitArray[indexToFlip] === 0) {
        console.log(`Flipping value at ${indexToFlip} for ${authorId}`);
        bitArray[indexToFlip] = 1;
        console.log(`New decoded data for ${authorId}: ${bitArray}`);
        const encoded = booleansToCompactString(bitArray);
        console.log(`New Encoded data for ${authorId}: ${data}`);
        DB.set(authorId, encoded);
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
    if (!DB.has(authorId)) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const data = DB.get(authorId);
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

function shouldCatch() {
    return Math.random() < POKEMON_CATCH_RATE;
}

function initializeDB(authorId) {
    const bitArray = Array(151).fill(0);
    console.log(`Decoded data for ${authorId}: ${bitArray}`);
    const data = booleansToCompactString(bitArray);
    console.log(`Encoded data for ${authorId}: ${data}`);
    DB.set(authorId, data);
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
        flags[i] = (bytes[byteIndex] & (1 << bitIndex));
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