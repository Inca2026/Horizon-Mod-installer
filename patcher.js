const GITHUB_OWNER = "Inca2026";
const GITHUB_REPO = "Horizon-Mod-installer";
const MODS_FOLDER = "mods";

const modListEl = document.getElementById("modList");
const dropZone = document.getElementById("dropZone");
const htmlInput = document.getElementById("htmlInput");
const fileLabel = document.getElementById("fileLabel");
const downloadBtn = document.getElementById("downloadBtn");
const launchBtn = document.getElementById("launchBtn");
const statusEl = document.getElementById("status");

let discoveredMods = [];
let selectedHtmlFile = null;

function isModFile(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".hnmod") || lower.endsWith(".hmod");
}

async function loadRepoMods() {
  const apiUrl = `https://github.com{GITHUB_OWNER}/${GITHUB_REPO}/contents/${MODS_FOLDER}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = await res.json();

    discoveredMods = files
      .filter((f) => f.type === "file" && isModFile(f.name))
      .map((f) => ({
        name: f.name,
        url: `./${MODS_FOLDER}/${encodeURIComponent(f.name)}`
      }));

    renderModList();
  } catch (err) {
    // Fallback if ://github.com is blocked by a school/network filter:
    // Check for a mods.json list in the repo or probe known files directly from github.io
    try {
      const listRes = await fetch(`./${MODS_FOLDER}/mods.json`);
      if (listRes.ok) {
        const names = await listRes.json();
        discoveredMods = names.filter(isModFile).map((name) => ({
          name,
          url: `./${MODS_FOLDER}/${encodeURIComponent(name)}`
        }));
        renderModList();
        return;
      }
    } catch (_) {}

    modListEl.innerHTML = `<li class="empty">://github.com is blocked on this network. Add a <code>mods/mods.json</code> file containing <code>["atlas-0.3.0.hnmod"]</code>.</li>`;
  }
  updateButtons();
}

function renderModList() {
  modListEl.innerHTML = discoveredMods.length === 0
    ? `<li class="empty">No .hnmod or .hmod files found in /${MODS_FOLDER} yet.</li>`
    : discoveredMods.map((m) => `<li>+ ${m.name}</li>`).join("");
  updateButtons();
}

function updateButtons() {
  const ready = Boolean(selectedHtmlFile) && discoveredMods.length > 0;
  downloadBtn.disabled = !ready;
  launchBtn.disabled = !ready;
}

dropZone.addEventListener("click", () => htmlInput.click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files) handleFileSelect(e.dataTransfer.files);
});
htmlInput.addEventListener("change", (e) => {
  if (e.target.files) handleFileSelect(e.target.files);
});

function handleFileSelect(file) {
  selectedHtmlFile = file;
  fileLabel.textContent = `Selected: ${file.name}`;
  statusEl.textContent = "";
  updateButtons();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function buildPatchedHtml() {
  statusEl.textContent = "Fetching mods and bundling into HTML...";
  const bundledMods = [];

  for (const mod of discoveredMods) {
    const res = await fetch(mod.url);
    if (!res.ok) throw new Error(`Failed to fetch ${mod.name}`);
    bundledMods.push({ name: mod.name, b64: arrayBufferToBase64(await res.arrayBuffer()) });
  }

  const rawHtml = await selectedHtmlFile.text();
  const injectorScript = `<script>
(function() {
  const EMBEDDED_MODS = ${JSON.stringify(bundledMods)};
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  window.__horizonModsReady = (async () => {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      const modDir = await root.getDirectoryHandle("horizon-mods", { create: true });
      for (const mod of EMBEDDED_MODS) {
        const fh = await modDir.getFileHandle(mod.name, { create: true });
        const writable = await fh.createWritable();
        await writable.write(b64ToBytes(mod.b64));
        await writable.close();
      }
      console.log("[ModPatcher] Installed", EMBEDDED_MODS.length, "mods into OPFS horizon-mods.");
    } catch (e) {
      console.error("[ModPatcher] Failed to write mods:", e);
    }
  })();
})();
<\/script>\n`;

  return /<head[^>]*>/i.test(rawHtml)
    ? rawHtml.replace(/<head[^>]*>/i, (match) => `${match}\n${injectorScript}`)
    : injectorScript + rawHtml;
}

async function handleAction(mode) {
  try {
    downloadBtn.disabled = true;
    launchBtn.disabled = true;
    const patched = await buildPatchedHtml();
    const url = URL.createObjectURL(new Blob([patched], { type: "text/html" }));

    if (mode === "download") {
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedHtmlFile.name.replace(/\.html?$/i, "") + "-modded.html";
      a.click();
      URL.revokeObjectURL(url);
      statusEl.textContent = `Done! Bundled ${discoveredMods.length} mod(s).`;
    } else {
      window.open(url, "_blank");
      statusEl.textContent = `Launched with ${discoveredMods.length} mod(s) in a new tab.`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    updateButtons();
  }
}

downloadBtn.addEventListener("click", () => handleAction("download"));
launchBtn.addEventListener("click", () => handleAction("launch"));

loadRepoMods();
