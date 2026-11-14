import { useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CameraIcon, KeyboardIcon, MinusIcon, XIcon, SunIcon, MoonIcon, DesktopIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import logo from "./assets/logo.png";
import { useReCam, Status } from "./state";
import { useTheme, Theme } from "./theme";
import { BINDINGS, Binding, FloatSetting, GameState, SETTINGS } from "./protocol";
import { ChoiceRow, KeyCapture, SliderRow, SwitchRow } from "./controls";

type Page = "camera" | "keys";
type App = ReturnType<typeof useReCam>;

const PAGES: { id: Page; label: string; icon: typeof CameraIcon }[] = [
  { id: "camera", label: "camera", icon: CameraIcon },
  { id: "keys", label: "keys", icon: KeyboardIcon },
];

export default function App() {
  const app = useReCam();
  const [theme, setTheme] = useTheme();
  const [page, setPage] = useState<Page>("camera");

  return (
    <div className="grid h-screen grid-cols-[232px_1fr] grid-rows-[36px_1fr] bg-background text-foreground">
      <TitleBar />
      <aside className="flex min-h-0 flex-col gap-4 border-r border-r-(--bevel-lo) bg-linear-to-b from-(--bar-to)/40 to-transparent p-3 shadow-[inset_-1px_0_0_var(--bevel-hi)]">
        <div className="flex items-center gap-3 px-1 pt-1">
          <img src={logo} alt="" className="size-9" />
          <div>
            <div className="font-heading text-base">re cam</div>
            <div className="text-[11px] text-muted-foreground">resident evil 2 & 4</div>
          </div>
        </div>
        <StatusCard status={app.status} game={app.game} install={app.install} />
        <nav className="flex flex-col gap-0.5">
          {PAGES.map(({ id, label, icon: Icon }) => (
            <Button key={id} variant={page === id ? "secondary" : "ghost"} className="justify-start gap-3" onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined}>
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(v) => v && setTheme(v as Theme)} aria-label="theme" className="w-full">
            <ToggleGroupItem value="light" className="flex-1" aria-label="light"><SunIcon /></ToggleGroupItem>
            <ToggleGroupItem value="dark" className="flex-1" aria-label="dark"><MoonIcon /></ToggleGroupItem>
            <ToggleGroupItem value="system" className="flex-1" aria-label="system"><DesktopIcon /></ToggleGroupItem>
          </ToggleGroup>
          <div className="px-1 text-[11px] text-muted-foreground">runs on reframework</div>
        </div>
      </aside>
      <main className="min-h-0 overflow-y-auto p-6">
        {page === "camera" && <CameraPage app={app} />}
        {page === "keys" && <KeysPage app={app} />}
      </main>
      <div className="pointer-events-none fixed right-5 bottom-5 flex flex-col items-end gap-2" aria-live="polite">
        {app.toasts.map((t) => (
          <div key={t.seq} className="panel px-3 py-2 text-sm shadow-md">{t.text}</div>
        ))}
      </div>
    </div>
  );
}

function TitleBar() {
  const win = getCurrentWindow();
  return (
    <header className="metal-bar col-span-2 flex items-center justify-between pl-3 text-xs text-foreground" data-tauri-drag-region>
      <span className="font-heading" data-tauri-drag-region>re cam</span>
      <div className="flex h-full">
        <button className="grid h-full w-11 place-items-center hover:bg-white/10" onClick={() => win.minimize()} aria-label="minimize"><MinusIcon /></button>
        <button className="grid h-full w-11 place-items-center hover:bg-destructive hover:text-white" onClick={() => win.close()} aria-label="close"><XIcon /></button>
      </div>
    </header>
  );
}

const STATES = {
  on: { title: "camera on", sub: "free cam is flying", dot: "bg-green-500" },
  live: { title: "camera ready", sub: "press your camera key in game", dot: "bg-green-500" },
  reset: { title: "script installed", sub: "reframework menu → scriptrunner → reset scripts", dot: "bg-yellow-500" },
  stale: { title: "old script still running", sub: "reframework menu → scriptrunner → reset scripts", dot: "bg-yellow-500" },
  outdated: { title: "script is outdated", sub: "update it, then reset scripts in reframework", dot: "bg-yellow-500" },
  ready: { title: "game running", sub: "install the camera script", dot: "bg-yellow-500" },
  waiting: { title: "waiting for game", sub: "start re2 or re4 with reframework", dot: "bg-muted-foreground/50" },
};

function StatusCard({ status, game, install }: { status: Status; game: GameState | null; install: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = !status.game_running ? "waiting" : !status.script_installed ? "ready" : !status.script_current ? "outdated" : !status.live ? "reset" : game?.v !== status.script_version ? "stale" : game?.on ? "on" : "live";
  const s = STATES[state];
  const run = () => {
    setBusy(true);
    setError("");
    install().catch((e) => setError(String(e))).finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-3 rounded-md bevel-out bg-card p-3 shadow-[0_0_0_1px_var(--bevel-lo)]">
      <div className="flex items-center gap-3">
        <span className={cn("size-2.5 shrink-0 rounded-full shadow-[inset_0_1px_1px_#fff8,0_0_0_1px_#0008]", s.dot)} />
        <div>
          <div className="text-sm font-medium">{s.title}</div>
          <div className="text-xs text-muted-foreground">{s.sub}</div>
        </div>
      </div>
      {(state === "ready" || state === "outdated" || state === "waiting") && (
        <Button variant="outline" disabled={state === "waiting" || busy} onClick={run}>
          {busy ? "installing…" : state === "outdated" ? "update script" : "install script"}
        </Button>
      )}
      {status.live && game?.v === status.script_version && (
        <div className="flex gap-1.5 text-[11px]">
          <span className={cn("rounded px-1.5 py-0.5", game.blocked ? "pill" : "text-muted-foreground")}>input blocked</span>
          <span className={cn("rounded px-1.5 py-0.5", game.locked ? "pill" : "text-muted-foreground")}>locked</span>
          {game.on && game.fov !== undefined && <span className="ml-auto py-0.5 tabular-nums text-muted-foreground">fov {game.fov.toFixed(1)}</span>}
        </div>
      )}
      {game?.warn && <p className="text-xs text-destructive">{game.warn}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PageHeader({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-4 gap-0 py-0">
      <CardHeader className="border-b py-2 [.border-b]:pb-2">
        <CardTitle className="text-xs tracking-[0.2em] text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  );
}

function SliderFor({ app, id }: { app: App; id: string }) {
  return <SliderRow def={SETTINGS[id] as FloatSetting} value={app.settings[id] as number} onChange={(v) => app.setSetting(id, v)} />;
}

function SwitchFor({ app, id }: { app: App; id: string }) {
  const d = SETTINGS[id];
  return <SwitchRow label={d.label} hint={d.hint} value={app.settings[id] as boolean} onChange={(v) => app.setSetting(id, v)} />;
}

function CameraPage({ app }: { app: App }) {
  const device = SETTINGS.controlDevice;
  return (
    <>
      <PageHeader title="camera" sub="how the free cam moves! changes apply live" />
      <Section title="control">
        <ChoiceRow label={device.label} hint={device.hint} options={device.kind === "choice" ? device.options : []} value={app.settings.controlDevice as number} onChange={(v) => app.setSetting("controlDevice", v)} />
        <SwitchFor app={app} id="invertY" />
        <p className="py-3 text-xs text-muted-foreground">while the camera is on, game input from the camera's device is blocked (toggle with your block key). a controller playing your character moves it relative to the free cam.</p>
      </Section>
      <Section title="speed">
        <SliderFor app={app} id="movementSpeed" />
        <SliderFor app={app} id="rotationSpeed" />
        <SliderFor app={app} id="upMultiplier" />
        <SliderFor app={app} id="fastMultiplier" />
        <SliderFor app={app} id="slowMultiplier" />
      </Section>
      <Section title="lens">
        <SliderFor app={app} id="fovSpeed" />
      </Section>
    </>
  );
}

const comboKey = (b: Binding) => `${b.vk}|${+b.alt}|${+b.ctrl}|${+b.shift}`;

function KeysPage({ app }: { app: App }) {
  const conflicts = useMemo(() => {
    const byCombo = new Map<string, string[]>();
    BINDINGS.forEach((d) => {
      const k = comboKey(app.bindings[d.id]);
      byCombo.set(k, [...(byCombo.get(k) ?? []), d.label]);
    });
    return byCombo;
  }, [app.bindings]);
  const groups = [...new Set(BINDINGS.map((b) => b.group))];
  return (
    <>
      <PageHeader title="keys" sub="click a key, then press the new one. esc cancels. hold alt for fast, ctrl for slow.">
        <Button variant="outline" onClick={app.resetBindings}>reset to defaults</Button>
      </PageHeader>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-x-4">
        {groups.map((g) => (
          <Section title={g} key={g}>
            {BINDINGS.filter((b) => b.group === g).map((d) => {
              const others = (conflicts.get(comboKey(app.bindings[d.id])) ?? []).filter((l) => l !== d.label);
              return (
                <div key={d.id} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                  <span>{d.label}</span>
                  <KeyCapture binding={app.bindings[d.id]} onChange={(b) => app.setBinding(d.id, b)} conflict={others.join(", ") || undefined} />
                </div>
              );
            })}
          </Section>
        ))}
        <Section title="mouse">
          {[
            ["look", "move"],
            ["fly up / down, left / right", "hold left button + move"],
            ["fly forward / back, left / right", "hold right button + move"],
            ["tilt", "hold both buttons + move"],
            ["zoom", "wheel"],
          ].map(([what, how]) => (
            <div key={what} className="flex items-center justify-between gap-4 py-2 text-sm"><span>{what}</span><span className="text-xs text-muted-foreground">{how}</span></div>
          ))}
        </Section>
        <Section title="controller">
          {[
            ["move / look", "left / right stick"],
            ["up / down", "lt / rt"],
            ["fast / slow", "hold y / x"],
            ["tilt", "d-pad left / right"],
            ["zoom / reset", "d-pad up / down, b"],
          ].map(([what, how]) => (
            <div key={what} className="flex items-center justify-between gap-4 py-2 text-sm"><span>{what}</span><span className="text-xs text-muted-foreground">{how}</span></div>
          ))}
        </Section>
      </div>
    </>
  );
}
