const browserify = require('browserify');
const fs = require('fs');
const request = require('request');
const uglify = require('uglify-js');

const bundle = browserify({ standalone: 'LioWebRTC' });
bundle.add('./src/liowebrtc');
bundle.bundle((err, source) => {
  if (err) {
    console.error(err);
  }
  fs.writeFileSync('out/liowebrtc.bundle.js', source);
  const adapter = fs.readFileSync('node_modules/webrtc-adapter/out/adapter.js').toString();
  fs.writeFileSync('out/liowebrtc-with-adapter.bundle.js', `${adapter}\n${source}`);
});
