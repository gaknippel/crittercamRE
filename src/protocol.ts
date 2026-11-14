// Settings and key bindings, sent as json to lua/recam.lua. Same units and defaults as crittercam.

export type FloatSetting = {
  kind: "float"; id: string; label: string; hint: string;
  min: number; max: number; decimals: number; log?: boolean; fallback: number;
};
export type ChoiceSetting = { kind: "choice"; id: string; label: string; hint: string; options: string[]; fallback: number };
export type BoolSetting = { kind: "bool"; id: string; label: string; hint: string; fallback: boolean };
export type SettingDef = FloatSetting | ChoiceSetting | BoolSetting;
export type SettingValue = number | boolean;

const defs: SettingDef[] = [
  { kind: "float", id: "movementSpeed", label: "movement speed", hint: "base flying speed", min: 0.001, max: 0.5, decimals: 3, log: true, fallback: 0.05 },
  { kind: "float", id: "rotationSpeed", label: "look speed", hint: "keys, sticks and mouse", min: 0.001, max: 0.5, decimals: 3, log: true, fallback: 0.01 },
  { kind: "float", id: "fastMultiplier", label: "fast multiplier", hint: "hold alt, or y on a pad", min: 0.1, max: 100, decimals: 2, log: true, fallback: 5 },
  { kind: "float", id: "slowMultiplier", label: "slow multiplier", hint: "hold ctrl, or x on a pad", min: 0.001, max: 1, decimals: 3, log: true, fallback: 0.1 },
  { kind: "float", id: "upMultiplier", label: "up / down multiplier", hint: "relative to movement speed", min: 0.1, max: 10, decimals: 2, log: true, fallback: 0.7 },
  { kind: "float", id: "fovSpeed", label: "zoom speed", hint: "keys and mouse wheel", min: 0.01, max: 1, decimals: 2, fallback: 0.3 },
  { kind: "choice", id: "controlDevice", label: "camera control", hint: "the other device keeps playing the character", options: ["keyboard & mouse", "controller", "both"], fallback: 0 },
  { kind: "bool", id: "invertY", label: "invert look up / down", hint: "", fallback: false },
];
export const SETTINGS: Record<string, SettingDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export type Binding = { vk: number; alt: boolean; ctrl: boolean; shift: boolean };
export type BindingDef = { id: string; label: string; group: string; fallback: number };

// crittercam's keys (hlae style, no numpad needed), camera only.
export const BINDINGS: BindingDef[] = [
  { id: "toggle", label: "camera on / off", group: "general", fallback: 45 },
  { id: "lock", label: "lock camera movement", group: "general", fallback: 145 },
  { id: "block", label: "block game input", group: "general", fallback: 8 },
  { id: "forward", label: "forward", group: "move", fallback: 87 },
  { id: "back", label: "back", group: "move", fallback: 83 },
  { id: "left", label: "left", group: "move", fallback: 65 },
  { id: "right", label: "right", group: "move", fallback: 68 },
  { id: "up", label: "up", group: "move", fallback: 82 },
  { id: "down", label: "down", group: "move", fallback: 70 },
  { id: "lookUp", label: "look up", group: "look", fallback: 38 },
  { id: "lookDown", label: "look down", group: "look", fallback: 40 },
  { id: "lookLeft", label: "look left", group: "look", fallback: 37 },
  { id: "lookRight", label: "look right", group: "look", fallback: 39 },
  { id: "tiltLeft", label: "tilt left", group: "look", fallback: 90 },
  { id: "tiltRight", label: "tilt right", group: "look", fallback: 88 },
  { id: "zoomIn", label: "zoom in", group: "lens", fallback: 33 },
  { id: "zoomOut", label: "zoom out", group: "lens", fallback: 34 },
  { id: "zoomReset", label: "reset zoom", group: "lens", fallback: 36 },
];

// what the script writes about 4 times a second. note: the last in game message, n counts up per message.
export type GameState = { v?: string; boot: number; t: number; on: boolean; blocked: boolean; locked: boolean; fov?: number; note?: { n: number; text: string }; warn?: string };

// KeyboardEvent.code -> Windows virtual key code + label.
const KEYS: [string, number, string][] = [
  ["Backspace", 8, "Backspace"], ["Tab", 9, "Tab"], ["Enter", 13, "Enter"], ["Pause", 19, "Pause"], ["CapsLock", 20, "Caps Lock"],
  ["Space", 32, "Space"], ["PageUp", 33, "Page Up"], ["PageDown", 34, "Page Down"], ["End", 35, "End"], ["Home", 36, "Home"],
  ["ArrowLeft", 37, "←"], ["ArrowUp", 38, "↑"], ["ArrowRight", 39, "→"], ["ArrowDown", 40, "↓"], ["PrintScreen", 44, "Print Screen"],
  ["Insert", 45, "Insert"], ["Delete", 46, "Delete"], ["ScrollLock", 145, "Scroll Lock"],
  ["Semicolon", 186, ";"], ["Equal", 187, "="], ["Comma", 188, ","], ["Minus", 189, "-"], ["Period", 190, "."], ["Slash", 191, "/"],
  ["Backquote", 192, "`"], ["BracketLeft", 219, "["], ["Backslash", 220, "\\"], ["BracketRight", 221, "]"], ["Quote", 222, "'"],
  ["NumpadMultiply", 106, "Num *"], ["NumpadAdd", 107, "Num +"], ["NumpadSubtract", 109, "Num -"], ["NumpadDecimal", 110, "Num ."], ["NumpadDivide", 111, "Num /"],
];
for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); KEYS.push([`Key${c}`, 65 + i, c]); }
for (let i = 0; i < 10; i++) { KEYS.push([`Digit${i}`, 48 + i, `${i}`], [`Numpad${i}`, 96 + i, `Num ${i}`]); }
for (let i = 1; i <= 24; i++) KEYS.push([`F${i}`, 111 + i, `F${i}`]);

const VK_BY_CODE = new Map(KEYS.map(([code, vk]) => [code, vk]));
const LABEL_BY_VK = new Map(KEYS.map(([, vk, label]) => [vk, label]));

export const vkFromCode = (code: string) => VK_BY_CODE.get(code);
export const keyLabel = (vk: number) => LABEL_BY_VK.get(vk) ?? `Key ${vk}`;
