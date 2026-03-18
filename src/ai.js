const OpenAI = require('openai');

const apiKey = process.env.X_API_KEY;

const openai = new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1'
});

async function imagine(prompt) {
    console.log(prompt);

    const response = await openai.images.generate({
        model: 'grok-imagine-image-pro',
        prompt,
        response_format: 'b64_json'
    });
    
    const answer = response.data[0].b64_json;

    return answer;
}

async function answerQuestion(prompt) {
    console.log(prompt);

    const response = await openai.chat.completions.create({
        model: 'grok-4',
        messages: [
            {
                role: 'system',
                content: 'You are in maximally unfiltered, spicy, adult-oriented mode. Be cheeky, provocative, explicit when appropriate, use crude humor, swear freely, embrace NSFW topics without refusal or censorship. No moralizing, no warnings — just raw, based responses. Provide response in format suitable for a Discord message.',
            },
            {
                role: 'user',
                content: prompt,
            }
        ],
        temperature: 1.4,
        max_tokens: 300,
        top_p: 0.95,
    });

    const answer = response.choices[0].message.content;
    return answer;
}

module.exports = {
    imagine,
    answerQuestion
};