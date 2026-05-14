// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA9vf2w81OXUO13q8JgZcH9jcYJPwGmkf8",
  authDomain: "garage-motos.firebaseapp.com",
  projectId: "garage-motos",
  storageBucket: "garage-motos.firebasestorage.app",
  messagingSenderId: "342952793183",
  appId: "1:342952793183:web:d3f11040a13a279bf637ea",
  measurementId: "G-FN1TXPHKVG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);