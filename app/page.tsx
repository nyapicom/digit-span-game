"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_INITIAL_LENGTH = 3;
const MIN_INITIAL_LENGTH = 2;
const MAX_INITIAL_LENGTH = 9;
const MAX_HP = 3;
const SUCCESS_STREAK_FOR_LEVEL_UP = 2;
const AUTO_ADVANCE_DELAY_SUCCESS = 1600;
const AUTO_ADVANCE_DELAY_FAIL = 2000;
const BASE_REVEAL_MS = 900;
const REVEAL_STEP_MS = 40;
const MIN_REVEAL_MS = 380;
const DIGIT_TONE_DURATION = 0.2;
const DIGIT_TONE_FREQUENCY = 880;
const DIGIT_TONE_PEAK = 0.2;
const INITIAL_LENGTH_COOKIE = "digit-span-initial-length";

type Phase = "title" | "memorize" | "input" | "result" | "gameover";
type RoundResult = "success" | "fail" | null;

const clampInitialLength = (value: number) =>
  Math.min(MAX_INITIAL_LENGTH, Math.max(MIN_INITIAL_LENGTH, value));

const calculateRevealDuration = (round: number) => {
  const reduced = BASE_REVEAL_MS - (round - 1) * REVEAL_STEP_MS;
  return Math.max(MIN_REVEAL_MS, reduced);
};

const pickRandomSequence = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10));

export default function Home() {
  const [phase, setPhase] = useState<Phase>("title");
  const [initialLength, setInitialLength] = useState(DEFAULT_INITIAL_LENGTH);
  const [currentLength, setCurrentLength] = useState(DEFAULT_INITIAL_LENGTH);
  const [round, setRound] = useState(1);
  const [sequence, setSequence] = useState<number[]>([]);
  const [visibleDigit, setVisibleDigit] = useState<number | null>(null);
  const [hp, setHp] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [result, setResult] = useState<RoundResult>(null);
  const [revealMs, setRevealMs] = useState(BASE_REVEAL_MS);
  const [successStreak, setSuccessStreak] = useState(0);

  const timers = useRef<NodeJS.Timeout[]>([]);
  const autoAdvanceTimer = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasHydratedInitialLength = useRef(false);

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
    if (typeof document === "undefined") {
      return;
    }

    const match = document.cookie.match(
      new RegExp(`${INITIAL_LENGTH_COOKIE}=([^;]+)`)
    );
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (!Number.isNaN(parsed)) {
        const clamped = clampInitialLength(parsed);
        setInitialLength(clamped);
        setCurrentLength(clamped);
      }
    }
    hasHydratedInitialLength.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydratedInitialLength.current || typeof document === "undefined") {
      return;
    }

    const maxAgeSeconds = 60 * 60 * 24 * 365;
    document.cookie = `${INITIAL_LENGTH_COOKIE}=${initialLength}; max-age=${maxAgeSeconds}; path=/`;
  }, [initialLength]);

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

  const beginRound = useCallback(
    ({
      nextLength,
      nextHp,
      nextRound
    }: {
      nextLength: number;
      nextHp: number;
      nextRound: number;
    }) => {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }

      timers.current.forEach(clearTimeout);
      timers.current = [];

      setSequence(pickRandomSequence(nextLength));
      setUserInput("");
      setResult(null);
      setVisibleDigit(null);
      setRevealMs(calculateRevealDuration(nextRound));
      setCurrentLength(nextLength);
      setRound(nextRound);
      setHp(nextHp);
      setPhase("memorize");
    },
    []
  );

  useEffect(() => {
    if (phase !== "memorize" || sequence.length === 0) {
      return;
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

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [phase, revealMs, sequence, playDigitCue]);

  useEffect(() => {
    if (phase !== "result" || result === null) {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
      return;
    }

    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
    }

    const delay =
      result === "success" ? AUTO_ADVANCE_DELAY_SUCCESS : AUTO_ADVANCE_DELAY_FAIL;

    autoAdvanceTimer.current = setTimeout(() => {
      if (result === "success") {
        const nextRound = round + 1;
        const nextStreak = successStreak + 1;
        const shouldLevelUp = nextStreak >= SUCCESS_STREAK_FOR_LEVEL_UP;
        const nextLength = shouldLevelUp ? currentLength + 1 : currentLength;

        setSuccessStreak(shouldLevelUp ? 0 : nextStreak);
        beginRound({
          nextLength,
          nextHp: hp,
          nextRound
        });
      } else if (result === "fail" && hp > 0) {
        const nextRound = round + 1;
        const loweredLength = Math.max(1, currentLength - 1);
        setSuccessStreak(0);
        beginRound({
          nextLength: loweredLength,
          nextHp: hp,
          nextRound
        });
      }
    }, delay);

    return () => {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
    };
  }, [phase, result, hp, round, currentLength, successStreak, beginRound]);

  const reversedAnswer = useMemo(
    () => sequence.slice().reverse().join(""),
    [sequence]
  );

  const handleInitialLengthChange = (value: number) => {
    const clamped = clampInitialLength(value);
    setInitialLength(clamped);
    if (phase === "title") {
      setCurrentLength(clamped);
    }
  };

  const startGame = () => {
    const startLength = clampInitialLength(initialLength);
    setSuccessStreak(0);
    setRound(1);
    setResult(null);
    setUserInput("");
    setHp(MAX_HP);
    void ensureAudioContext();
    beginRound({
      nextLength: startLength,
      nextHp: MAX_HP,
      nextRound: 1
    });
  };

  const evaluateAnswer = (input: string) => {
    if (phase !== "input") {
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
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }

    setPhase("title");
    setSequence([]);
    setVisibleDigit(null);
    setUserInput("");
    setResult(null);
    setHp(0);
    setRound(1);
    setSuccessStreak(0);
    setCurrentLength(initialLength);
    setRevealMs(BASE_REVEAL_MS);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold text-sky-300 sm:text-4xl">逆順復唱ゲーム</h1>
        <p className="text-sm text-slate-400 sm:text-base">
          表示された数字を覚えて、逆順に入力しよう。HPが0になる前にできるだけ多くのラウンドを突破しよう。
        </p>
      </header>

      {phase === "title" && (
        <section className="space-y-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
          <div className="space-y-2 text-center">
            <h2 className="text-lg font-semibold text-slate-200">初期難易度を設定</h2>
            <p className="text-sm text-slate-400">
              最初に表示される数字の個数をスライドバーで選べます。設定はブラウザに保存されます。
            </p>
          </div>
          <div className="flex flex-col items-center gap-4">
            <input
              className="w-full accent-sky-400"
              type="range"
              min={MIN_INITIAL_LENGTH}
              max={MAX_INITIAL_LENGTH}
              value={initialLength}
              onChange={(event) =>
                handleInitialLengthChange(Number.parseInt(event.target.value, 10))
              }
            />
            <div className="text-sm text-slate-300">
              初期桁数:{" "}
              <span className="text-xl font-semibold text-sky-300">{initialLength}</span>
            </div>
          </div>
          <button
            className="w-full rounded-md bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            onClick={startGame}
          >
            ゲームスタート
          </button>
        </section>
      )}

      {phase !== "title" && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/70 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">現在の桁数</div>
              <div className="text-lg font-semibold text-slate-200">{currentLength}</div>
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
                    style={{ width: `${(hp / MAX_HP) * 100}%` }}
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
                覚えた数字を逆順に入力してください（連続成功で桁数が増えます）
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
              <p className="text-sm text-emerald-200">
                連続成功で次のラウンドの桁数が1つ増えます。
              </p>
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
                難易度を1段下げて再挑戦します。
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

