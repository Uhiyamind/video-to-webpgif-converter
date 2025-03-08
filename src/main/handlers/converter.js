const { ipcMain } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

// ffmpegのパスを設定
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

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
      filePath = path.join(dir, `${baseName}_${counter}${ext}`);
      counter++;
    } catch {
      break;
    }
  }
  return filePath;
}

// 変換処理のセットアップ
function setupConverterHandlers() {
  // メディア情報取得
  ipcMain.handle("get-media-info", async (event, filePath) => {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(
          (s) => s.codec_type === "video"
        );
        if (!videoStream) {
          reject(new Error("No video stream found"));
          return;
        }

        resolve({
          duration: metadata.format.duration,
          fps: eval(videoStream.r_frame_rate),
          width: videoStream.width,
          height: videoStream.height,
          fileSize: metadata.format.size,
          bitrate: metadata.format.bit_rate,
        });
      });
    });
  });

  // 変換処理
  ipcMain.handle(
    "convert-media",
    async (event, { inputPath, outputFormat, settings }) => {
      try {
        let outputPath = path.join(
          path.dirname(inputPath),
          `${path.basename(inputPath, path.extname(inputPath))}.${outputFormat}`
        );

        outputPath = await getUniqueFilePath(outputPath);

        return new Promise((resolve, reject) => {
          let command = ffmpeg(inputPath);

          if (outputFormat === "webp") {
            command.outputOptions([
              `-vf fps=${settings.fps},scale=${settings.width}:-1:flags=lanczos`,
              `-loop ${settings.loop ? "0" : "1"}`,
              `-lossless 0`,
              `-quality ${settings.quality}`,
            ]);
          } else if (outputFormat === "gif") {
            command.outputOptions([
              `-vf fps=${settings.fps},scale=${settings.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
              `-loop ${settings.loop ? "0" : "1"}`,
            ]);
          }

          command
            .on("progress", (progress) => {
              event.sender.send("conversion-progress", {
                percent: progress.percent,
                timemark: progress.timemark,
              });
            })
            .on("end", () => resolve(outputPath))
            .on("error", (err) => reject(err))
            .save(outputPath);
        });
      } catch (error) {
        throw new Error(`変換エラー: ${error.message}`);
      }
    }
  );
}

module.exports = {
  setupConverterHandlers,
};
