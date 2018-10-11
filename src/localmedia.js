import hark from 'hark';
import WildEmitter from 'wildemitter';
import mockconsole from 'mockconsole';

function isAllTracksEnded(stream) {
  let isAllTracksEnded = true;
  stream.getTracks().forEach((t) => {
    isAllTracksEnded = t.readyState === 'ended' && isAllTracksEnded;
  });
  return isAllTracksEnded;
}

function shouldWorkAroundFirefoxStopStream() {
  if (typeof window === 'undefined') {
    return false;
  }
  if (!window.navigator.mozGetUserMedia) {
    return false;
  }
  const match = window.navigator.userAgent.match(/Firefox\/(\d+)\./);
  const version = match && match.length >= 1 && parseInt(match[1], 10);
  return version < 50;
}

class LocalMedia extends WildEmitter {
  constructor(opts) {
    super();
    const config = this.config = {
      detectSpeakingEvents: false,
      audioFallback: false,
      media: {
        audio: true,
        video: true,
      },
      harkOptions: null,
      logger: mockconsole,
    };

    let item;
    for (item in opts) {
      if (opts.hasOwnProperty(item)) {
        this.config[item] = opts[item];
      }
    }

    this.logger = config.logger;
    this._log = this.logger.log.bind(this.logger, 'LocalMedia:');
    this._logerror = this.logger.error.bind(this.logger, 'LocalMedia:');

    this.localStreams = [];
    this.localScreens = [];

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._logerror('Your browser does not support local media capture.');
    }

    this._audioMonitors = [];
    this.on('localStreamStopped', this._stopAudioMonitor.bind(this));
    this.on('localScreenStopped', this._stopAudioMonitor.bind(this));
  }

  start(mediaConstraints, cb) {
    const self = this;
    const constraints = mediaConstraints || this.config.media;

    this.emit('localStreamRequested', constraints);

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (constraints.audio && self.config.detectSpeakingEvents) {
        self._setupAudioMonitor(stream, self.config.harkOptions);
      }
      self.localStreams.push(stream);

      stream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (isAllTracksEnded(stream)) {
            self._removeStream(stream);
          }
        });
      });

      self.emit('localStream', stream);

      if (cb) {
        return cb(null, stream);
      }
    }).catch((err) => {
      // Fallback for users without a camera
      if (self.config.audioFallback && err.name === 'NotFoundError' && constraints.video !== false) {
        constraints.video = false;
        self.start(constraints, cb);
        return;
      }

      self.emit('localStreamRequestFailed', constraints);

      if (cb) {
        return cb(err, null);
      }
    });
  }

  stop(stream) {
    this.stopStream(stream);
  }

  stopStream(stream) {
    const self = this;

    if (stream) {
      const idx = this.localStreams.indexOf(stream);
      if (idx > -1) {
        stream.getTracks().forEach((track) => { track.stop(); });

        // Half-working fix for Firefox, see: https://bugzilla.mozilla.org/show_bug.cgi?id=1208373
        if (shouldWorkAroundFirefoxStopStream()) {
          this._removeStream(stream);
        }
      }
    } else {
      this.localStreams.forEach((stream) => {
        stream.getTracks().forEach((track) => { track.stop(); });

        // Half-working fix for Firefox, see: https://bugzilla.mozilla.org/show_bug.cgi?id=1208373
        if (shouldWorkAroundFirefoxStopStream()) {
          self._removeStream(stream);
        }
      });
    }
  }
  // Audio controls
  mute() {
    this._audioEnabled(false);
    this.emit('audioOff');
  }

  unmute() {
    this._audioEnabled(true);
    this.emit('audioOn');
  }

  // Video controls
  pauseVideo() {
    this._videoEnabled(false);
    this.emit('videoOff');
  }

  resumeVideo() {
    this._videoEnabled(true);
    this.emit('videoOn');
  }

  // Combined controls
  pause() {
    this.mute();
    this.pauseVideo();
  }

  resume() {
    this.unmute();
    this.resumeVideo();
  }

  // Internal methods for enabling/disabling audio/video
  _audioEnabled(bool) {
    this.localStreams.forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !!bool;
      });
    });
  }

  _videoEnabled(bool) {
    this.localStreams.forEach((stream) => {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !!bool;
      });
    });
  }

  // check if all audio streams are enabled
  isAudioEnabled() {
    let enabled = true;
    this.localStreams.forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        enabled = enabled && track.enabled;
      });
    });
    return enabled;
  }

  // check if all video streams are enabled
  isVideoEnabled() {
    let enabled = true;
    this.localStreams.forEach((stream) => {
      stream.getVideoTracks().forEach((track) => {
        enabled = enabled && track.enabled;
      });
    });
    return enabled;
  }

  _removeStream(stream) {
    let idx = this.localStreams.indexOf(stream);
    if (idx > -1) {
      this.localStreams.splice(idx, 1);
      this.emit('localStreamStopped', stream);
    } else {
      idx = this.localScreens.indexOf(stream);
      if (idx > -1) {
        this.localScreens.splice(idx, 1);
        this.emit('localScreenStopped', stream);
      }
    }
  }

  _setupAudioMonitor(stream, harkOptions) {
    this._log('Setup audio');
    const audio = hark(stream, harkOptions);
    const self = this;
    let timeout;

    audio.on('speaking', () => {
      self.emit('speaking');
    });

    audio.on('stopped_speaking', () => {
      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(() => {
        self.emit('stoppedSpeaking');
      }, 1000);
    });
    audio.on('volume_change', (volume, threshold) => {
      self.emit('volumeChange', volume, threshold);
    });

    this._audioMonitors.push({ audio, stream });
  }

  _stopAudioMonitor(stream) {
    let idx = -1;
    this._audioMonitors.forEach((monitors, i) => {
      if (monitors.stream === stream) {
        idx = i;
      }
    });

    if (idx > -1) {
      this._audioMonitors[idx].audio.stop();
      this._audioMonitors.splice(idx, 1);
    }
  }
}


export default LocalMedia;
