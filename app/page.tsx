"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DIFFICULTIES = [
  {
    id: "easy",
    label: "やさしい",
    description: "数字3個から開始、HP 5",
    startingLength: 3,
    startingHp: 5,
    initialRevealMs: 900
  },
  {
    id: "normal",
    label: "ふつう",
    description: "数字4個から開始、HP 4",
    startingLength: 4,
    startingHp: 4,
    initialRevealMs: 750
  },
  {
    id: "hard",
    label: "むずかしい",
    description: "数字5個から開始、HP 3",
    startingLength: 5,
    startingHp: 3,
    initialRevealMs: 650
  }
] as const;

const AUTO_ADVANCE_DELAY_SUCCESS = 1600;
const AUTO_ADVANCE_DELAY_FAIL = 2000;
const EASE_REVEAL_BONUS_MS = 120;
const DIGIT_TONE_DURATION = 0.2;
const DIGIT_TONE_FREQUENCY = 880;
const DIGIT_TONE_PEAK = 0.2;

type Difficulty = (typeof DIFFICULTIES)[number];

type Phase = "title" | "memorize" | "input" | "result" | "gameover";
type RoundResult = "success" | "fail" | null;

function pickRandomSequence(length: number): number[] {
  return Array.from({ length }, () => Math.floor(Math.random() * 10));
}

function clampRevealDuration(base: number, round: number) {
  const minRevealMs = 380;
  const step = 40;
  const reduced = base - (round - 1) * step;
  return Math.max(minRevealMs, reduced);
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("title");
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [round, setRound] = useState(1);
  const [sequence, setSequence] = useState<number[]>([]);
  const [visibleDigit, setVisibleDigit] = useState<number | null>(null);
  const [hp, setHp] = useState(0);
  const [maxHp, setMaxHp] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [result, setResult] = useState<RoundResult>(null);
  const [revealMs, setRevealMs] = useState(900);
  const [isEasedRound, setIsEasedRound] = useState(false);
  const timers = useRef<NodeJS.Timeout[]>([]);
  const autoAdvanceTimer = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const playDigitCue = useCallback(() => {
    const context = ensureAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(DIGIT_TONE_FREQUENCY, now);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(DIGIT_TONE_PEAK, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + DIGIT_TONE_DURATION);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + DIGIT_TONE_DURATION);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, [ensureAudioContext]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== "memorize" || sequence.length === 0) {
      return;
    }

    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }

    timers.current.forEach(clearTimeout);
    timers.current = [];
    setVisibleDigit(null);

    sequence.forEach((digit, index) => {
      const timer = setTimeout(() => {
        setVisibleDigit(digit);
        playDigitCue();
        if (index === sequence.length - 1) {
          const switchTimer = setTimeout(() => {
            setVisibleDigit(null);
            setPhase("input");
          }, revealMs);
          timers.current.push(switchTimer);
        }
      }, revealMs * index);
      timers.current.push(timer);
    });
  }, [phase, revealMs, sequence, playDigitCue]);

  useEffect(() => {
    if (phase !== "result" || !difficulty || result === null) {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
      return;
    }

    if (result === "fail" && hp <= 0) {
      return;
    }

    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
    }

    const delay =
      result === "success" ? AUTO_ADVANCE_DELAY_SUCCESS : AUTO_ADVANCE_DELAY_FAIL;

    autoAdvanceTimer.current = setTimeout(() => {
      if (!difficulty) {
        return;
      }

      if (result === "success") {
        const nextRound = isEasedRound ? round : round + 1;
        beginRound(difficulty, nextRound, hp);
      } else if (result === "fail" && hp > 0) {
        beginRound(difficulty, round, hp, { ease: true });
      }
    }, delay);

    return () => {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
    };
  }, [phase, result, difficulty, round, hp, isEasedRound]);

  const reversedAnswer = useMemo(
    () => sequence.slice().reverse().join(""),
    [sequence]
  );

  const startGame = (selected: Difficulty) => {
    setDifficulty(selected);
    setHp(selected.startingHp);
    setMaxHp(selected.startingHp);
    setRound(1);
    setRevealMs(selected.initialRevealMs);
    setResult(null);
    void ensureAudioContext();
    beginRound(selected, 1, selected.startingHp);
  };

  const beginRound = (
    selectedDifficulty: Difficulty,
    nextRound: number,
    nextHp: number,
    options?: { ease?: boolean }
  ) => {
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }

    const baseLength = selectedDifficulty.startingLength + nextRound - 1;
    const length = options?.ease
      ? Math.max(selectedDifficulty.startingLength, baseLength - 1)
      : baseLength;

    const baseReveal = clampRevealDuration(
      selectedDifficulty.initialRevealMs,
      nextRound
    );
    const revealDuration = options?.ease
      ? Math.min(
          selectedDifficulty.initialRevealMs,
          baseReveal + EASE_REVEAL_BONUS_MS
        )
      : baseReveal;

    setSequence(pickRandomSequence(length));
    setUserInput("");
    setResult(null);
    setVisibleDigit(null);
    setRevealMs(revealDuration);
    setRound(nextRound);
    setHp(nextHp);
    setIsEasedRound(Boolean(options?.ease));
    setPhase("memorize");
  };

  const evaluateAnswer = (input: string) => {
    if (phase !== "input" || !difficulty) {
      return;
    }

    if (input === reversedAnswer) {
      setResult("success");
      setPhase("result");
    } else {
      const nextHp = hp - 1;
      setHp(nextHp);
      setResult("fail");
      setPhase(nextHp <= 0 ? "gameover" : "result");
    }
  };

  const handleInputChange = (value: string) => {
    const sanitized = value.replace(/[^0-9]/g, "");
    setUserInput(sanitized);
    if (sanitized.length === sequence.length) {
      evaluateAnswer(sanitized);
    }
  };

  const handleRestart = () => {
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }

    setPhase("title");
    setDifficulty(null);
    setSequence([]);
    setVisibleDigit(null);
    setUserInput("");
    setResult(null);
    setHp(0);
    setMaxHp(0);
    setRound(1);
    setIsEasedRound(false);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold text-sky-300 sm:text-4xl">逆順復唱ゲーム</h1>
        <p className="text-sm text-slate-400 sm:text-base">
          表示された数字を覚えて、逆順に入力しよう。HPが0になる前に何ラウンド突破できるかな？
        </p>
      </header>

      {phase === "title" && (
        <section className="space-y-6">
          <h2 className="text-center text-lg font-semibold text-slate-200">
            難易度を選択
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {DIFFICULTIES.map((option) => (
              <button
                key={option.id}
                className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-left transition hover:border-sky-400 hover:bg-slate-800"
                onClick={() => startGame(option)}
              >
                <div className="text-xl font-bold text-sky-300">{option.label}</div>
                <p className="mt-2 text-sm text-slate-300">{option.description}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {phase !== "title" && difficulty && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/70 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">難易度</div>
              <div className="text-lg font-semibold text-slate-200">{difficulty.label}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">ラウンド</div>
              <div className="text-lg font-semibold text-slate-200">{round}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">HP</div>
              <div className="flex items-center gap-2">
                <div className="text-lg font-semibold text-slate-200">{hp}</div>
                <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all"
                    style={{ width: `${(hp / maxHp) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {phase === "memorize" && (
            <div className="flex flex-col items-center gap-6 rounded-xl border border-sky-500/40 bg-sky-500/10 p-10">
              <p className="text-sm text-sky-200">表示される数字を覚えてください</p>
              <div className="text-6xl font-black tracking-widest text-sky-200 sm:text-7xl">
                {visibleDigit !== null ? visibleDigit : ""}
              </div>
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {sequence.length}桁 / {Math.round(revealMs)}ms
              </div>
            </div>
          )}

          {phase === "input" && (
            <div className="flex flex-col items-center gap-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-8">
              <p className="text-sm text-emerald-200">
                覚えた数字を逆順に入力してください
              </p>
              <div className="text-xl text-slate-200">
                入力桁数: {userInput.length} / {sequence.length}
              </div>
              <input
                autoFocus
                className="w-full max-w-xs rounded-md border border-slate-700 bg-slate-950 p-3 text-center text-3xl tracking-[0.4em] text-slate-100 outline-none focus:border-emerald-400"
                value={userInput}
                onChange={(event) => handleInputChange(event.target.value)}
                inputMode="numeric"
                maxLength={sequence.length}
                placeholder="?"
              />
            </div>
          )}

          {phase === "result" && result === "success" && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-center">
              <h3 className="text-2xl font-bold text-emerald-300">成功！</h3>
              <p className="text-sm text-emerald-200">次はさらに長い数字に挑戦しよう。</p>
              <p className="text-xs text-emerald-100">
                少し待つと次のチャレンジへ自動で移行します。
              </p>
            </div>
          )}

          {phase === "result" && result === "fail" && hp > 0 && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-8 text-center">
              <h3 className="text-2xl font-bold text-rose-300">失敗...</h3>
              <p className="text-sm text-rose-200">
                正解は <span className="font-mono text-base text-rose-100">{reversedAnswer}</span> でした。
              </p>
              <p className="text-xs text-rose-200">
                難易度を少し緩めて自動で再挑戦します。
              </p>
            </div>
          )}

          {phase === "gameover" && (
            <div className="flex flex-col items-center gap-5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-10 text-center">
              <h3 className="text-3xl font-bold text-rose-300">ゲームオーバー</h3>
              <p className="text-sm text-rose-200">
                正解は <span className="font-mono text-base text-rose-100">{reversedAnswer}</span> でした。
              </p>
              <p className="text-xs uppercase tracking-wide text-rose-200">
                到達ラウンド {round}
              </p>
              <button
                className="rounded-full bg-slate-100 px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
                onClick={handleRestart}
              >
                タイトルに戻る
              </button>
            </div>
          )}

          {(phase === "result" || phase === "gameover") && result !== null && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
              <div className="font-semibold text-slate-200">今回の並び</div>
              <div className="mt-1 font-mono tracking-[0.4em] text-sky-200">
                {sequence.join(" ")}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                逆順の正解: <span className="font-mono text-sm text-emerald-200">{reversedAnswer}</span>
              </div>
            </div>
          )}

          <button
            className="self-start text-xs text-slate-500 underline hover:text-slate-300"
            onClick={handleRestart}
          >
            タイトルに戻る
          </button>
        </section>
      )}
    </main>
  );
}
