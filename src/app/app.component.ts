import { Component } from '@angular/core';
import { MatSnackBar } from '@angular/material';
import { AngularFireAuth } from 'angularfire2/auth';
import { AngularFireDatabase, AngularFireList } from 'angularfire2/database';
import { AngularFireStorage } from 'angularfire2/storage';
import * as firebase from 'firebase';
import { Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

const LOADING_IMAGE_URL = 'https://www.google.com/images/spin-32.gif';
const PROFILE_PLACEHOLDER_IMAGE_URL = '/assets/images/profile_placeholder.png';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  user: Observable<firebase.User>;
  currentUser: firebase.User;
  messages: Observable<any[]>;
  profilePicStyles: {};
  topics = '';
  value = '';

  constructor(
    public db: AngularFireDatabase,
    public afAuth: AngularFireAuth,
    public afStorage: AngularFireStorage,
    public snackBar: MatSnackBar
  ) {
    this.user = afAuth.authState;
    this.user.subscribe((user: firebase.User) => {
      // tslint:disable-next-line:no-console
      console.log(user);
      this.currentUser = user;

      if (user) {
        // User is signed in!
        this.profilePicStyles = {
          'background-image': `url(${this.currentUser.photoURL})`,
        };

        // We load currently existing chat messages.
        this.messages = this.db
          .list<any>('/messages', ref => ref.limitToLast(12))
          .valueChanges();
        this.messages.subscribe(messages => {
          // Calculate list of recently discussed topics
          const topicsMap = {};
          const topics = [];
          let hasEntities = false;
          messages.forEach(message => {
            if (message.entities) {
              for (const entity of message.entities) {
                if (!topicsMap.hasOwnProperty(entity.name)) {
                  topicsMap[entity.name] = 0;
                }
                topicsMap[entity.name] += entity.salience;
                hasEntities = true;
              }
            }
          });
          if (hasEntities) {
            for (const name in topicsMap) {
              if (topicsMap.hasOwnProperty(name)) {
                topics.push({ name, score: topicsMap[name] });
              }
            }
            topics.sort((a, b) => b.score - a.score);
            this.topics = topics.map(topic => topic.name).join(', ');
          }

          // Make sure new message scroll into view
          setTimeout(() => {
            const messageList = document.getElementById('messages');
            messageList.scrollTop = messageList.scrollHeight;
            document.getElementById('message').focus();
          }, 500);
        });

        // We save the Firebase Messaging Device token and enable notifications.
        this.saveMessagingDeviceToken();
      } else {
        // User is signed out!
        this.profilePicStyles = {
          'background-image': PROFILE_PLACEHOLDER_IMAGE_URL,
        };
        this.topics = '';
      }
    });
  }

  login() {
    this.afAuth.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  }

  logout() {
    this.afAuth.auth.signOut();
  }

  // TODO: Refactor into text message form component
  update(value: string) {
    this.value = value;
  }

  // Returns true if user is signed-in. Otherwise false and displays a message.
  checkSignedInWithMessage() {
    // Return true if the user is signed in Firebase
    if (this.currentUser) {
      return true;
    }

    this.snackBar
      .open('You must sign-in first', 'Sign in', {
        duration: 5000,
      })
      .onAction()
      .subscribe(() => this.login());

    return false;
  }

  // TODO: Refactor into text message form component
  async saveMessage(event: any, el: HTMLInputElement) {
    event.preventDefault();

    if (this.value && this.checkSignedInWithMessage()) {
      // Add a new message entry to the Firebase Database.
      const messages = this.db.list('/messages');
      try {
        await messages.push({
          name: this.currentUser.displayName,
          text: this.value,
          photoUrl: this.currentUser.photoURL || PROFILE_PLACEHOLDER_IMAGE_URL,
        });

        // Clear message text field and SEND button state.
        el.value = '';
      } catch (err) {
        // tslint:disable-next-line:no-console
        console.error(err);
      }
    }
  }

  // TODO: Refactor into image message form component
  async saveImageMessage(event: any) {
    event.preventDefault();
    const file = event.target.files[0];

    // Clear the selection in the file picker input.
    const imageForm = <HTMLFormElement>document.getElementById('image-form');
    imageForm.reset();

    // Check if the file is an image.
    if (!file.type.match('image.*')) {
      this.snackBar.open('You can only share images', null, {
        duration: 5000,
      });
      return;
    }

    // Check if the user is signed-in
    if (this.checkSignedInWithMessage()) {
      // We add a message with a loading icon that will get updated with the shared image.
      const messages: AngularFireList<{}> = this.db.list('/messages');
      const data = await messages.push({
        name: this.currentUser.displayName,
        imageUrl: LOADING_IMAGE_URL,
        photoUrl: this.currentUser.photoURL || PROFILE_PLACEHOLDER_IMAGE_URL,
      });

      // Upload the image to Cloud Storage.
      const filePath = `${this.currentUser.uid}/${data.key}/${file.name}`;
      const snapshot = await this.afStorage.ref(filePath).put(file);

      // Get the file's Storage URI and update the chat message placeholder.
      const fullPath = snapshot.metadata.fullPath;
      const imageUrl = this.afStorage
        .ref(fullPath)
        .getDownloadURL()
        .pipe(filter(Boolean))
        .subscribe((url: string) => {
          try {
            this.db.object(`/messages/${data.key}`).update({
              imageUrl: url,
            });
          } catch (err) {
            this.snackBar.open(
              'There was an error uploading a file to Cloud Storage.',
              null,
              {
                duration: 5000,
              }
            );
            // tslint:disable-next-line:no-console
            console.error(err);
          }
        });
    }
  }

  // TODO: Refactor into image message form component
  onImageClick(event: any) {
    event.preventDefault();
    document.getElementById('mediaCapture').click();
  }

  // Saves the messaging device token to the datastore.
  async saveMessagingDeviceToken() {
    try {
      const currentToken = await firebase.messaging().getToken();

      if (currentToken) {
        // tslint:disable-next-line:no-console
        console.log('Got FCM device token:', currentToken);
        // Save the Device Token to the datastore.
        firebase
          .database()
          .ref('/fcmTokens')
          .child(currentToken)
          .set(this.currentUser.uid);
      } else {
        // Need to request permissions to show notifications.
        return this.requestNotificationsPermissions();
      }
    } catch (err) {
      // tslint:disable-next-line:no-console
      console.error(err);
    }
  }

  // Requests permissions to show notifications.
  async requestNotificationsPermissions() {
    // tslint:disable-next-line:no-console
    console.log('Requesting notifications permission...');
    try {
      await firebase.messaging().requestPermission();
      // Notification permission granted.
      this.saveMessagingDeviceToken();
    } catch (err) {
      // tslint:disable-next-line:no-console
      console.error(err);
    }
  }
}
