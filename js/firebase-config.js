// ==========================================================================
// FILE: js/firebase-config.js
// FUNGSI: Inisialisasi Firebase SDK V10 (Modular)
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Konfigurasi Spesifik BAGANTARA Core
const firebaseConfig = {
  apiKey: "AIzaSyCRIAiHzzkl-yTtC2fTbvh-vtC2jm1Sbvo",
  authDomain: "bagantara-core.firebaseapp.com",
  databaseURL: "https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bagantara-core",
  storageBucket: "bagantara-core.firebasestorage.app",
  messagingSenderId: "760632276621",
  appId: "1:760632276621:web:1a2758755056e9ff7ed4c4"
};

// Inisialisasi Aplikasi
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

export { app, auth, db, provider };
