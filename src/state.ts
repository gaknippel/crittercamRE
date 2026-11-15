// App state: settings and key bindings (saved in localStorage, pushed to the script on every change), and what the script reports back.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BINDINGS, Binding, GameState, SETTINGS, SettingValue } from "./protocol";

const STORAGE_KEY = "re4cam.v1";

type Saved = { settings: Record<string, SettingValue>; bindings: Record<string, Binding> };

export const defaultSettings = () => Object.fromEntries(Object.values(SETTINGS).map((d) => [d.id, d.fallback])) as Record<string, SettingValue>;
export const defaultBindings = () =>
  Object.fromEntries(BINDINGS.map((b) => [b.id, { vk: b.fallback, alt: false, ctrl: false, shift: false }])) as Record<string, Binding>;

function load(): Saved {
  let saved: Partial<Saved> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // corrupt or blocked storage: start from defaults
  }
  return { settings: { ...defaultSettings(), ...saved.settings }, bindings: { ...defaultBindings(), ...saved.bindings } };
}

// from the rust side: is re4 running, is our script in its autorun folder (and the same as the one in this app), its last state file
type RawStatus = { game_running: boolean; script_installed: boolean; script_current: boolean; script_version: string; state: string | null };
export type Status = RawStatus & { live: boolean };
export type Toast = { text: string; seq: number };

export function useReCam() {
  const [saved, setSaved] = useState(load);
  const [status, setStatus] = useState<Status>({ game_running: false, script_installed: false, script_current: false, script_version: "", state: null, live: false });
  const [game, setGame] = useState<GameState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef({ t: -1, changedAt: 0, note: -1, boot: -1 });
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // to whichever game is running; that game's script also reads the last file when it loads
  const push = useCallback(() => {
    invoke("write_cmd", { json: JSON.stringify({ seq: Date.now(), ...savedRef.current }) }).catch(() => {}); // no game: pushed when a script shows up
  }, []);

  // persist + push on every change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // storage unavailable: settings just won't persist
    }
    push();
  }, [saved, push]);

  const toast = useCallback((text: string) => {
    const t = { text, seq: Date.now() + Math.random() };
    setToasts((x) => [...x.slice(-3), t]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.seq !== t.seq)), 2800);
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      invoke<RawStatus>("status")
        .then((s) => {
          if (!alive) return;
          let g: GameState | null = null;
          try {
            g = s.state ? JSON.parse(s.state) : null;
          } catch {
            // caught it mid-write: keep the last one
            return;
          }
          const now = Date.now();
          const k = seen.current;
          // a script (re)started, maybe in another game than the one we last wrote to: give it the settings
          if (g && g.boot !== k.boot) {
            k.boot = g.boot;
            push();
          }
          if (g && g.t !== k.t) {
            k.t = g.t;
            k.changedAt = now;
          }
          if (g?.note && g.note.n !== k.note) {
            if (k.note !== -1) toast(g.note.text); // skip the one that was already there when we started
            k.note = g.note.n;
          }
          setGame(g);
          setStatus({ ...s, live: s.game_running && now - k.changedAt < 2000 });
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 250);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [toast, push]);

  const setSetting = (id: string, value: SettingValue) => setSaved((s) => ({ ...s, settings: { ...s.settings, [id]: value } }));
  const setBinding = (id: string, binding: Binding) => setSaved((s) => ({ ...s, bindings: { ...s.bindings, [id]: binding } }));
  const resetBindings = () => setSaved((s) => ({ ...s, bindings: defaultBindings() }));
  const install = () => invoke("install_script");

  return { ...saved, status, game, toasts, setSetting, setBinding, resetBindings, install };
}
