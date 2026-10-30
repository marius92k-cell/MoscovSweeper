
import {
  ref,
  push,
  set,
  get,
  update,
  onValue,
  runTransaction,
} from "firebase/database";

import { signInAnonymously } from "firebase/auth";
import { auth, database } from "./firebase";

export type Difficulty = "easy" | "medium" | "hard";

export type GameCell = {
  mine: boolean;
  adjacent: number;
};

export type Player = {
  name: string;
  status: "waiting" | "playing" | "won" | "lost";
  joinedAt: number;
  revealed?: Record<string, boolean>;
  flagged?: Record<string, boolean>;
  progress?: number;
  finishTime?: number;
  finishOrder?: number;
};

export type Room = {
  hostId: string;
  status: "lobby" | "playing" | "finished";
  difficulty: Difficulty;
  players: Record<string, Player>;
  board?: GameCell[][];
  safeStart?: { r: number; c: number };
  startedAt?: number;
  createdAt: number;
};

const LEVELS = {
  easy: { size: 8, mines: 10 },
  medium: { size: 10, mines: 20 },
  hard: { size: 16, mines: 40 },
};

export async function loginPlayer() {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  const result = await signInAnonymously(auth);
  return result.user.uid;
}


function generateSharedBoard(difficulty: Difficulty): {
  board: GameCell[][];
  safeStart: { r: number; c: number };
} {
  const { size, mines } = LEVELS[difficulty];

  // Alegem o casuță sigură și păstrăm liberă și zona de 3x3 din jurul ei.
  const safeStart = {
    r: Math.floor(Math.random() * size),
    c: Math.floor(Math.random() * size),
  };

  const board: GameCell[][] = Array.from(
    { length: size },
    () =>
      Array.from({ length: size }, () => ({
        mine: false,
        adjacent: 0,
      }))
  );

  let placed = 0;

  while (placed < mines) {
    const r = Math.floor(Math.random() * size);
    const c = Math.floor(Math.random() * size);

    const insideSafeArea =
      Math.abs(r - safeStart.r) <= 1 &&
      Math.abs(c - safeStart.c) <= 1;

    if (board[r][c].mine || insideSafeArea) continue;

    board[r][c].mine = true;
    placed++;
  }

  calculateNumbers(board, size);
  return { board, safeStart };
}

function calculateNumbers(board: GameCell[][], size: number) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      board[r][c].adjacent = 0;

      if (board[r][c].mine) continue;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;

          if (
            nr >= 0 &&
            nr < size &&
            nc >= 0 &&
            nc < size &&
            board[nr][nc].mine
          ) {
            board[r][c].adjacent++;
          }
        }
      }
    }
  }
}


export async function createRoom(
  playerName: string,
  difficulty: Difficulty
) {
  const uid = await loginPlayer();
  const roomRef = push(ref(database, "rooms"));

  if (!roomRef.key) {
    throw new Error("Nu am putut crea camera.");
  }

  const room: Room = {
    hostId: uid,
    status: "lobby",
    difficulty,
    players: {
      [uid]: {
        name: playerName.trim(),
        status: "waiting",
        joinedAt: Date.now(),
        progress: 0,
      },
    },
    createdAt: Date.now(),
  };

  await set(roomRef, room);
  return roomRef.key;
}

export async function joinRoom(
  roomId: string,
  playerName: string
) {
  const uid = await loginPlayer();
  const roomRef = ref(database, `rooms/${roomId}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error("Camera nu există.");
  }

  const room = snapshot.val() as Room;

  if (room.status !== "lobby") {
    throw new Error("Jocul a început deja.");
  }

  await set(
    ref(database, `rooms/${roomId}/players/${uid}`),
    {
      name: playerName.trim(),
      status: "waiting",
      joinedAt: Date.now(),
      progress: 0,
    }
  );

  return uid;
}

export function listenToRoom(
  roomId: string,
  callback: (room: Room | null) => void
) {
  return onValue(
    ref(database, `rooms/${roomId}`),
    (snapshot) => {
      callback(
        snapshot.exists() ? snapshot.val() as Room : null
      );
    }
  );
}

export async function startRoom(roomId: string) {
  const uid = await loginPlayer();
  const roomRef = ref(database, `rooms/${roomId}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error("Camera nu există.");
  }

  const room = snapshot.val() as Room;

  if (room.hostId !== uid) {
    throw new Error("Doar gazda poate începe jocul.");
  }

  if (room.status !== "lobby") {
    throw new Error("Camera nu mai este în lobby.");
  }

  const { board, safeStart } = generateSharedBoard(room.difficulty);
  const updates: Record<string, unknown> = {
    status: "playing",
    board,
    safeStart,
    startedAt: Date.now(),
  };

  for (const playerId of Object.keys(room.players)) {
    updates[`players/${playerId}/status`] = "playing";
    updates[`players/${playerId}/progress`] = 0;
  }

  await update(roomRef, updates);
}

export async function savePlayerProgress(
  roomId: string,
  revealed: Record<string, boolean>,
  flagged: Record<string, boolean>,
  progress: number
) {
  const uid = await loginPlayer();

  await update(
    ref(database, `rooms/${roomId}/players/${uid}`),
    {
      revealed,
      flagged,
      progress,
    }
  );
}


export async function finishPlayer(
  roomId: string,
  result: "won" | "lost",
  finishTime: number
) {
  const uid = await loginPlayer();
  const roomRef = ref(database, `rooms/${roomId}`);

  await runTransaction(roomRef, (room) => {
    if (!room || !room.players) return;

    const player = room.players[uid];

    if (!player || player.status !== "playing") return;

    const completedCount = Object.values(room.players).filter(
      (item: any) =>
        item.status === "won" || item.status === "lost"
    ).length;

    player.status = result;
    player.finishTime = finishTime;
    player.finishOrder = completedCount + 1;

    const allFinished = Object.values(room.players).every(
      (item: any) =>
        item.status === "won" || item.status === "lost"
    );

    if (allFinished) {
      room.status = "finished";
    }

    return room;
  });
}


export async function restartRoom(roomId: string) {
  const uid = await loginPlayer();
  const roomRef = ref(database, `rooms/${roomId}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error("Camera nu există.");
  }

  const room = snapshot.val() as Room;

  if (room.hostId !== uid) {
    throw new Error("Doar gazda poate reporni jocul.");
  }

  if (room.status !== "finished") {
    throw new Error("Toți jucătorii trebuie să termine partida.");
  }

  const { board, safeStart } = generateSharedBoard(room.difficulty);
  const updates: Record<string, unknown> = {
    status: "playing",
    board,
    safeStart,
    startedAt: Date.now(),
  };

  for (const playerId of Object.keys(room.players)) {
    updates[`players/${playerId}/status`] = "playing";
    updates[`players/${playerId}/revealed`] = null;
    updates[`players/${playerId}/flagged`] = null;
    updates[`players/${playerId}/progress`] = 0;
    updates[`players/${playerId}/finishTime`] = null;
    updates[`players/${playerId}/finishOrder`] = null;
  }

  await update(roomRef, updates);
}
