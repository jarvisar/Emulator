import { AudioOutput } from "./audio.js";
import { Buttons } from "./controller.js";
import { buildDiagnosticLog, buildStartupFailureLog } from "./diagnostics.js";
import { isTextEntryTarget } from "./input.js";
import { parseStoredList, recordRecent, selectLibraryGames } from "./library-state.js";
import { NES } from "./nes.js";

const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d", { alpha: false });
const image = context.createImageData(256, 240);
const romList = document.querySelector("#rom-list");
const search = document.querySelector("#search");
const gameCount = document.querySelector("#game-count");
const status = document.querySelector("#status");
const statusDot = document.querySelector("#status-dot");
const fpsLabel = document.querySelector("#fps");
const message = document.querySelector("#screen-message");
const pauseButton = document.querySelector("#pause");
const resetButton = document.querySelector("#reset");
const muteButton = document.querySelector("#mute");
const fullscreenButton = document.querySelector("#fullscreen");
const fileInput = document.querySelector("#file-input");
const screenFrame = document.querySelector("#screen-frame");
const randomButton = document.querySelector("#random-game");
const libraryTabs = [...document.querySelectorAll("[data-library-filter]")];
const favoriteCount = document.querySelector("#favorite-count");
const nowPlaying = document.querySelector("#now-playing");
const mapperReadout = document.querySelector("#mapper-readout");
const saveReadout = document.querySelector("#save-readout");
const displayModeButton = document.querySelector("#display-mode");
const displayLabel = document.querySelector("#display-label");
const screenshotButton = document.querySelector("#screenshot");
const diagnosticsButton = document.querySelector("#diagnostics");

const audio = new AudioOutput();
const keyMap = new Map([
  ["KeyZ", [0, Buttons.A]],
  ["KeyX", [0, Buttons.B]],
  ["ShiftLeft", [0, Buttons.SELECT]],
  ["ShiftRight", [0, Buttons.SELECT]],
  ["Enter", [0, Buttons.START]],
  ["ArrowUp", [0, Buttons.UP]],
  ["ArrowDown", [0, Buttons.DOWN]],
  ["ArrowLeft", [0, Buttons.LEFT]],
  ["ArrowRight", [0, Buttons.RIGHT]],
  ["KeyV", [1, Buttons.A]],
  ["KeyC", [1, Buttons.B]],
  ["KeyQ", [1, Buttons.SELECT]],
  ["KeyE", [1, Buttons.START]],
  ["KeyW", [1, Buttons.UP]],
  ["KeyS", [1, Buttons.DOWN]],
  ["KeyA", [1, Buttons.LEFT]],
  ["KeyD", [1, Buttons.RIGHT]],
]);

let games = [];
let visibleGames = [];
let emulator = null;
let diagnosticTarget = null;
let startupFailureLog = null;
let currentGame = null;
let currentFile = null;
let paused = true;
let muted = false;
let libraryFilter = "all";
let recentFiles = parseStoredList(localStorage.getItem("nes-recent"));
const favorites = new Set(parseStoredList(localStorage.getItem("nes-favorites")));
let lastAnimationTime = performance.now();
let frameAccumulator = 0;
let fpsFrames = 0;
let fpsStarted = performance.now();
let lastDisplayedFps = 0;
let previousGamepadButtons = [new Set(), new Set()];
const frameDuration = 1000 / 60.0988;
const maxCatchUpFrames = 6;
const displayModes = [
  { id: "pixel", button: "Pixel", label: "PIXEL DIRECT" },
  { id: "crt", button: "CRT", label: "CRT SCAN / RGB" },
  { id: "soft", button: "Composite", label: "COMPOSITE SOFT" },
];
let displayModeIndex = Math.max(
  0,
  displayModes.findIndex((mode) => mode.id === localStorage.getItem("nes-display-mode")),
);

function setButtonCaption(button, caption) {
  const label = button.querySelector("b");
  if (label) label.textContent = caption;
}

function setStatus(text, running = false) {
  status.textContent = text;
  statusDot.classList.toggle("running", running);
}

function showMessage(title, detail) {
  message.innerHTML = "";
  const heading = document.createElement("strong");
  const body = document.createElement("span");
  heading.textContent = title;
  body.textContent = detail;
  message.append(heading, body);
  message.classList.remove("hidden");
}

function saveKey(name) {
  return `nes-save:${name}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function persistSave() {
  if (!emulator?.cartridge.battery || !emulator.cartridge.saveDirty || !currentGame) return;
  localStorage.setItem(saveKey(currentGame), bytesToBase64(emulator.cartridge.prgRam));
  emulator.cartridge.saveDirty = false;
}

function restoreSave() {
  if (!emulator?.cartridge.battery || !currentGame) return;
  const encoded = localStorage.getItem(saveKey(currentGame));
  if (encoded) emulator.cartridge.loadSave(base64ToBytes(encoded));
}

function storeCollectionState() {
  localStorage.setItem("nes-favorites", JSON.stringify([...favorites]));
  localStorage.setItem("nes-recent", JSON.stringify(recentFiles));
}

function addRecent(file) {
  if (!file) return;
  recentFiles = recordRecent(recentFiles, file);
  storeCollectionState();
}

function applyDisplayMode() {
  const mode = displayModes[displayModeIndex];
  screenFrame.dataset.display = mode.id;
  setButtonCaption(displayModeButton, mode.button);
  displayLabel.textContent = mode.label;
  localStorage.setItem("nes-display-mode", mode.id);
}

function diagnosticContext() {
  return {
    file: currentFile,
    paused,
    fps: lastDisplayedFps,
    displayMode: displayModes[displayModeIndex].id,
    muted,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    audioState: audio.context?.state ?? "unavailable",
    audioBackend: audio.backend,
    audioSampleRate: audio.sampleRate,
    audioBufferedSamples: audio.bufferedSamples,
    audioUnderruns: audio.underrunCount,
    audioOverflows: audio.overflowCount,
  };
}

function drawFrame(pixels) {
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
}

function runEmulationFrame() {
  const frame = emulator.runFrame();
  drawFrame(frame.pixels);
  audio.push(frame.audio);
  return frame;
}

function primeAudio() {
  if (!emulator || muted) return;
  while (audio.bufferedSamples < audio.prebufferSamples) runEmulationFrame();
}

async function loadRom(data, name, selectedFile = null) {
  persistSave();
  setStatus(`Loading ${name}...`);
  paused = true;
  emulator = null;
  diagnosticTarget = null;
  startupFailureLog = null;
  diagnosticsButton.disabled = true;
  try {
    await audio.start();
    emulator = new NES(data, name, audio.sampleRate);
    diagnosticTarget = emulator;
    currentGame = name;
    currentFile = selectedFile;
    restoreSave();
    audio.clear();
    primeAudio();
    paused = false;
    pauseButton.disabled = false;
    resetButton.disabled = false;
    diagnosticsButton.disabled = false;
    setButtonCaption(pauseButton, "Pause");
    message.classList.add("hidden");
    setStatus(`${name} · Mapper ${emulator.cartridge.mapperId}`, true);
    nowPlaying.textContent = name;
    mapperReadout.textContent = String(emulator.cartridge.mapperId).padStart(3, "0");
    saveReadout.textContent = emulator.cartridge.battery ? "BATTERY" : "NONE";
    addRecent(selectedFile);
    document.querySelectorAll(".rom-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.file === selectedFile);
    });
    renderLibrary(search.value);
    frameAccumulator = 0;
    lastAnimationTime = performance.now();
  } catch (error) {
    emulator?.diagnostics.recordError(error, "ROM startup");
    diagnosticTarget = emulator;
    currentGame = name;
    currentFile = selectedFile;
    startupFailureLog = diagnosticTarget
      ? null
      : buildStartupFailureLog(data, name, error, diagnosticContext());
    pauseButton.disabled = true;
    resetButton.disabled = true;
    diagnosticsButton.disabled = false;
    setStatus("Unable to start game");
    showMessage(
      "Could not load ROM",
      `${error instanceof Error ? error.message : String(error)} · Dump the log for details.`,
    );
  }
}

async function selectGame(game, button) {
  document.querySelectorAll(".rom-item").forEach((item) => item.classList.remove("active"));
  button?.classList.add("active");
  button?.blur();
  try {
    const response = await fetch(`/api/rom?name=${encodeURIComponent(game.file)}`);
    if (!response.ok) throw new Error(await response.text());
    const data = new Uint8Array(await response.arrayBuffer());
    await loadRom(data, game.name, game.file);
  } catch (error) {
    setStatus("ROM request failed");
    showMessage("Could not read ROM", error instanceof Error ? error.message : String(error));
  }
}

function renderLibrary(filter = "") {
  visibleGames = selectLibraryGames(games, libraryFilter, favorites, recentFiles, filter);
  romList.replaceChildren();
  const fragment = document.createDocumentFragment();
  visibleGames.forEach((game, index) => {
    const row = document.createElement("div");
    row.className = "rom-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rom-item";
    button.dataset.file = game.file;
    button.classList.toggle("active", game.file === currentFile);
    button.title = game.name;
    const number = document.createElement("span");
    number.className = "rom-index";
    number.textContent = String(index + 1).padStart(3, "0");
    const name = document.createElement("span");
    name.className = "rom-name";
    name.textContent = game.name;
    button.append(number, name);
    button.addEventListener("click", () => selectGame(game, button));
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "favorite-button";
    favorite.classList.toggle("active", favorites.has(game.file));
    favorite.textContent = favorites.has(game.file) ? "FAV" : "+";
    favorite.title = favorites.has(game.file) ? "Remove from favorites" : "Add to favorites";
    favorite.setAttribute("aria-label", favorite.title);
    favorite.addEventListener("click", () => {
      if (favorites.has(game.file)) favorites.delete(game.file);
      else favorites.add(game.file);
      storeCollectionState();
      renderLibrary(search.value);
    });
    row.append(button, favorite);
    fragment.append(row);
  });
  if (!visibleGames.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    empty.textContent = libraryFilter === "favorites"
      ? "No favorite cartridges yet."
      : libraryFilter === "recent"
        ? "No recently played cartridges."
        : "No cartridges match this search.";
    fragment.append(empty);
  }
  romList.append(fragment);
  gameCount.textContent = `${visibleGames.length} / ${games.length}`;
  favoriteCount.textContent = `${favorites.size} favorite${favorites.size === 1 ? "" : "s"}`;
}

function setButton(player, button, pressed) {
  emulator?.setButton(player, button, pressed);
}

function pollGamepad() {
  const gamepads = navigator.getGamepads?.() ?? [];
  for (let player = 0; player < 2; player++) {
    const gamepad = gamepads[player];
    if (!gamepad) continue;
    const pressed = new Set();
    const mappings = [
      [0, Buttons.A], [1, Buttons.B], [8, Buttons.SELECT], [9, Buttons.START],
      [12, Buttons.UP], [13, Buttons.DOWN], [14, Buttons.LEFT], [15, Buttons.RIGHT],
    ];
    for (const [index, button] of mappings) {
      if (gamepad.buttons[index]?.pressed) pressed.add(button);
    }
    if (gamepad.axes[0] < -0.5) pressed.add(Buttons.LEFT);
    if (gamepad.axes[0] > 0.5) pressed.add(Buttons.RIGHT);
    if (gamepad.axes[1] < -0.5) pressed.add(Buttons.UP);
    if (gamepad.axes[1] > 0.5) pressed.add(Buttons.DOWN);
    for (let button = 0; button < 8; button++) {
      if (pressed.has(button) !== previousGamepadButtons[player].has(button)) {
        setButton(player, button, pressed.has(button));
      }
    }
    previousGamepadButtons[player] = pressed;
  }
}

function animationLoop(now) {
  const elapsed = Math.min(100, now - lastAnimationTime);
  lastAnimationTime = now;
  if (emulator && !paused) {
    try {
      pollGamepad();
      frameAccumulator += elapsed;
      let framesRun = 0;
      while (frameAccumulator >= frameDuration && framesRun < maxCatchUpFrames) {
        runEmulationFrame();
        frameAccumulator -= frameDuration;
        framesRun++;
        fpsFrames++;
      }
      if (framesRun === maxCatchUpFrames) {
        frameAccumulator = Math.min(frameAccumulator, frameDuration);
      }
    } catch (error) {
      emulator.diagnostics.recordError(error, "animation frame");
      diagnosticTarget = emulator;
      paused = true;
      audio.clear();
      setButtonCaption(pauseButton, "Resume");
      setStatus(`${currentGame} · Emulation halted`);
      showMessage(
        "Emulation halted",
        `${error instanceof Error ? error.message : String(error)} · Dump the log for details.`,
      );
    }
  }
  if (now - fpsStarted >= 1000) {
    lastDisplayedFps = Math.round((fpsFrames * 1000) / (now - fpsStarted));
    fpsLabel.textContent = `${lastDisplayedFps} FPS`;
    fpsFrames = 0;
    fpsStarted = now;
  }
  requestAnimationFrame(animationLoop);
}

function togglePause() {
  if (!emulator) return;
  paused = !paused;
  emulator.diagnostics.recordEvent("UI", paused ? "Paused" : "Resumed");
  if (paused) audio.clear();
  setButtonCaption(pauseButton, paused ? "Resume" : "Pause");
  setStatus(paused ? `${currentGame} · Paused` : `${currentGame} · Mapper ${emulator.cartridge.mapperId}`, !paused);
  if (!paused) {
    audio.start();
    primeAudio();
    lastAnimationTime = performance.now();
    frameAccumulator = 0;
  }
}

function reset() {
  if (!emulator) return;
  emulator.reset();
  emulator.diagnostics.recordEvent("UI", "Reset button pressed");
  audio.clear();
  primeAudio();
  paused = false;
  setButtonCaption(pauseButton, "Pause");
  setStatus(`${currentGame} · Mapper ${emulator.cartridge.mapperId}`, true);
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) await screenFrame.requestFullscreen();
  else await document.exitFullscreen();
}

function releaseKeyboardControls() {
  for (let player = 0; player < 2; player++) {
    for (let button = 0; button < 8; button++) setButton(player, button, false);
  }
}

document.addEventListener("keydown", (event) => {
  if (isTextEntryTarget(event.target)) return;
  const mapping = keyMap.get(event.code);
  if (mapping) {
    event.preventDefault();
    setButton(mapping[0], mapping[1], true);
    return;
  }
  if (event.repeat) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.code === "KeyR") {
    reset();
  } else if (event.code === "KeyM") {
    muteButton.click();
  } else if (event.code === "KeyF") {
    toggleFullscreen();
  }
});

document.addEventListener("keyup", (event) => {
  if (isTextEntryTarget(event.target)) return;
  const mapping = keyMap.get(event.code);
  if (mapping) {
    event.preventDefault();
    setButton(mapping[0], mapping[1], false);
  }
});

window.addEventListener("blur", () => {
  releaseKeyboardControls();
  emulator?.setZapper(-1, -1, false);
});
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    audio.clear();
    await audio.suspend();
    return;
  }
  if (emulator && !paused) {
    await audio.start();
    audio.clear();
    primeAudio();
    lastAnimationTime = performance.now();
    frameAccumulator = 0;
  }
});
window.addEventListener("beforeunload", persistSave);
setInterval(persistSave, 2000);

pauseButton.addEventListener("click", togglePause);
resetButton.addEventListener("click", reset);
muteButton.addEventListener("click", () => {
  muted = !muted;
  audio.setMuted(muted);
  diagnosticTarget?.diagnostics.recordEvent("UI", muted ? "Audio muted" : "Audio unmuted");
  setButtonCaption(muteButton, muted ? "Sound off" : "Sound on");
});
fullscreenButton.addEventListener("click", toggleFullscreen);
search.addEventListener("input", () => renderLibrary(search.value));
search.addEventListener("focus", releaseKeyboardControls);
libraryTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    libraryFilter = tab.dataset.libraryFilter;
    libraryTabs.forEach((item) => item.classList.toggle("active", item === tab));
    renderLibrary(search.value);
    tab.blur();
  });
});
randomButton.addEventListener("click", () => {
  if (!visibleGames.length) return;
  const game = visibleGames[Math.floor(Math.random() * visibleGames.length)];
  selectGame(game);
  randomButton.blur();
});
displayModeButton.addEventListener("click", () => {
  displayModeIndex = (displayModeIndex + 1) % displayModes.length;
  applyDisplayMode();
  diagnosticTarget?.diagnostics.recordEvent(
    "UI",
    "Display mode changed",
    displayModes[displayModeIndex].id,
  );
  displayModeButton.blur();
});
screenshotButton.addEventListener("click", () => {
  if (!emulator) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    const safeName = (currentGame || "nes-frame").replace(/[<>:"/\\|?*]+/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
  screenshotButton.blur();
});
diagnosticsButton.addEventListener("click", () => {
  if (!diagnosticTarget && !startupFailureLog) return;
  diagnosticTarget?.diagnostics.recordEvent("UI", "Diagnostic log requested");
  const log = diagnosticTarget
    ? buildDiagnosticLog(diagnosticTarget, diagnosticContext())
    : startupFailureLog;
  const blob = new Blob([log], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  const safeName = (currentGame || "nes").replace(/[<>:"/\\|?*]+/g, "-");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}-diagnostics-${stamp}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  setButtonCaption(diagnosticsButton, "Log saved");
  window.setTimeout(() => setButtonCaption(diagnosticsButton, "Dump log"), 1400);
  diagnosticsButton.blur();
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await loadRom(new Uint8Array(await file.arrayBuffer()), file.name);
  fileInput.value = "";
});

function updateZapper(event, trigger) {
  if (!emulator) return;
  const bounds = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) * 256) / bounds.width);
  const y = Math.floor(((event.clientY - bounds.top) * 240) / bounds.height);
  emulator.setZapper(x, y, trigger);
}

canvas.addEventListener("mousemove", (event) => updateZapper(event, emulator?.zapper.trigger));
canvas.addEventListener("mousedown", (event) => {
  event.preventDefault();
  updateZapper(event, true);
});
window.addEventListener("mouseup", () => {
  if (emulator) emulator.setZapper(emulator.zapper.x, emulator.zapper.y, false);
});
canvas.addEventListener("mouseleave", () => {
  if (emulator && !emulator.zapper.trigger) emulator.setZapper(-1, -1, false);
});

try {
  const response = await fetch("/api/roms");
  if (!response.ok) throw new Error("ROM library API is unavailable");
  games = await response.json();
  renderLibrary();
} catch (error) {
  setStatus("Library unavailable");
  showMessage("Start the local server", "Run python serve.py, then open the displayed URL.");
}

applyDisplayMode();
requestAnimationFrame(animationLoop);
