import WildEmitter from 'wildemitter';
import attachMediaStream from 'attachmediastream';
import mockconsole from 'mockconsole';
import WebRTC from './webrtc';
import webrtcSupport from './webrtcsupport';
import SocketIoConnection from './socketioconnection';

class LioWebRTC extends WildEmitter {
  constructor(opts) {
    super();
    const self = this;
    const options = opts || {};
    const config = this.config = {
      url: 'https://sandbox.simplewebrtc.com:443/',
      socketio: { forceNew: true },
      connection: null,
      debug: false,
      localVideoEl: '',
      remoteVideosEl: '',
      enableDataChannels: true,
      autoRequestMedia: false,
      dataOnly: false,
      autoRemoveVideos: true,
      adjustPeerVolume: true,
      peerVolumeWhenSpeaking: 0.25,
      media: {
        video: true,
        audio: true,
      },
      receiveMedia: {
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1,
      },
      localVideo: {
        autoplay: true,
        mirror: false,
        muted: true,
      },
    };

    let connection;
    this.logger = ((() => {
      // we assume that if you're in debug mode and you didn't
      // pass in a logger, you actually want to log as much as
      // possible.
      if (opts.debug) {
        return opts.logger || console;
      }
      return opts.logger || mockconsole;
    })());

    // set our config from options
    Object.keys(options).forEach((o) => {
      this.config[o] = options[o];
    });

    if (options.dataOnly) {
      this.config.media.video = false;
      this.config.media.audio = false;
      this.config.receiveMedia.offerToReceiveAudio = false;
      this.config.receiveMedia.offerToReceiveVideo = false;
    }

    // attach detected support for convenience
    this.capabilities = webrtcSupport;

    // create default SocketIoConnection if it's not passed in
    if (this.config.connection === null) {
      connection = this.connection = new SocketIoConnection(this.config);
    } else {
      connection = this.connection = this.config.connection;
    }

    connection.on('connect', () => {
      self.emit('connectionReady', connection.getSessionid());
      self.sessionReady = true;
      self.testReadiness();
    });

    connection.on('message', (message) => {
      const peers = self.webrtc.getPeers(message.from, message.roomType);
      let peer;

      if (message.type === 'offer') {
        if (peers.length) {
          peers.forEach((p) => {
            if (p.sid === message.sid) peer = p;
          });
          // if (!peer) peer = peers[0]; // fallback for old protocol versions
        }
        if (!peer) {
          peer = self.webrtc.createPeer({
            id: message.from,
            sid: message.sid,
            type: message.roomType,
            enableDataChannels: self.config.enableDataChannels && message.roomType !== 'screen',
            sharemyscreen: message.roomType === 'screen' && !message.broadcaster,
            broadcaster: message.roomType === 'screen' && !message.broadcaster ? self.connection.getSessionid() : null,
          });
          self.emit('createdPeer', peer);
        }
        peer.handleMessage(message);
      } else if (peers.length) {
        peers.forEach((p) => {
          p.handleMessage(message);
        });
      }
    });

    connection.on('remove', (room) => {
      if (room.id !== self.connection.getSessionid()) {
        self.webrtc.removePeers(room.id, room.type);
      }
    });

    // instantiate our main WebRTC helper
    // using same logger from logic here
    opts.logger = this.logger;
    opts.debug = false;
    this.webrtc = new WebRTC(opts);

    // attach a few methods from underlying lib to liowebrtc.
    ['mute', 'unmute', 'pauseVideo', 'resumeVideo', 'pause', 'resume', 'sendToAll', 'sendDirectlyToAll', 'getPeers', 'getPeerByNick', 'shout', 'whisper', 'broadcast'].forEach((method) => {
      self[method] = self.webrtc[method].bind(self.webrtc);
    });

    // proxy events from WebRTC
    this.webrtc.on('*', function () {
      self.emit(...arguments);
    });

    // log all events in debug mode
    if (config.debug) {
      this.on('*', this.logger.log.bind(this.logger, 'LioWebRTC event:'));
    }

    // check for readiness
    this.webrtc.on('localStream', () => {
      self.testReadiness();
    });

    this.webrtc.on('message', (payload) => {
      self.connection.emit('message', payload);
    });

    this.webrtc.on('peerStreamAdded', this.handlePeerStreamAdded.bind(this));
    this.webrtc.on('peerStreamRemoved', this.handlePeerStreamRemoved.bind(this));

    // echo cancellation attempts
    if (this.config.adjustPeerVolume) {
      this.webrtc.on('speaking', this.setVolumeForAll.bind(this, this.config.peerVolumeWhenSpeaking));
      this.webrtc.on('stoppedSpeaking', this.setVolumeForAll.bind(this, 1));
    }

    connection.on('stunservers', (args) => {
      // resets/overrides the config
      self.webrtc.config.peerConnectionConfig.iceServers = args;
      self.emit('stunservers', args);
    });
    connection.on('turnservers', (args) => {
      // appends to the config
      self.webrtc.config.peerConnectionConfig.iceServers = self.webrtc.config.peerConnectionConfig.iceServers.concat(args);
      self.emit('turnservers', args);
    });

    this.webrtc.on('iceFailed', (peer) => {
      // local ice failure
    });
    this.webrtc.on('connectivityError', (peer) => {
      // remote ice failure
    });


    // sending mute/unmute to all peers
    this.webrtc.on('audioOn', () => {
      self.webrtc.sendToAll('unmute', { name: 'audio' });
    });
    this.webrtc.on('audioOff', () => {
      self.webrtc.sendToAll('mute', { name: 'audio' });
    });
    this.webrtc.on('videoOn', () => {
      self.webrtc.sendToAll('unmute', { name: 'video' });
    });
    this.webrtc.on('videoOff', () => {
      self.webrtc.sendToAll('mute', { name: 'video' });
    });

    // screensharing events
    this.webrtc.on('localScreen', (stream) => {
      let item;
      const el = document.createElement('video');
      const container = self.getRemoteVideoContainer();

      el.oncontextmenu = () => false;
      el.id = 'localScreen';
      attachMediaStream(stream, el);
      if (container) {
        container.appendChild(el);
      }

      self.emit('localScreenAdded', el);
      self.connection.emit('shareScreen');

      self.webrtc.peers.forEach((existingPeer) => {
        let peer;
        if (existingPeer.type === 'video') {
          peer = self.webrtc.createPeer({
            id: existingPeer.id,
            type: 'screen',
            sharemyscreen: true,
            enableDataChannels: false,
            receiveMedia: {
              offerToReceiveAudio: 0,
              offerToReceiveVideo: 0,
            },
            broadcaster: self.connection.getSessionid(),
          });
          self.emit('createdPeer', peer);
          peer.start();
        }
      });
    });
    this.webrtc.on('localScreenStopped', (stream) => {
      if (self.getLocalScreen()) {
        self.stopScreenShare();
      }
      /*
          self.connection.emit('unshareScreen');
          self.webrtc.peers.forEach(function (peer) {
              if (peer.sharemyscreen) {
                  peer.end();
              }
          });
          */
    });

    this.webrtc.on('channelMessage', (peer, label, data) => {
      if (data.type === 'volume') {
        self.emit('remoteVolumeChange', data.payload, peer);
      } else {
        self.emit('receivedPeerData', data.type, data.payload, peer);
      }
    });

    if (this.config.autoRequestMedia) this.startLocalVideo();
  }

  leaveRoom() {
    if (this.roomName) {
      this.connection.emit('leave');
      while (this.webrtc.peers.length) {
        this.webrtc.peers[0].end();
      }
      if (this.getLocalScreen()) {
        this.stopScreenShare();
      }
      this.emit('leftRoom', this.roomName);
      this.roomName = undefined;
    }
  }

  disconnect() {
    this.connection.disconnect();
    delete this.connection;
  }

  handlePeerStreamAdded(peer) {
    const self = this;

    this.emit('videoAdded', peer.stream, peer);

    // send our mute status to new peer if we're muted
    // currently called with a small delay because it arrives before
    // the video element is created otherwise (which happens after
    // the async setRemoteDescription-createAnswer)
    setTimeout(() => {
      if (!self.webrtc.isAudioEnabled()) {
        peer.send('mute', { name: 'audio' });
      }
      if (!self.webrtc.isVideoEnabled()) {
        peer.send('mute', { name: 'video' });
      }
    }, 250);
  }

  handlePeerStreamRemoved(peer) {
    this.emit('videoRemoved', peer);
  }

  getId(peer) {
    return [peer.id, peer.type, peer.broadcaster ? 'broadcasting' : 'incoming'].join('_');
  }

  getContainerId(peer) {
    return `container_${this.getId(peer)}`;
  }

  // set volume on video tag for all peers takse a value between 0 and 1
  setVolumeForAll(volume) {
    this.webrtc.peers.forEach((peer) => {
      if (peer.videoEl) peer.videoEl.volume = volume;
    });
  }

  joinRoom(name, cb) {
    const self = this;
    this.roomName = name;
    this.connection.emit('join', name, (err, roomDescription) => {
      if (err) {
        self.emit('error', err);
      } else {
        let id;
        let client;
        let type;
        let peer;

        for (id in roomDescription.clients) {
          client = roomDescription.clients[id];
          for (type in client) {
            if (client[type]) {
              peer = self.webrtc.createPeer({
                id,
                type,
                enableDataChannels: self.config.enableDataChannels && type !== 'screen',
                receiveMedia: {
                  offerToReceiveAudio: type !== 'screen' && !self.config.dataOnly && self.config.receiveMedia.offerToReceiveAudio ? 1 : 0,
                  offerToReceiveVideo: !self.config.dataOnly && self.config.receiveMedia.offerToReceiveVideo,
                },
              });
              self.emit('createdPeer', peer);
              peer.start();
            }
          }
        }
      }

      if (cb) cb(err, roomDescription);
      self.emit('joinedRoom', name);
    });
  }

  startLocalVideo() {
    const self = this;
    this.webrtc.start(this.config.media, (err, stream) => {
      if (err) {
        self.emit('localMediaError', err);
      } else {
        attachMediaStream(stream, this.config.localVideoEl, { muted: true });
      }
    });
  }

  attachStream(stream, el) {
    attachMediaStream(stream, el);
  }

  stopLocalVideo() {
    this.webrtc.stop();
  }

  shareScreen(cb) {
    this.webrtc.startScreenShare(cb);
  }

  getLocalScreen() {
    return this.webrtc.localScreens && this.webrtc.localScreens[0];
  }

  stopScreenShare() {
    this.connection.emit('unshareScreen');
    const videoEl = document.getElementById('localScreen');
    const container = this.getRemoteVideoContainer();

    if (this.config.autoRemoveVideos && container && videoEl) {
      container.removeChild(videoEl);
    }

    // a hack to emit the event the removes the video
    // element that we want
    if (videoEl) {
      this.emit('videoRemoved', videoEl);
    }
    if (this.getLocalScreen()) {
      this.webrtc.stopScreenShare();
    }
    this.webrtc.peers.forEach((peer) => {
      if (peer.broadcaster) {
        peer.end();
      }
    });
  }

  attachStream(stream, el) {
    attachMediaStream(stream, el);
  }

  testReadiness() {
    const self = this;
    if (this.sessionReady) {
      if (this.config.dataOnly || (!this.config.media.video && !this.config.media.audio)) {
        self.emit('readyToCall', self.connection.getSessionid());
      } else if (this.webrtc.localStreams.length > 0) {
        self.emit('readyToCall', self.connection.getSessionid());
      }
    }
  }

  createRoom(name, cb) {
    this.roomName = name;
    if (arguments.length === 2) {
      this.connection.emit('create', name, cb);
    } else {
      this.connection.emit('create', name);
    }
  }

  sendFile() {
    if (!webrtcSupport.dataChannel) {
      return this.emit('error', new Error('DataChannelNotSupported'));
    }
  }
}

export default LioWebRTC;
