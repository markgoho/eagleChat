import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
const Storage = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const exec = require('child-process-promise').exec;

admin.initializeApp();

const visionClient = new vision.ImageAnnotatorClient();
const storageClient = new Storage();

interface Detection {
  adult: Likelihood;
  spoof: Likelihood;
  medical: Likelihood;
  violence: Likelihood;
  racy: Likelihood;
}

enum Likelihood {
  UNKNOWN,
  VERY_UNLIKELY,
  UNLIKELY,
  POSSIBLE,
  LIKELY,
  VERY_LIKELY,
}

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

export const blurOffensiveImages = functions.storage
  .object()
  .onFinalize(async object => {
    console.log('Running blurOffensiveImages');

    const messageId = object.name.split('/')[1];

    const snapshot = await admin
      .database()
      .ref(`/messages/${messageId}/moderated`)
      .once('value');

    if (snapshot.val()) {
      console.log('Image already moderated, exiting.');
      return null;
    }

    const results = await visionClient.safeSearchDetection(
      `gs://${object.bucket}/${object.name}`
    );

    const safeSearch = results[0];
    console.log('SafeSearch results on image', safeSearch);

    if (!results) {
      return null;
    }

    const detections: Detection = results[0].safeSearchAnnotation;

    const adult = parseInt(Likelihood[detections.adult], 10);
    const violence = parseInt(Likelihood[detections.violence], 10);

    if (adult > Likelihood.POSSIBLE || violence > Likelihood.POSSIBLE) {
      console.log(
        'The image',
        object.name,
        'has been detected as inappropriate.'
      );
      return blurImage(object);
    } else {
      console.log('The image', object.name, ' has been detected as OK.');
    }
  });

async function blurImage(
  object: functions.storage.ObjectMetadata
): Promise<any> {
  const filePath = object.name;
  const bucket = storageClient.bucket(object.bucket);
  const fileName = filePath.split('/').pop();
  const tempLocalFile = `/tmp/${fileName}`;
  const messageId = filePath.split('/')[1];

  await bucket.file(filePath).download({ destination: tempLocalFile });
  console.log('Image has been downloaded to', tempLocalFile);
  await exec(
    `convert ${tempLocalFile} -channel RGBA -blur 0x24 ${tempLocalFile}`
  );
  console.log('Image has been blurred');
  await bucket.upload(tempLocalFile, { destination: filePath });
  console.log('Blurred image has been uploaded to', filePath);
  return admin
    .database()
    .ref(`/messages/${messageId}`)
    .update({ moderated: true });
}

export const sendNotifications = functions.database
  .ref('/messages/{messageId}')
  .onWrite(async (change, context) => {
    if (change.before.val()) {
      return null;
    }

    const original = change.after.val();
    const text = original.text;
    const payload = {
      notification: {
        title: `${original.name} posted ${text ? 'a message' : 'an image'}`,
        body: text
          ? text.length <= 100
            ? text
            : text.substring(0, 97) + '...'
          : '',
        icon: original.photoUrl || '/assets/images/profile_placeholder.png',
      },
    };

    const allTokens = await admin
      .database()
      .ref('fcmTokens')
      .once('value');

    if (allTokens.val()) {
      // Listing all tokens.
      const tokens = Object.keys(allTokens.val());

      // Send notifications to all tokens.
      const response = await admin.messaging().sendToDevice(tokens, payload);

      // For each message check if there was an error.
      const tokensToRemove = [];
      response.results.forEach((result, index) => {
        const error = result.error;
        if (error) {
          console.error(
            'Failure sending notification to',
            tokens[index],
            error
          );
          // Cleanup the tokens who are not registered anymore.
          if (
            error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered'
          ) {
            tokensToRemove.push(allTokens.ref.child(tokens[index]).remove());
          }
        }

        return Promise.all(tokensToRemove);
      });
    }
  });
