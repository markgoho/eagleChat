"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const Storage = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const exec = require('child-process-promise').exec;
admin.initializeApp();
const visionClient = new vision.ImageAnnotatorClient();
const storageClient = new Storage();
var Likelihood;
(function (Likelihood) {
    Likelihood[Likelihood["UNKNOWN"] = 0] = "UNKNOWN";
    Likelihood[Likelihood["VERY_UNLIKELY"] = 1] = "VERY_UNLIKELY";
    Likelihood[Likelihood["UNLIKELY"] = 2] = "UNLIKELY";
    Likelihood[Likelihood["POSSIBLE"] = 3] = "POSSIBLE";
    Likelihood[Likelihood["LIKELY"] = 4] = "LIKELY";
    Likelihood[Likelihood["VERY_LIKELY"] = 5] = "VERY_LIKELY";
})(Likelihood || (Likelihood = {}));
exports.addWelcomeMessages = functions.auth.user().onCreate(user => {
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
exports.blurOffensiveImages = functions.storage
    .object()
    .onFinalize((object) => __awaiter(this, void 0, void 0, function* () {
    console.log('Running blurOffensiveImages');
    const messageId = object.name.split('/')[1];
    const snapshot = yield admin
        .database()
        .ref(`/messages/${messageId}/moderated`)
        .once('value');
    if (snapshot.val()) {
        console.log('Image already moderated, exiting.');
        return null;
    }
    const results = yield visionClient.safeSearchDetection(`gs://${object.bucket}/${object.name}`);
    const safeSearch = results[0];
    console.log('SafeSearch results on image', safeSearch);
    if (!results) {
        return null;
    }
    const detections = results[0].safeSearchAnnotation;
    const adult = parseInt(Likelihood[detections.adult], 10);
    const violence = parseInt(Likelihood[detections.violence], 10);
    if (adult > Likelihood.POSSIBLE || violence > Likelihood.POSSIBLE) {
        console.log('The image', object.name, 'has been detected as inappropriate.');
        return blurImage(object);
    }
    else {
        console.log('The image', object.name, ' has been detected as OK.');
    }
}));
function blurImage(object) {
    return __awaiter(this, void 0, void 0, function* () {
        const filePath = object.name;
        const bucket = storageClient.bucket(object.bucket);
        const fileName = filePath.split('/').pop();
        const tempLocalFile = `/tmp/${fileName}`;
        const messageId = filePath.split('/')[1];
        yield bucket.file(filePath).download({ destination: tempLocalFile });
        console.log('Image has been downloaded to', tempLocalFile);
        yield exec(`convert ${tempLocalFile} -channel RGBA -blur 0x24 ${tempLocalFile}`);
        console.log('Image has been blurred');
        yield bucket.upload(tempLocalFile, { destination: filePath });
        console.log('Blurred image has been uploaded to', filePath);
        return admin
            .database()
            .ref(`/messages/${messageId}`)
            .update({ moderated: true });
    });
}
exports.sendNotifications = functions.database
    .ref('/messages/{messageId}')
    .onWrite((change, context) => __awaiter(this, void 0, void 0, function* () {
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
    const allTokens = yield admin
        .database()
        .ref('fcmTokens')
        .once('value');
    if (allTokens.val()) {
        // Listing all tokens.
        const tokens = Object.keys(allTokens.val());
        // Send notifications to all tokens.
        const response = yield admin.messaging().sendToDevice(tokens, payload);
        // For each message check if there was an error.
        const tokensToRemove = [];
        response.results.forEach((result, index) => {
            const error = result.error;
            if (error) {
                console.error('Failure sending notification to', tokens[index], error);
                // Cleanup the tokens who are not registered anymore.
                if (error.code === 'messaging/invalid-registration-token' ||
                    error.code === 'messaging/registration-token-not-registered') {
                    tokensToRemove.push(allTokens.ref.child(tokens[index]).remove());
                }
            }
            return Promise.all(tokensToRemove);
        });
    }
}));
//# sourceMappingURL=index.js.map