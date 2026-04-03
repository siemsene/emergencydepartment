# Self-Hosting Guide

This guide walks you through hosting your own instance of the Emergency Department game from scratch. No prior Firebase experience is needed.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Fork and Clone the Repository](#2-fork-and-clone-the-repository)
3. [Install Dependencies](#3-install-dependencies)
4. [Create a Firebase Project](#4-create-a-firebase-project)
5. [Enable Firebase Authentication](#5-enable-firebase-authentication)
6. [Create the Firestore Database](#6-create-the-firestore-database)
7. [Set Up reCAPTCHA Enterprise (App Check)](#7-set-up-recaptcha-enterprise-app-check)
8. [Configure Your Environment Variables](#8-configure-your-environment-variables)
9. [Set Your Admin Email](#9-set-your-admin-email)
10. [Update the Firebase Project ID](#10-update-the-firebase-project-id)
11. [Set Up Pregenerated Arrivals Data](#11-set-up-pregenerated-arrivals-data)
12. [Create an SMTP2GO Account](#12-create-an-smtp2go-account)
13. [Set Firebase Cloud Function Secrets](#13-set-firebase-cloud-function-secrets)
14. [Fix the Predeploy Script (Mac/Linux Only)](#14-fix-the-predeploy-script-maclinux-only)
15. [Deploy](#15-deploy)
16. [Verify Your Deployment](#16-verify-your-deployment)
17. [Local Development](#17-local-development)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Prerequisites

Make sure you have the following installed before you begin:

- **Node.js v24 or later** - [Download here](https://nodejs.org/). Cloud Functions require Node 24.
- **npm** - Comes bundled with Node.js.
- **Git** - [Download here](https://git-scm.com/).
- **Firebase CLI** - Install it globally after installing Node.js:
  ```bash
  npm install -g firebase-tools
  ```
- **A Google Account** - Needed to create a Firebase project.

To verify everything is installed, run:

```bash
node --version   # Should show v24.x.x or higher
npm --version
git --version
firebase --version
```

---

## 2. Fork and Clone the Repository

1. Go to the GitHub repository page.
2. Click the **Fork** button in the top-right corner to create your own copy.
3. Clone your fork to your computer:

```bash
git clone https://github.com/YOUR_USERNAME/emergencydepartment.git
cd emergencydepartment
```

---

## 3. Install Dependencies

Install dependencies for both the frontend and the Cloud Functions:

```bash
npm install
cd functions && npm install && cd ..
```

---

## 4. Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Enter a project name (e.g., `my-emergency-game`).
4. You can enable or disable Google Analytics - it's optional and not required for the game.
5. Click **Create project** and wait for it to finish.

### Get Your Firebase Config Values

1. In your Firebase project, click the **gear icon** (top-left) > **Project settings**.
2. Scroll down to **Your apps** and click the **Web** icon (`</>`).
3. Register a web app with any nickname (e.g., "Emergency Game").
4. You'll see a `firebaseConfig` object - **keep this page open**, you'll need these values in Step 8.

---

## 5. Enable Firebase Authentication

1. In the Firebase Console, go to **Build > Authentication** from the left sidebar.
2. Click **Get started**.
3. Under **Sign-in method**, click **Email/Password**.
4. Toggle **Enable** to on (leave "Email link" disabled).
5. Click **Save**.

---

## 6. Create the Firestore Database

1. In the Firebase Console, go to **Build > Firestore Database**.
2. Click **Create database**.
3. Choose a location close to your users (e.g., `nam5` for North America, `eur3` for Europe). **This cannot be changed later.**
4. Start in **Production mode** (the game's security rules will be deployed in Step 15).
5. Click **Create**.

---

## 7. Set Up reCAPTCHA Enterprise (App Check)

App Check protects your Firebase resources from abuse. This step is optional for getting started but recommended for production.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select the same project you created in Firebase.
3. Search for **reCAPTCHA Enterprise** in the search bar and enable the API.
4. Go to **reCAPTCHA Enterprise > Keys** and click **Create Key**.
5. Choose **Website** as the platform.
6. Add your domain (e.g., `my-emergency-game.web.app`) and `localhost` for development.
7. Click **Create** and copy the **Site Key**.

Now enable App Check in Firebase:

1. Go back to the Firebase Console > **Build > App Check**.
2. Click on your web app.
3. Select **reCAPTCHA Enterprise** and paste the Site Key.
4. Click **Save**.

---

## 8. Configure Your Environment Variables

Create a `.env` file in the project root directory. This file holds your Firebase configuration and is **not** committed to Git.

```bash
# Copy this template and fill in your values:

# Firebase Config - get these from Firebase Console > Project Settings > Your apps
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id_here
VITE_FIREBASE_APP_ID=your_app_id_here

# Admin - the email address you will use to log in as admin
VITE_ADMIN_EMAIL=your-email@example.com

# reCAPTCHA Enterprise - from Step 7 (leave blank to skip App Check)
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=your_recaptcha_site_key_here

# Debug token for local development only (see Step 17)
# VITE_APPCHECK_DEBUG_TOKEN=
```

Replace every `your_..._here` placeholder with the real values from your Firebase project's config object (from Step 4).

---

## 9. Set Your Admin Email

The admin email is used in **two places** and they must match. This is the email you'll use to log into the game as the administrator.

### 9a. In the Environment Variables

Make sure `VITE_ADMIN_EMAIL` in your `.env` file is set to your email address (done in Step 8).

### 9b. In the Firestore Security Rules

Open the file `firestore.rules` and find this line (near the top):

```
return isSignedIn() && request.auth.token.email == "siemsene@gmail.com";
```

Replace `siemsene@gmail.com` with **the same email address** you used for `VITE_ADMIN_EMAIL`:

```
return isSignedIn() && request.auth.token.email == "your-email@example.com";
```

> **Important:** If these two emails don't match, you won't have admin access to manage instructors.

---

## 10. Update the Firebase Project ID

Open `.firebaserc` and replace the project ID with your own:

```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

Use the same project ID from your Firebase project (the one in `VITE_FIREBASE_PROJECT_ID`).

Then log into Firebase from the command line:

```bash
firebase login
```

---

## 11. Set Up Pregenerated Arrivals Data

The game can use a standard set of pregenerated patient arrivals. Create this file by copying the provided stub:

```bash
cp src/data/pregeneratedArrivals.example.stub.ts src/data/pregeneratedArrivals.ts
```

On Windows (Command Prompt):
```cmd
copy src\data\pregeneratedArrivals.example.stub.ts src\data\pregeneratedArrivals.ts
```

This creates an empty arrivals dataset. Instructors can also generate random arrivals when setting up each session.

---

## 12. Create an SMTP2GO Account

SMTP2GO handles sending email notifications (instructor approvals, password resets, etc.). If you don't need email notifications, you can skip this step - the game will still work, but emails will fail silently.

1. Go to [SMTP2GO](https://www.smtp2go.com/) and sign up for a free account.
2. **Verify your sender email:**
   - Go to **Settings > Sender Domains** or **Single Sender Emails**.
   - Add the email address you want to send from (e.g., `noreply@yourdomain.com`). If you don't have a custom domain, you can verify a personal email address.
   - Follow the verification steps (check your inbox for a verification email).
3. **Get your API Key:**
   - Go to **Settings > API Keys**.
   - Click **Create API Key** (or copy the existing one).
   - Save this key - you'll need it in the next step.

---

## 13. Set Firebase Cloud Function Secrets

Cloud Functions use Firebase-managed secrets to store sensitive values. Set each one with the Firebase CLI:

```bash
firebase functions:secrets:set SMTP2GO_API_KEY
```

When prompted, paste your SMTP2GO API key and press Enter.

```bash
firebase functions:secrets:set ADMIN_EMAIL
```

Enter the same admin email address from Step 9.

```bash
firebase functions:secrets:set FROM_EMAIL
```

Enter the sender email address you verified in SMTP2GO (e.g., `noreply@yourdomain.com`).

---

## 14. Fix the Predeploy Script (Mac/Linux Only)

The default predeploy script is set up for Windows. If you're on Mac or Linux, open `firebase.json` and find this line:

```json
"predeploy": ["functions/predeploy.cmd"]
```

Replace it with:

```json
"predeploy": ["npm --prefix functions run lint", "npm --prefix functions run build"]
```

Windows users can skip this step.

---

## 15. Deploy

Deploy everything to Firebase with a single command:

```bash
firebase deploy
```

This deploys:
- **Firestore security rules** - protects your database
- **Cloud Functions** - email sending and session cleanup
- **Hosting** - the game's frontend (builds automatically before deploying)

The first deploy may take a few minutes. When it's done, you'll see a **Hosting URL** in the output (e.g., `https://your-project-id.web.app`).

---

## 16. Verify Your Deployment

1. Open the Hosting URL in your browser.
2. Click **Instructor Login** and register a new account using **the admin email** from Step 9.
3. You should be automatically logged in with admin privileges (admin accounts are auto-approved).
4. Go to the **Admin Dashboard** - you should see the admin panel.
5. Try creating a test session to verify everything works.

---

## 17. Local Development

To run the game locally during development:

```bash
npm run dev
```

This starts a development server at `http://localhost:3000`.

### App Check Debug Token (Optional)

If you enabled App Check (Step 7), local development requires a debug token:

1. Uncomment the `VITE_APPCHECK_DEBUG_TOKEN` line in your `.env` file and set any value, or leave it as-is to auto-generate one.
2. Start the dev server and open the browser console. You'll see a debug token printed.
3. Go to **Firebase Console > App Check > Apps > your web app > overflow menu (three dots) > Manage debug tokens**.
4. Add the token from the console.

### Building Locally

To create a production build without deploying:

```bash
npm run build
npm run preview    # Preview the production build locally
```

---

## 18. Troubleshooting

### "Error: Node version must be 24"
Cloud Functions require Node.js 24. Check your version with `node --version` and update if needed. You can use [nvm](https://github.com/nvm-sh/nvm) to manage multiple Node versions.

### "Missing or insufficient permissions" in the app
- Make sure you deployed Firestore rules: `firebase deploy --only firestore:rules`
- Verify the admin email in `firestore.rules` matches your `VITE_ADMIN_EMAIL` exactly.

### Emails aren't sending
- Check that all three secrets are set: `firebase functions:secrets:access SMTP2GO_API_KEY`
- Verify your sender email is verified in SMTP2GO.
- Check the Cloud Functions logs: `firebase functions:log`

### "App Check token error" or "400 Bad Request"
- Make sure reCAPTCHA Enterprise is enabled in Google Cloud Console.
- Verify the site key in `.env` matches the one in Firebase App Check settings.
- For local development, set up a debug token (see Step 17).

### Admin dashboard not showing / no admin access
- The email you log in with **must exactly match** the email in both `.env` (`VITE_ADMIN_EMAIL`) and `firestore.rules`.
- Register a new account with that email - the admin instructor record is auto-created on first login.

### Deploy fails with "predeploy" error
- **Windows:** Make sure `functions/predeploy.cmd` exists.
- **Mac/Linux:** Follow Step 14 to update the predeploy command in `firebase.json`.

### "Could not find a required file: pregeneratedArrivals.ts"
Follow Step 11 to create the file from the provided stub.
