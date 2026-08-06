// Firebase project: upcoming-concerts (upcoming-concerts-ce28d).
// firebase-*-compat.js scripts (loaded before this file) put `firebase` on
// window; `auth`/`db` declared here are globals, same as CONCERTS in data.js,
// since every script on this page is a plain non-module <script> tag.
const firebaseConfig = {
  apiKey: "AIzaSyB3r3Wp-tRBwiUq9Y062g2fPwA5dk_wGXU",
  authDomain: "upcoming-concerts-ce28d.firebaseapp.com",
  projectId: "upcoming-concerts-ce28d",
  storageBucket: "upcoming-concerts-ce28d.firebasestorage.app",
  messagingSenderId: "63994004518",
  appId: "1:63994004518:web:2ccf47fff208287e2d92e7",
  measurementId: "G-GTY7Q1YGL4",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
