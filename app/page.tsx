'use client';

import { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit 
} from 'firebase/firestore';
import { format, subDays, startOfDay } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  Settings, 
  Info, 
  History, 
  X, 
  Check, 
  ChevronRight, 
  RotateCcw, 
  Delete,
  User,
  LogOut,
  Lock
} from 'lucide-react';
import { generateDailyPuzzle, Puzzle } from '@/lib/puzzle-service';
import confetti from 'canvas-confetti';

// --- Types ---

interface UserProgress {
  userId: string;
  username: string;
  foundWords: string[];
  points: number;
  lastUpdated: number;
}

interface LeaderboardEntry {
  username: string;
  points: number;
  foundCount: number;
}

// --- Constants ---

const LEVELS = [
  { name: "Anfänger", minPercent: 0 },
  { name: "Fortgeschrittener", minPercent: 10 },
  { name: "Profi", minPercent: 25 },
  { name: "Experte", minPercent: 40 },
  { name: "Meister", minPercent: 55 },
  { name: "Genie", minPercent: 70 },
  { name: "Legende", minPercent: 85 },
  { name: "Königin", minPercent: 100 },
];

const INVITE_CODE = process.env.NEXT_PUBLIC_INVITE_CODE || "BIENE2024";

// --- Components ---

export default function SpellingBee() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('bee_user');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  });
  const [isAuthorized, setIsAuthorized] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('bee_auth') === 'true';
    }
    return false;
  });
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [yesterdayPuzzle, setYesterdayPuzzle] = useState<Puzzle | null>(null);
  const [foundWords, setFoundWords] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [shuffledLetters, setShuffledLetters] = useState<string[]>([]);

  const isFirebaseConfigured = !!db;

  // 1. Auth & Invite Check - Handled by useState initializers
  useEffect(() => {
    if (!isFirebaseConfigured) return;
  }, [isFirebaseConfigured]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured) {
      setMessage({ text: "Firebase ist nicht konfiguriert!", type: 'error' });
      return;
    }
    const username = (e.target as any).username.value.trim();
    const code = (e.target as any).code.value.trim();

    if (code !== INVITE_CODE) {
      setMessage({ text: "Ungültiger Einladungscode!", type: 'error' });
      return;
    }

    if (!username) {
      setMessage({ text: "Bitte gib einen Namen ein.", type: 'error' });
      return;
    }

    const newUser = { id: Math.random().toString(36).substr(2, 9), name: username };
    setUser(newUser);
    setIsAuthorized(true);
    localStorage.setItem('bee_user', JSON.stringify(newUser));
    localStorage.setItem('bee_auth', 'true');
    setMessage({ text: `Willkommen, ${username}!`, type: 'success' });
  };

  // 2. Fetch Puzzle
  useEffect(() => {
    if (!isAuthorized || !isFirebaseConfigured) return;

    const fetchPuzzles = async () => {
      try {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");

        // Try to get today's puzzle from Firestore or generate it
        const todayDoc = await getDoc(doc(db!, 'puzzles', todayStr));
        let todayData: Puzzle;

        if (todayDoc.exists()) {
          todayData = todayDoc.data() as Puzzle;
        } else {
          todayData = await generateDailyPuzzle(new Date());
          await setDoc(doc(db!, 'puzzles', todayStr), todayData);
        }
        setPuzzle(todayData);
        setShuffledLetters(todayData.outerLetters);

        // Try to get yesterday's puzzle
        const yesterdayDoc = await getDoc(doc(db!, 'puzzles', yesterdayStr));
        if (yesterdayDoc.exists()) {
          setYesterdayPuzzle(yesterdayDoc.data() as Puzzle);
        }
      } catch (error) {
        console.error("Error fetching puzzles:", error);
        setMessage({ text: "Fehler beim Laden des Rätsels.", type: 'error' });
      }
    };

    fetchPuzzles();
  }, [isAuthorized, isFirebaseConfigured]);

  // 3. Sync Progress with Firestore
  useEffect(() => {
    if (!isAuthorized || !user || !puzzle || !isFirebaseConfigured) return;

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const progressRef = doc(db!, 'progress', `${todayStr}_${user.id}`);

    const unsubscribe = onSnapshot(progressRef, (doc) => {
      if (doc.exists()) {
        setFoundWords(doc.data().foundWords || []);
      }
    });

    return () => unsubscribe();
  }, [isAuthorized, user, puzzle, isFirebaseConfigured]);

  // 4. Leaderboard Sync
  useEffect(() => {
    if (!isAuthorized || !puzzle || !isFirebaseConfigured) return;

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const q = query(
      collection(db!, 'progress'),
      where('date', '==', todayStr),
      orderBy('points', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map(doc => ({
        username: doc.data().username,
        points: doc.data().points,
        foundCount: doc.data().foundWords.length
      }));
      setLeaderboard(entries);
    });

    return () => unsubscribe();
  }, [isAuthorized, puzzle, isFirebaseConfigured]);

  // 5. Game Logic
  const calculatePoints = (word: string) => {
    if (!puzzle) return 0;
    let pts = word.length === 4 ? 1 : word.length;
    if (puzzle.pangrams.includes(word)) pts += 7;
    return pts;
  };

  const currentPoints = useMemo(() => {
    return foundWords.reduce((sum, word) => {
      if (!puzzle) return sum;
      let pts = word.length === 4 ? 1 : word.length;
      if (puzzle.pangrams.includes(word)) pts += 7;
      return sum + pts;
    }, 0);
  }, [foundWords, puzzle]);

  const currentLevel = useMemo(() => {
    if (!puzzle) return LEVELS[0];
    const percent = (currentPoints / puzzle.maxPoints) * 100;
    return [...LEVELS].reverse().find(l => percent >= l.minPercent) || LEVELS[0];
  }, [currentPoints, puzzle]);

  const nextLevel = useMemo(() => {
    const idx = LEVELS.findIndex(l => l.name === currentLevel.name);
    return LEVELS[idx + 1] || null;
  }, [currentLevel]);

  const handleSubmit = async () => {
    if (!puzzle || !user) return;
    const word = currentInput.toLowerCase().trim();
    setCurrentInput("");

    if (word.length < 4) {
      setMessage({ text: "Zu kurz!", type: 'error' });
      return;
    }
    if (!word.includes(puzzle.centerLetter)) {
      setMessage({ text: `Muss '${puzzle.centerLetter.toUpperCase()}' enthalten!`, type: 'error' });
      return;
    }
    if (foundWords.includes(word)) {
      setMessage({ text: "Bereits gefunden!", type: 'info' });
      return;
    }
    if (!puzzle.validWords.includes(word)) {
      setMessage({ text: "Nicht in der Liste!", type: 'error' });
      return;
    }

    // Success!
    const isPangram = puzzle.pangrams.includes(word);
    if (isPangram) {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
      });
      setMessage({ text: "PANGRAMM! 🎉", type: 'success' });
    } else {
      setMessage({ text: "Prima!", type: 'success' });
    }

    const newFoundWords = [...foundWords, word];
    const newPoints = newFoundWords.reduce((sum, w) => sum + calculatePoints(w), 0);

    const todayStr = format(new Date(), "yyyy-MM-dd");
    if (isFirebaseConfigured) {
      await setDoc(doc(db!, 'progress', `${todayStr}_${user.id}`), {
        userId: user.id,
        username: user.name,
        foundWords: newFoundWords,
        points: newPoints,
        date: todayStr,
        lastUpdated: Date.now()
      });
    }
  };

  const shuffleLetters = () => {
    setShuffledLetters([...shuffledLetters].sort(() => Math.random() - 0.5));
  };

  // 6. Message Auto-clear
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [message]);

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-stone-200"
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center shadow-inner">
              <Lock className="text-red-600 w-8 h-8" />
            </div>
          </div>
          <h1 className="text-3xl font-serif font-bold text-center mb-2 text-stone-800">Setup Erforderlich</h1>
          <p className="text-stone-500 text-center mb-8 text-sm">
            Bitte konfiguriere die Firebase-Umgebungsvariablen in den AI Studio Secrets, um das Spiel zu starten.
          </p>
          <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 text-xs font-mono text-stone-600 space-y-1">
            <p>NEXT_PUBLIC_FIREBASE_API_KEY</p>
            <p>NEXT_PUBLIC_FIREBASE_PROJECT_ID</p>
            <p>...</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full border border-stone-200"
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-yellow-400 rounded-2xl flex items-center justify-center shadow-inner">
              <Lock className="text-stone-800 w-8 h-8" />
            </div>
          </div>
          <h1 className="text-3xl font-serif font-bold text-center mb-2 text-stone-800">Buchstabier-Biene</h1>
          <p className="text-stone-500 text-center mb-8 text-sm">Bitte gib deinen Namen und den Einladungscode ein, um zu spielen.</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1 ml-1">Dein Name</label>
              <input 
                name="username"
                type="text" 
                placeholder="z.B. Biene Maja"
                className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1 ml-1">Einladungscode</label>
              <input 
                name="code"
                type="password" 
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none transition-all"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-stone-900 font-bold py-4 rounded-xl shadow-lg shadow-yellow-200 transition-all transform active:scale-95"
            >
              Spiel starten
            </button>
          </form>
          {message && (
            <p className={`mt-4 text-center text-sm font-medium ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {message.text}
            </p>
          )}
        </motion.div>
      </div>
    );
  }

  if (!puzzle) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-serif italic text-stone-500">Die Biene sammelt Buchstaben...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-stone-800 font-sans selection:bg-yellow-200">
      {/* Header */}
      <header className="max-w-2xl mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center shadow-sm">
            <span className="text-xl font-bold">B</span>
          </div>
          <div>
            <h1 className="text-xl font-serif font-bold leading-none">Buchstabier-Biene</h1>
            <p className="text-[10px] uppercase tracking-widest text-stone-400 font-bold">{format(new Date(), "d. MMMM yyyy")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowHistory(true)} className="p-2 hover:bg-stone-200 rounded-full transition-colors">
            <History className="w-5 h-5 text-stone-600" />
          </button>
          <button onClick={() => setShowLeaderboard(true)} className="p-2 hover:bg-stone-200 rounded-full transition-colors">
            <Trophy className="w-5 h-5 text-stone-600" />
          </button>
          <button onClick={() => {
            localStorage.removeItem('bee_auth');
            window.location.reload();
          }} className="p-2 hover:bg-stone-200 rounded-full transition-colors">
            <LogOut className="w-5 h-5 text-stone-600" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-24">
        {/* Progress Bar */}
        <div className="mb-12">
          <div className="flex justify-between items-end mb-2">
            <span className="text-lg font-serif font-bold">{currentLevel.name}</span>
            <span className="text-sm font-mono font-bold text-stone-400">{currentPoints} Pkt.</span>
          </div>
          <div className="h-2 bg-stone-200 rounded-full overflow-hidden flex">
            {LEVELS.map((l, i) => (
              <div 
                key={l.name}
                className={`h-full transition-all duration-500 ${currentPoints >= (l.minPercent / 100) * puzzle.maxPoints ? 'bg-yellow-400' : 'bg-transparent'}`}
                style={{ width: `${100 / LEVELS.length}%`, borderRight: i < LEVELS.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}
              />
            ))}
          </div>
          {nextLevel && (
            <p className="text-[10px] uppercase tracking-widest text-stone-400 mt-2 text-right">
              Noch {Math.ceil((nextLevel.minPercent / 100) * puzzle.maxPoints - currentPoints)} Pkt. bis {nextLevel.name}
            </p>
          )}
        </div>

        {/* Game Area */}
        <div className="flex flex-col items-center gap-8">
          {/* Input Display */}
          <div className="h-12 flex items-center justify-center">
            <AnimatePresence mode="wait">
              {message ? (
                <motion.div 
                  key="message"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`px-4 py-1 rounded-full text-sm font-bold ${
                    message.type === 'error' ? 'bg-red-100 text-red-600' : 
                    message.type === 'success' ? 'bg-green-100 text-green-600' : 
                    'bg-blue-100 text-blue-600'
                  }`}
                >
                  {message.text}
                </motion.div>
              ) : (
                <div className="text-4xl font-serif font-bold tracking-widest uppercase flex items-center">
                  {currentInput || <span className="text-stone-300">...</span>}
                  <motion.div 
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                    className="w-1 h-8 bg-yellow-400 ml-1"
                  />
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Hex Grid */}
          <div className="relative w-64 h-64">
            {/* Center Letter */}
            <button 
              onClick={() => setCurrentInput(prev => prev + puzzle.centerLetter)}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-yellow-400 rounded-2xl shadow-lg flex items-center justify-center text-2xl font-bold uppercase hover:scale-105 active:scale-95 transition-transform z-10"
            >
              {puzzle.centerLetter}
            </button>

            {/* Outer Letters */}
            {shuffledLetters.map((letter, i) => {
              const angle = (i * 60) * (Math.PI / 180);
              const radius = 85;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;

              return (
                <button
                  key={`${letter}-${i}`}
                  onClick={() => setCurrentInput(prev => prev + letter)}
                  className="absolute w-16 h-16 bg-white rounded-2xl shadow-md border border-stone-100 flex items-center justify-center text-xl font-bold uppercase hover:bg-stone-50 active:scale-95 transition-all"
                  style={{
                    top: `calc(50% + ${y}px)`,
                    left: `calc(50% + ${x}px)`,
                    transform: 'translate(-50%, -50%)'
                  }}
                >
                  {letter}
                </button>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex gap-4 w-full max-w-xs">
            <button 
              onClick={() => setCurrentInput(prev => prev.slice(0, -1))}
              className="flex-1 py-3 bg-white rounded-xl border border-stone-200 text-stone-600 font-bold flex items-center justify-center gap-2 hover:bg-stone-50 active:scale-95 transition-all"
            >
              <Delete className="w-4 h-4" /> Löschen
            </button>
            <button 
              onClick={shuffleLetters}
              className="p-3 bg-white rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 active:scale-95 transition-all"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button 
              onClick={handleSubmit}
              className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-stone-700 active:scale-95 transition-all"
            >
              Eingabe <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Found Words List */}
        <div className="mt-16">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-400">Gefundene Wörter ({foundWords.length})</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {foundWords.length === 0 ? (
              <p className="text-stone-400 italic text-sm">Noch keine Wörter gefunden...</p>
            ) : (
              foundWords.map(word => (
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  key={word} 
                  className={`px-3 py-1 rounded-lg text-sm font-medium border ${puzzle.pangrams.includes(word) ? 'bg-yellow-50 border-yellow-200 text-yellow-700 font-bold' : 'bg-white border-stone-200 text-stone-600'}`}
                >
                  {word}
                </motion.div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Leaderboard Modal */}
      <AnimatePresence>
        {showLeaderboard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLeaderboard(false)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-xl font-serif font-bold">Rangliste</h2>
                <button onClick={() => setShowLeaderboard(false)} className="p-2 hover:bg-stone-100 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                <div className="space-y-4">
                  {leaderboard.map((entry, i) => (
                    <div key={entry.username} className="flex items-center justify-between p-3 rounded-2xl bg-stone-50 border border-stone-100">
                      <div className="flex items-center gap-4">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${i === 0 ? 'bg-yellow-400 text-stone-900' : 'bg-stone-200 text-stone-500'}`}>
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-bold text-stone-800">{entry.username}</p>
                          <p className="text-[10px] uppercase tracking-wider text-stone-400">{entry.foundCount} Wörter</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-stone-800">{entry.points}</p>
                        <p className="text-[10px] uppercase tracking-wider text-stone-400">Punkte</p>
                      </div>
                    </div>
                  ))}
                  {leaderboard.length === 0 && (
                    <p className="text-center text-stone-400 py-8 italic">Noch keine Einträge heute.</p>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <h2 className="text-xl font-serif font-bold">Gestern</h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-stone-100 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                {yesterdayPuzzle ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3">Buchstaben</h3>
                      <div className="flex gap-2">
                        <span className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center font-bold uppercase">{yesterdayPuzzle.centerLetter}</span>
                        {yesterdayPuzzle.outerLetters.map(l => (
                          <span key={l} className="w-10 h-10 bg-stone-100 rounded-lg flex items-center justify-center font-bold uppercase text-stone-500">{l}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-3">Alle Wörter ({yesterdayPuzzle.validWords.length})</h3>
                      <div className="flex flex-wrap gap-2">
                        {yesterdayPuzzle.validWords.sort().map(word => (
                          <span key={word} className={`px-2 py-1 rounded text-xs ${yesterdayPuzzle.pangrams.includes(word) ? 'bg-yellow-100 text-yellow-700 font-bold' : 'bg-stone-50 text-stone-500'}`}>
                            {word}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-stone-400 py-8 italic">Keine Daten für gestern verfügbar.</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
