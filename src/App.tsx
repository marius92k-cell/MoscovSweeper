
import { useEffect, useState } from "react";
import {
  createRoom,
  joinRoom,
  listenToRoom,
  startRoom,
  savePlayerProgress,
  finishPlayer,
  restartRoom,
} from "./multiplayer";
import type { Room, Difficulty } from "./multiplayer";
import { auth } from "./firebase";
import "./App.css";

type Marks = Record<string, boolean>;

const LEVELS = {
  easy: { size: 8, mines: 10 },
  medium: { size: 10, mines: 20 },
  hard: { size: 16, mines: 40 },
};

function key(r: number, c: number) {
  return `${r}-${c}`;
}

function expandArea(
  board: NonNullable<Room["board"]>,
  revealed: Marks,
  flagged: Marks,
  r: number,
  c: number,
  size: number
) {
  if (r < 0 || r >= size || c < 0 || c >= size) return;

  const id = key(r, c);

  if (revealed[id] || flagged[id] || board[r][c].mine) return;

  revealed[id] = true;

  if (board[r][c].adjacent === 0) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr !== 0 || dc !== 0) {
          expandArea(
            board,
            revealed,
            flagged,
            r + dr,
            c + dc,
            size
          );
        }
      }
    }
  }
}

export default function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomId, setRoomId] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [difficulty, setDifficulty] =
    useState<Difficulty>("medium");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Marks>({});
  const [flagged, setFlagged] = useState<Marks>({});
  const [seconds, setSeconds] = useState(0);
  const [boardZoom, setBoardZoom] = useState(100);

  const uid = auth.currentUser?.uid;
  const myPlayer = uid ? room?.players?.[uid] : undefined;
  const gameBoard = room?.board;
  const size = room ? LEVELS[room.difficulty].size : 0;
  const mineCount = room ? LEVELS[room.difficulty].mines : 0;

  useEffect(() => {
    const match = window.location.pathname.match(/\/room\/([^/]+)/);

    if (match) setRoomCode(match[1]);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    return listenToRoom(roomId, (updatedRoom) => {
      setRoom(updatedRoom);
    });
  }, [roomId]);

  useEffect(() => {
    if (!room || !uid) return;

    const player = room.players?.[uid];

    if (player) {
      setRevealed(player.revealed || {});
      setFlagged(player.flagged || {});
    }

    if (room.startedAt && player?.status === "playing") {
      const updateTime = () => {
        setSeconds(
          Math.floor((Date.now() - room.startedAt!) / 1000)
        );
      };

      updateTime();
      const timer = window.setInterval(updateTime, 1000);
      return () => window.clearInterval(timer);
    }
  }, [room, uid]);

  async function handleCreateRoom() {
    if (!name.trim()) {
      setError("Introdu numele tău.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const id = await createRoom(name, difficulty);
      setRoomId(id);
      setRoomCode(id);
      window.history.pushState({}, "", `/room/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la creare.");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!name.trim() || !roomCode.trim()) {
      setError("Introdu numele și codul camerei.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const id = roomCode.trim();
      await joinRoom(id, name);
      setRoomId(id);
      window.history.pushState({}, "", `/room/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la conectare.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (!roomId) return;

    setLoading(true);
    setError("");

    try {
      await startRoom(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la pornire.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProgress(
    nextRevealed: Marks,
    nextFlagged: Marks
  ) {
    if (!roomId || !gameBoard || !myPlayer) return;

    const safeCells = size * size - mineCount;
    const revealedCount = Object.values(nextRevealed).filter(Boolean).length;
    const progress = Math.min(
      100,
      Math.round((revealedCount / safeCells) * 100)
    );

    setRevealed(nextRevealed);
    setFlagged(nextFlagged);

    await savePlayerProgress(
      roomId,
      nextRevealed,
      nextFlagged,
      progress
    );
  }
async function handleRestart() {
  if (!roomId) return;

  setLoading(true);
  setError("");

  try {
    await restartRoom(roomId);
    setRevealed({});
    setFlagged({});
    setSeconds(0);
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Nu am putut reporni jocul."
    );
  } finally {
    setLoading(false);
  }
}
  async function revealCell(r: number, c: number) {
    if (!gameBoard || myPlayer?.status !== "playing") return;

    const cell = gameBoard[r][c];
    const id = key(r, c);

    if (revealed[id] || flagged[id]) return;

    const nextRevealed = { ...revealed };
    const nextFlagged = { ...flagged };

    if (cell.mine) {
      nextRevealed[id] = true;
      await saveProgress(nextRevealed, nextFlagged);
      await finishPlayer(roomId, "lost", seconds);
      return;
    }

    expandArea(
      gameBoard,
      nextRevealed,
      nextFlagged,
      r,
      c,
      size
    );

    const safeCells = size * size - mineCount;
    const count = Object.values(nextRevealed).filter(Boolean).length;

    await saveProgress(nextRevealed, nextFlagged);

    if (count >= safeCells) {
      await finishPlayer(roomId, "won", seconds);
    }
  }

  async function toggleFlag(
    event: React.MouseEvent<HTMLButtonElement>,
    r: number,
    c: number
  ) {
    event.preventDefault();

    if (myPlayer?.status !== "playing") return;

    const id = key(r, c);

    if (revealed[id]) return;

    const nextFlagged = { ...flagged };
    nextFlagged[id] = !nextFlagged[id];

    if (!nextFlagged[id]) delete nextFlagged[id];

    await saveProgress(revealed, nextFlagged);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/room/${roomId}`
      );
      alert("Link copiat!");
    } catch {
      setError("Nu am putut copia linkul.");
    }
  }

  const players = room
    ? Object.entries(room.players || {}).sort((a, b) => {
        const aOrder = a[1].finishOrder || 9999;
        const bOrder = b[1].finishOrder || 9999;

        if (a[1].status === "won" && b[1].status !== "won") return -1;
        if (b[1].status === "won" && a[1].status !== "won") return 1;

        return aOrder - bOrder;
      })
    : [];

  const isHost = room?.hostId === uid;
  const flagsCount = Object.values(flagged).filter(Boolean).length;
  // Fiecare jucător vede indiciul până la prima lui deschidere.
  const hasMadeFirstMove = Object.values(revealed).some(Boolean);

  const numberColors: Record<number, string> = {
    1: "#60a5fa",
    2: "#4ade80",
    3: "#f87171",
    4: "#a78bfa",
    5: "#fb923c",
    6: "#22d3ee",
    7: "#f9fafb",
    8: "#9ca3af",
  };

  if (roomId && room) {
    if (room.status === "lobby") {
      return (
        <main className="game multiplayer-game">
          <header className="game-header">
            <div>
              <p className="eyebrow">MULTIPLAYER</p>
              <h1>Minesweeper</h1>
            </div>
            <span className="room-badge">
              ROOM {roomId.toUpperCase()}
            </span>
          </header>

          <section className="lobby-panel">
            <h2>Waiting Room</h2>
            <p>Invită prietenii cu linkul camerei.</p>

            <div className="invite-link">
              <span>{window.location.origin}/room/{roomId}</span>
              <button onClick={copyLink}>Copy link</button>
            </div>

            <h3>Players ({players.length})</h3>

            <div className="players-list">
              {players.map(([id, player]) => (
                <div className="player-item" key={id}>
                  <span>
                    {id === room.hostId ? "👑" : "🎮"} {player.name}
                  </span>
                  <span className="player-status">
                    {id === room.hostId ? "HOST" : "READY"}
                  </span>
                </div>
              ))}
            </div>

            {isHost && (
              <button
                className="start-game-button"
                onClick={handleStart}
                disabled={loading}
              >
                START GAME
              </button>
            )}

            {!isHost && (
              <p className="waiting-message">
                Așteptăm ca gazda să pornească jocul...
              </p>
            )}
            {error && <p className="multiplayer-error">{error}</p>}
          </section>
        </main>
      );
    }

    if (!gameBoard || !myPlayer) {
      return <main className="game"><h2>Se încarcă jocul...</h2></main>;
    }

    const finishedCount = players.filter(
      ([, player]) => player.status === "won" || player.status === "lost"
    ).length;

    return (
      <main className="game multiplayer-game">
        <header className="game-header">
          <div>
            <p className="eyebrow">MULTIPLAYER ROOM</p>
            <h1>Minesweeper</h1>
          </div>
          <span className="room-badge">{roomId.toUpperCase()}</span>
        </header>

        <section className="stats">
          <div className="stat">
            <span>💣</span>
            <strong>{String(mineCount - flagsCount).padStart(2, "0")}</strong>
            <small>MINES</small>
          </div>
          <div className="stat">
            <span>⏱️</span>
            <strong>
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </strong>
            <small>TIME</small>
          </div>
        </section>

        <section className="board-zoom-control">
          <label htmlFor="board-zoom">
            Dimensiunea tablei: <strong>{boardZoom}%</strong>
          </label>
          <div className="board-zoom-row">
            <span aria-hidden="true">−</span>
            <input
              id="board-zoom"
              type="range"
              min="70"
              max="150"
              step="5"
              value={boardZoom}
              onChange={(event) => setBoardZoom(Number(event.target.value))}
            />
            <span aria-hidden="true">+</span>
          </div>
          <div className="board-zoom-labels">
            <span>Mai mică</span>
            <span>Mai mare</span>
          </div>
        </section>

        <div className="multiplayer-layout">
          <div
            className={`board ${room.difficulty}`}
            style={{
              gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
              zoom: boardZoom / 100,
            }}
          >
            {gameBoard.map((row, r) =>
              row.map((cell, c) => {
                const id = key(r, c);
                const isRevealed = !!revealed[id];
                const isFlagged = !!flagged[id];

                return (
                  <button
                    key={id}
                    className={`cell ${isRevealed ? "revealed" : ""} ${
                      room.safeStart &&
                      !hasMadeFirstMove &&
                      room.safeStart.r === r &&
                      room.safeStart.c === c
                        ? "safe-start"
                        : ""
                    }`}
                    disabled={myPlayer.status !== "playing"}
                    onClick={() => revealCell(r, c)}
                    onContextMenu={(event) => toggleFlag(event, r, c)}
                  >
                    {isFlagged && !isRevealed
                      ? "🚩"
                      : isRevealed && cell.mine
                      ? "💣"
                      : isRevealed && cell.adjacent > 0
                      ? (
                          <span style={{ color: numberColors[cell.adjacent] }}>
                            {cell.adjacent}
                          </span>
                        )
                      : ""}
                  </button>
                );
              })
            )}
          </div>

          <aside className="leaderboard">
            <h3>🏆 LIVE LEADERBOARD</h3>

            {players.map(([id, player], index) => (
              <div className="leader-player" key={id}>
                <strong>
                  {player.status === "won"
                    ? `🥇 ${player.name}`
                    : `${index + 1}. ${player.name}`}
                </strong>

                <span>
                  {player.status === "won"
                    ? `WON · ${player.finishTime ?? 0}s`
                    : player.status === "lost"
                    ? "💥 LOST"
                    : `${player.progress || 0}%`}
                </span>

                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${player.progress || 0}%` }}
                  />
                </div>
              </div>
            ))}
          </aside>
        </div>

        <footer className="game-footer">
          <span>
            {myPlayer.status === "won"
              ? "🏆 You won!"
              : myPlayer.status === "lost"
              ? "💥 You lost!"
              : "Discover all safe cells"}
          </span>
          <span>
            {finishedCount}/{players.length} finished
          </span>
        </footer>

        
{room.status === "finished" && (
  <section className="lobby-panel final-results">
    <h2>🏆 FINAL RESULTS</h2>

    {players
      .filter(([, player]) => player.status === "won")
      .sort(
        (a, b) =>
          (a[1].finishOrder || 9999) -
          (b[1].finishOrder || 9999)
      )
      .map(([id, player]) => (
        <div className="player-item" key={id}>
          <strong>
            {player.finishOrder === 1
              ? "🥇"
              : player.finishOrder === 2
              ? "🥈"
              : player.finishOrder === 3
              ? "🥉"
              : `#${player.finishOrder}`}{" "}
            {player.name}
          </strong>
          <span>
            {Math.floor((player.finishTime || 0) / 60)}:
            {String((player.finishTime || 0) % 60).padStart(2, "0")}
          </span>
        </div>
      ))}

    {players
      .filter(([, player]) => player.status === "lost")
      .map(([id, player]) => (
        <div className="player-item" key={id}>
          <span>💥 {player.name}</span>
          <span>LOST</span>
        </div>
      ))}

    {isHost && (
      <button
        className="start-game-button"
        onClick={handleRestart}
        disabled={loading}
      >
        {loading ? "PLEASE WAIT..." : "🔄 PLAY AGAIN"}
      </button>
    )}

    {!isHost && (
      <p className="waiting-message">
        Waiting for the host to start another game...
      </p>
    )}
  </section>
)}

      </main>
    );
  }

  return (
    <main className="game multiplayer-game">
      <header className="game-header">
        <div>
          <p className="eyebrow">CLASSIC PUZZLE</p>
          <h1>Minesweeper</h1>
        </div>
      </header>

      <section className="lobby-panel">
        <p className="eyebrow">MULTIPLAYER</p>
        <h2>Play with friends</h2>

        <label>Your name</label>
        <input
          className="lobby-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Enter your name"
          maxLength={20}
        />

        <label>Difficulty</label>
        <select
          value={difficulty}
          onChange={(event) =>
            setDifficulty(event.target.value as Difficulty)
          }
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>

        <button
          className="start-game-button"
          onClick={handleCreateRoom}
          disabled={loading}
        >
          CREATE ROOM
        </button>

        <div className="lobby-divider">OR JOIN FRIENDS</div>

        <label>Room code</label>
        <input
          className="lobby-input"
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value)}
          placeholder="Enter room code"
        />

        <button
          className="join-game-button"
          onClick={handleJoinRoom}
          disabled={loading}
        >
          JOIN ROOM
        </button>

        {error && <p className="multiplayer-error">{error}</p>}
      </section>
    </main>
  );
}
