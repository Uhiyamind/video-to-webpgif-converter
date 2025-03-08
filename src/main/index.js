const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const isDev = require("electron-is-dev");
const Store = new require("electron-store");
const fs = require("fs").promises;
const { exec } = require("child_process");
const which = require("which");

const store = new Store();

// プリセット設定
const PRESETS = {
  "web-optimal": {
    name: "Web最適化",
    description: "ウェブ用に最適化（画質と容量のバランス）",
    webp: { fps: 15, quality: 75, width: 800 },
    gif: { fps: 15, colors: 256, width: 800 },
  },
  "high-quality": {
    name: "高画質",
    description: "高画質優先（大きいファイルサイズ）",
    webp: { fps: 24, quality: 90, width: 1280 },
    gif: { fps: 24, colors: 256, width: 1280 },
  },
  "small-size": {
    name: "軽量",
    description: "ファイルサイズ優先（低画質）",
    webp: { fps: 12, quality: 60, width: 640 },
    gif: { fps: 12, colors: 128, width: 640 },
  },
  sticker: {
    name: "ステッカー",
    description: "メッセージング用ステッカー最適化",
    webp: { fps: 10, quality: 70, width: 512 },
    gif: { fps: 10, colors: 128, width: 512 },
  },
};

let mainWindow;

// ffmpegが利用可能かチェックする関数
async function checkFfmpeg() {
  try {
    await which("ffmpeg");
    return true;
  } catch (error) {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    titleBarStyle: "hidden",
    frame: false,
    backgroundColor: "#ffffff",
    title: "Video to WebpGif Converter",
  });

  mainWindow.loadFile("src/renderer/index.html");

  // アプリ起動時にffmpegをチェック
  checkFfmpeg().then((isAvailable) => {
    if (!isAvailable) {
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "FFmpeg が見つかりません",
        message: "FFmpeg がインストールされていないか、パスが通っていません。",
        detail:
          "このアプリを使用するには、FFmpeg をインストールし、システムパスに追加してください。\n\nFFmpegのインストール方法:\n1. FFmpegの公式サイト (https://ffmpeg.org) からダウンロード\n2. システム環境変数のPATHにFFmpegのbinディレクトリを追加\n3. コンピュータを再起動",
        buttons: ["OK"],
      });
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// プリセット取得ハンドラー
ipcMain.handle("get-presets", () => {
  return PRESETS;
});

// ファイル情報取得ハンドラー
ipcMain.handle("get-media-info", async (event, filePath) => {
  const isFFmpegAvailable = await checkFfmpeg();
  if (!isFFmpegAvailable) {
    throw new Error("FFmpeg is not available");
  }

  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        const metadata = JSON.parse(stdout);
        const videoStream = metadata.streams.find(
          (s) => s.codec_type === "video"
        );
        if (!videoStream) {
          reject(new Error("No video stream found"));
          return;
        }

        const fileSize = metadata.format.size;
        const duration = metadata.format.duration;
        const fps = eval(videoStream.r_frame_rate);
        const width = videoStream.width;
        const height = videoStream.height;

        resolve({
          duration,
          fps,
          width,
          height,
          fileSize,
          bitrate: metadata.format.bit_rate,
        });
      }
    );
  });
});

// ファイルサイズ推定ハンドラー
ipcMain.handle(
  "estimate-output-size",
  async (event, { inputInfo, settings, outputFormat }) => {
    // 単純な推定式（実際の出力サイズは圧縮効率により変動）
    const compressionFactor =
      outputFormat === "webp"
        ? (settings.quality / 100) * 0.7 // WebPの場合
        : 0.8; // GIFの場合

    const estimatedSize = Math.round(
      ((inputInfo.fileSize * settings.fps) / inputInfo.fps) * // フレームレートによる調整
        (settings.width / inputInfo.width) * // サイズによる調整
        compressionFactor // 圧縮率による調整
    );

    return {
      estimated: estimatedSize,
      original: inputInfo.fileSize,
    };
  }
);

// 一意のファイル名を生成する関数
async function getUniqueFilePath(basePath) {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const baseName = path.basename(basePath, ext);
  let counter = 1;
  let filePath = basePath;

  while (true) {
    try {
      await fs.access(filePath);
      // ファイルが存在する場合、新しい名前を生成
      filePath = path.join(dir, `${baseName}_${counter}${ext}`);
      counter++;
    } catch {
      // ファイルが存在しない場合、このパスを使用
      break;
    }
  }
  return filePath;
}

// 変換処理ハンドラー
ipcMain.handle(
  "convert-media",
  async (event, { inputPath, outputFormat, settings }) => {
    const isFFmpegAvailable = await checkFfmpeg();
    if (!isFFmpegAvailable) {
      throw new Error("FFmpeg is not available");
    }

    try {
      // 出力先を同じディレクトリに設定
      let outputPath = path.join(
        path.dirname(inputPath),
        `${path.basename(inputPath, path.extname(inputPath))}.${outputFormat}`
      );

      // 一意のファイル名を取得
      outputPath = await getUniqueFilePath(outputPath);

      return new Promise((resolve, reject) => {
        let command = "";

        if (outputFormat === "webp") {
          command = `ffmpeg -i "${inputPath}" -vf "fps=${settings.fps},scale=${
            settings.width
          }:-1:flags=lanczos" -loop ${
            settings.loop ? "0" : "1"
          } -lossless 0 -quality ${settings.quality} "${outputPath}"`;
        } else if (outputFormat === "gif") {
          // GIF用の最適化されたフィルターチェーン
          command = `ffmpeg -i "${inputPath}" -vf "fps=${settings.fps},scale=${
            settings.width
          }:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop ${
            settings.loop ? "0" : "1"
          } "${outputPath}"`;
        }

        const process = exec(command);

        process.stderr.on("data", (data) => {
          // FFmpegは進捗情報をstderrに出力します
          const match = data.toString().match(/time=(\d+:\d+:\d+.\d+)/);
          if (match) {
            const timemark = match[1];
            // 簡易的な進捗計算（より正確な計算が必要な場合は調整が必要）
            event.sender.send("conversion-progress", {
              percent: 50, // 仮の進捗値
              timemark: timemark,
            });
          }
        });

        process.on("error", (error) => reject(error));

        process.on("exit", (code) => {
          if (code === 0) {
            resolve(outputPath);
          } else {
            reject(new Error(`FFmpeg process exited with code ${code}`));
          }
        });
      });
    } catch (error) {
      throw new Error(`変換エラー: ${error.message}`);
    }
  }
);

// Window control handlers
ipcMain.on("minimize-window", () => {
  mainWindow.minimize();
});

ipcMain.on("maximize-window", () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("close-window", () => {
  mainWindow.close();
});
