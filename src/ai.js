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
                content: 'Provide super concise responses in format suitable for a Discord message. Feel free to be a bit sarcastic as appropriate.',
            },
            {
                role: 'user',
                content: prompt,
            }
        ],
    });

    const answer = response.choices[0].message.content;
    return answer;
}

module.exports = {
    imagine,
    answerQuestion
};