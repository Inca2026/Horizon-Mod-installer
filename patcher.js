const htmlDrop = document.getElementById("htmlDrop");
const htmlInput = document.getElementById("htmlInput");
const htmlLabel = document.getElementById("htmlLabel");
const modDrop = document.getElementById("modDrop");
const modInput = document.getElementById("modInput");
const modListEl = document.getElementById("modList");
const downloadBtn = document.getElementById("downloadBtn");
const launchBtn = document.getElementById("launchBtn");
const statusEl = document.getElementById("status");

let selectedHtmlFile = null;
let selectedMods = [];

function setupDropZone(zone, input, onFiles) {
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  });
  input.addEventListener("change", (e) => {
    if (e.target.files.length) onFiles(e.target.files);
    input.value = "";
  });
}

setupDropZone(htmlDrop, htmlInput, (files) => {
  selectedHtmlFile = files[0];
  htmlLabel.textContent = `1. Selected: ${selectedHtmlFile.name}`;
  statusEl.textContent = "";
  updateButtons();
});

setupDropZone(modDrop, modInput, (files) => {
  for (const file of files) {
    if (!selectedMods.some((m) => m.name === file.name)) {
      selectedMods.push(file);
    }
  }
  renderModList();
  updateButtons();
});

function renderModList() {
  modListEl.innerHTML = "";
  selectedMods.forEach((file, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>+ ${file.name}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.onclick = () => {
      selectedMods.splice(index, 1);
      renderModList();
      updateButtons();
    };
    li.appendChild(removeBtn);
    modListEl.appendChild(li);
  });
}

function updateButtons() {
  const ready = Boolean(selectedHtmlFile) && selectedMods.length > 0;
  downloadBtn.disabled = !ready;
  launchBtn.disabled = !ready;
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
  statusEl.textContent = "Bundling mods into Horizon HTML...";
  const bundledMods = [];

  for (const file of selectedMods) {
    bundledMods.push({
      name: file.name,
      b64: arrayBufferToBase64(await file.arrayBuffer())
    });
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
      statusEl.textContent = `Done! Bundled ${selectedMods.length} mod(s).`;
    } else {
      window.open(url, "_blank");
      statusEl.textContent = `Launched with ${selectedMods.length} mod(s) in a new tab.`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    updateButtons();
  }
}

downloadBtn.addEventListener("click", () => handleAction("download"));
launchBtn.addEventListener("click", () => handleAction("launch"));
