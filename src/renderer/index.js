const { ipcRenderer } = require("electron");

// Window control functions
function minimizeWindow() {
  ipcRenderer.send("minimize-window");
}

function maximizeWindow() {
  ipcRenderer.send("maximize-window");
}

function closeWindow() {
  ipcRenderer.send("close-window");
}

// Drop zone handling
const dropZone = document.getElementById("dropZone");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

// Advanced settings toggle
const advancedSettingsToggle = document.getElementById(
  "advancedSettingsToggle"
);
const advancedSettings = document.getElementById("advancedSettings");
const advancedSettingsIcon = advancedSettingsToggle.querySelector("svg");

advancedSettingsToggle.addEventListener("click", () => {
  const isHidden = advancedSettings.classList.toggle("hidden");
  advancedSettingsIcon.style.transform = isHidden
    ? "rotate(0deg)"
    : "rotate(180deg)";
});

// Preset cards handling
const presetCards = document.querySelectorAll(".preset-card");
presetCards.forEach((card) => {
  card.addEventListener("click", () => {
    // Remove selected class from all cards
    presetCards.forEach((c) => c.classList.remove("selected"));
    // Add selected class to clicked card
    card.classList.add("selected");

    // Apply preset settings based on the card
    const presetName = card.querySelector(".text-sm").textContent;
    applyPreset(presetName);
  });
});

// Apply preset settings
function applyPreset(presetName) {
  const presets = {
    Web最適化: {
      fps: 15,
      width: 800,
      quality: 75,
    },
    高画質: {
      fps: 24,
      width: 1280,
      quality: 90,
    },
    軽量: {
      fps: 12,
      width: 640,
      quality: 60,
    },
    ステッカー: {
      fps: 10,
      width: 512,
      quality: 70,
    },
  };

  const preset = presets[presetName];
  if (preset) {
    document.getElementById("fps").value = preset.fps;
    document.getElementById("width").value = preset.width;
    document.getElementById("quality").value = preset.quality;
    updateValueDisplays();
  }
}

// Update value displays for sliders
function updateValueDisplays() {
  document.getElementById("fpsValue").textContent = `${
    document.getElementById("fps").value
  } FPS`;
  document.getElementById("widthValue").textContent = `${
    document.getElementById("width").value
  } px`;
  document.getElementById("qualityValue").textContent = `${
    document.getElementById("quality").value
  }%`;
}

// Add input event listeners for sliders
document.getElementById("fps").addEventListener("input", updateValueDisplays);
document.getElementById("width").addEventListener("input", updateValueDisplays);
document
  .getElementById("quality")
  .addEventListener("input", updateValueDisplays);

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("drag-over");

  const files = Array.from(e.dataTransfer.files);
  const supportedFormats = [".mp4", ".mov", ".avi", ".mkv", ".gif"];

  for (const file of files) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!supportedFormats.includes(ext)) {
      alert(`未対応のファイル形式です: ${file.name}`);
      continue;
    }

    try {
      await convertFile(file.path);
    } catch (error) {
      if (error.message === "FFmpeg is not available") {
        alert(
          "FFmpegが見つかりません。FFmpegをインストールし、システムパスに追加してください。"
        );
      } else {
        alert(`変換エラー: ${error.message}`);
      }
    }
  }
});

// File conversion
async function convertFile(inputPath) {
  const settings = {
    fps: parseInt(document.getElementById("fps").value),
    width: parseInt(document.getElementById("width").value),
    quality: parseInt(document.getElementById("quality").value),
    loop: document.getElementById("loop").checked,
  };

  const outputFormat = document.querySelector(
    'input[name="format"]:checked'
  ).value;

  progressContainer.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";

  try {
    const outputPath = await ipcRenderer.invoke("convert-media", {
      inputPath,
      outputFormat,
      settings,
    });

    alert(`変換が完了しました: ${outputPath}`);
  } catch (error) {
    throw error;
  } finally {
    progressContainer.classList.add("hidden");
  }
}

// Progress updates
ipcRenderer.on("conversion-progress", (event, { percent }) => {
  const progress = Math.round(percent);
  progressBar.style.width = `${progress}%`;
  progressText.textContent = `${progress}%`;
});

// フォーマット変更時のイベントリスナー
document.querySelectorAll('input[name="format"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const isWebP = radio.value === "webp";
    document.getElementById("qualityContainer").style.display = isWebP
      ? "block"
      : "none";
  });
});

// 初期表示時の設定
updateValueDisplays();
advancedSettings.classList.add("hidden");
