const GITHUB_OWNER = ""; // Optional manual override for custom domains
const GITHUB_REPO = "";
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

function detectRepoInfo() {
  if (GITHUB_OWNER && GITHUB_REPO) return { owner: GITHUB_OWNER, repo: GITHUB_REPO };
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  if (host.endsWith(".github.io")) {
    const owner = host.replace(".github.io", "");
    const repo = pathParts.length > 0 ? pathParts[0] : `${owner}.github.io`;
    return { owner, repo };
  }
  return null;
}

async function loadRepoMods() {
  const repoInfo = detectRepoInfo();
  if (!repoInfo) {
    modListEl.innerHTML = `<li class="empty">Set GITHUB_OWNER and GITHUB_REPO in patcher.js if using a custom domain.</li>`;
    return;
  }

  const apiUrl = `https://github.com{repoInfo.owner}/${repoInfo.repo}/contents/${MODS_FOLDER}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const files = await res.json();

    discoveredMods = files
      .filter((f) => f.type === "file" && f.name.toLowerCase().endsWith(".hmod"))
      .map((f) => ({
        name: f.name,
        url: `./${MODS_FOLDER}/${encodeURIComponent(f.name)}`
      }));

    modListEl.innerHTML = discoveredMods.length === 0
      ? `<li class="empty">No .hmod files found in /${MODS_FOLDER} yet.</li>`
      : discoveredMods.map((m) => `<li>+ ${m.name}</li>`).join("");
  } catch (err) {
    modListEl.innerHTML = `<li class="empty">Could not read /${MODS_FOLDER} (${err.message}).</li>`;
  }
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
  if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
});
htmlInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFileSelect(e.target.files[0]);
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
