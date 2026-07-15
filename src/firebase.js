// Shared Firestore init so every module (pokemon, betting, ...) uses ONE
// initializeApp. Importing firebase-admin and calling initializeApp in more
// than one module would throw a duplicate-app error.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const jsonString = Buffer.from(
    process.env.FIREBASE_CREDENTIALS_BASE64,
    'base64'
).toString('utf8');
const credential = admin.credential.cert(JSON.parse(jsonString));
const app = admin.initializeApp({ credential });
const db = getFirestore(app);

module.exports = { db };
