import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
admin.initializeApp();

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

export const addWelcomeMessages = functions.auth.user().onCreate(user => {
  console.log('A new user signed in for the first time.');
  const fullName = user.displayName || 'Anonymous';

  return admin
    .database()
    .ref('messages')
    .push({
      name: 'Firebase Bot',
      photoUrl: '/assets/images/firebase-logo.png',
      text: `${fullName} signed in for the first time! Welcome!`,
    });
});
