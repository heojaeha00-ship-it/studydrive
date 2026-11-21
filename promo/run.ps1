# PowerShell: 이 폴더에서  .\run.ps1
npm install
node generate-audio.js
npx remotion render src/index.ts Promo out/studydrive-promo.mp4 --fps=60 --codec=h264 --crf=16
