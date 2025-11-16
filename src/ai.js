const OpenAI = require('openai');

const apiKey = process.env.X_API_KEY;

const openai = new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1'
});

async function imagine(prompt) {
    console.log(prompt);

    const response = await openai.images.generate({
        model: 'grok-2-image',
        prompt,
        response_format: 'b64_json'
    });
    
    const answer = response.data[0].b64_json;

    return answer;
}

module.exports = {
    imagine,
};