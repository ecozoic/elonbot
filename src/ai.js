const OpenAI = require('openai');

const apiKey = process.env.API_KEY;

const openai = new OpenAI({
    apiKey,
});

async function imagine(prompt) {
    console.log(prompt);

    const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt,
        quality: 'hd',
        response_format: 'b64_json',
        n: 1,
        size: '1024x1024',
    });

    const answer = response.data[0].b64_json;
    //console.log(answer);

    return answer;
}

module.exports = {
    imagine,
};