# ChatterWave — beginner-friendly WhatsApp-style web app

A dark-mode starter project with:
- Email/password sign-up and login (Firebase Authentication)
- One-to-one chat threads and live message updates (Cloud Firestore)
- Image and file sharing (Firebase Storage)
- Basic 1-to-1 WebRTC audio/video calls with incoming-call accept/decline prompts and Firestore signaling

This is a learning starter, not a production-ready WhatsApp replacement. It does not include end-to-end encryption, push notifications, group chats, message delivery/read receipts, or contact syncing. Calls use a basic browser confirmation prompt for incoming calls and may need a TURN relay server on restrictive networks.

## Part 1 — Install what you need

1. Install **Visual Studio Code**.
2. Install **Google Chrome** or another modern browser.
3. In VS Code, choose **File → Open Folder** and open the `ChatterWave` folder.
4. This project uses browser ES modules. Run it from a local web server; do not double-click `index.html`.

Easy option: install the VS Code extension **Live Server**. Then right-click `index.html` and select **Open with Live Server**.

## Part 2 — Create a Firebase project

1. Open https://console.firebase.google.com/ and sign in.
2. Click **Create a project** and give it a name, such as `chatterwave-demo`.
3. In the project, click the web icon `</>` to add a web app.
4. Register the app. Firebase shows a configuration object.
5. Open `firebase-config.js` in VS Code and replace all `PASTE_...` placeholders with your project's values.
6. In Firebase Console → **Authentication** → **Sign-in method**, enable **Email/Password**.
7. In **Firestore Database**, create a database. For initial setup, choose production mode; then open the Rules tab and paste the contents of `firestore.rules`. Click **Publish**.
8. In **Storage**, get started, then open its Rules tab and paste `storage.rules`. Click **Publish**.
9. Make sure billing/plan requirements shown by Firebase Console are acceptable for your project. Do not enable public/unauthenticated access just to make an error disappear.

## Part 3 — Run it

1. Save all files.
2. In VS Code, right-click `index.html` → **Open with Live Server**.
3. Create an account with an email address you can access.
4. Open the site in another browser profile or another device and create a second account with a different email.
5. From the first account, press `＋`, enter the second account's email, and start a chat.
6. Send messages and test an image attachment.

Both users must have accounts in the same Firebase project for this starter to find each other.

## Part 4 — Test calls

- Calls require a secure context (`localhost` is okay; deployed sites should use HTTPS).
- Use two devices or browser profiles with different accounts.
- Open the same chat and test audio/video buttons. Allow browser microphone/camera permissions.
- This starter currently initiates calls from the caller side but does **not yet include a polished incoming-call accept/decline experience**. Do not treat the call feature as production-ready. WebRTC may also require a TURN relay server for networks where direct peer connections fail.

## Important security notes before publishing

- Never publish private server credentials in frontend code. Firebase web configuration is intended to be included in a web app, but your database and storage security rules must remain restrictive.
- The sample user directory is readable to signed-in users so email-based discovery works. For a real public service, consider a privacy-preserving username/invite system.
- Review and test rules carefully. These starter rules are not a substitute for a security review.
- No end-to-end encryption is implemented. Do not use this demo for sensitive conversations.
- Use your own name, logo and branding; do not present this as the official WhatsApp service.

## Troubleshooting

**“Firebase: Error (auth/operation-not-allowed)”**  
Enable Email/Password in Firebase Authentication.

**“Missing or insufficient permissions”**  
Check that the Firestore and Storage rules from this project were published and that the two accounts are signed in.

**The app shows a configuration error**  
Check `firebase-config.js`; replace every placeholder with the exact values from your Firebase web app.

**Camera or microphone does not work**  
Use localhost or an HTTPS deployment, allow browser permissions, and try another browser/network.

**The page is blank when opened from the file system**  
Start Live Server in VS Code and open the localhost address it displays.
