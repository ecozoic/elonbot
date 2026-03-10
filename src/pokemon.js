const { EmbedBuilder } = require('discord.js');

const DB = new Map();

const POKEMON_CATCH_RATE = 0.1;

async function handlePokemonGame(authorId) {
    if (!DB.has(authorId)) {
        initializeDB(authorId);
    }
    if (!shouldCatch()) {
        return null;
    }
    const indexToFlip = Math.floor(Math.random() * 151);
    const pokemonToCatch = indexToFlip + 1;
    const data = DB.get(authorId);
    const bitArray = compactStringToBooleans(data);
    if (!bitArray[indexToFlip]) {
        bitArray[indexToFlip] = !bitArray[indexToFlip];
        const encoded = booleansToCompactString(bitArray);
        DB.set(authorId, encoded);
    }
    const pokemon = await getPokemon(pokemonToCatch);
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`${message.authorId} caught ${pokemon.name}!`)
        .setDescription(`Type: ${pokemon.types.map(t => t.type.name).join(', ')}`)
        .setImage(pokemon.picture)
        .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png')
        .setFooter({ text: 'Powered by PokéAPI' })
        .setTimestamp();
    return embed;
}

async function getPokemonStats(authorId) {
    if (!DB.has(authorId)) {
        return "You've caught 0 Pokémon. Get to work champ";
    }
    const data = DB.get(authorId);
    const bitArray = compactStringToBooleans(data);
    const count = bitArray.filter(x => x !== 0).length;
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
    const encodedBitArray = booleansToCompactString(bitArray);
    DB.set(authorId, encodedBitArray);
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
        flags[i] = (bytes[byteIndex] & (1 << bitIndex)) !== 0;
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