
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCRcCIb7Usnj4JCwyUqr9vo7jqemyOtPjg",
  authDomain: "minesweeper-multiplayer-b3da8.firebaseapp.com",
  databaseURL: "https://minesweeper-multiplayer-b3da8-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "minesweeper-multiplayer-b3da8",
  storageBucket: "minesweeper-multiplayer-b3da8.firebasestorage.app",
  messagingSenderId: "73187509728",
  appId: "1:73187509728:web:6a3ea150cc994272bd5785",
  measurementId: "G-9TD4L4CVM4"
};

const app = initializeApp(firebaseConfig);

export const database = getDatabase(app);
export const auth = getAuth(app);
