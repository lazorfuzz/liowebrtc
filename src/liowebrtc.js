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
        mirror: true,
        muted: true,
        audio: false,
      },
      network: {
        maxPeers: 4,
        minPeers: 2
      },
    };

    this.peerDataCache = {};
    this.roomCount = 0;
    this.roomName = '';

    let connection;
    // Set up logger
    this.logger = ((() => {
      if (opts.debug) {
        return opts.logger || console;
      }
      return opts.logger || mockconsole;
    })());

    // Set our config from options
    Object.keys(options).forEach((o) => {
      this.config[o] = options[o];
    });

    if (options.dataOnly) {
      this.config.media.video = false;
      this.config.media.audio = false;
      this.config.receiveMedia.offerToReceiveAudio = false;
      this.config.receiveMedia.offerToReceiveVideo = false;
    }

    if (!this.config.media.video && this.config.media.audio) {
      this.config.localVideo.audio = true;
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
      const totalPeers = self.webrtc.getPeers().length;
      let peer;

      if (message.type === 'offer') {
        if (peers.length) {
          peers.forEach((p) => {
            if (p.sid === message.sid) peer = p;
          });
          // if (!peer) peer = peers[0]; // fallback for old protocol versions
        }
        if (this.config.network.maxPeers > 0 && totalPeers >= this.config.network.maxPeers) {
          return;
        }
        if (!peer) {
          peer = self.webrtc.createPeer({
            id: message.from,
            sid: message.sid,
            type: message.roomType,
            enableDataChannels: self.config.enableDataChannels,
            sharemyscreen: message.roomType === 'screen' && !message.broadcaster,
            broadcaster: message.roomType === 'screen' && !message.broadcaster ? self.connection.getSessionid() : null,
          });
          self.emit('createdPeer', peer);
        } else {
          return;
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
    [
      'mute',
      'unmute',
      'pauseVideo',
      'resumeVideo',
      'pause',
      'resume',
      'sendToAll',
      'sendDirectlyToAll',
      'getPeers',
      'getPeerByNick',
      'getPeerById',
      'shout',
      'whisper',
      'broadcast',
      'transmit',
    ].forEach((method) => {
      self[method] = self.webrtc[method].bind(self.webrtc);
    });

    // proxy events from WebRTC
    this.webrtc.on('*', function () { // eslint-disable-line
      self.emit(...arguments); // eslint-disable-line
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
    this.webrtc.on('removedPeer', this.handlePeerStreamRemoved.bind(this));

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
    /*
    this.webrtc.on('iceFailed', (peer) => {
      // local ice failure
    });
    this.webrtc.on('connectivityError', (peer) => {
      // remote ice failure
    });
*/

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

    this.webrtc.on('channelMessage', (peer, label, data) => {
      if (data.payload._id && this.peerDataCache[data.payload._id]) {
        return;
      }
      switch (data.type) {
        case 'volume':
          self.emit('remoteVolumeChange', data.payload, peer);
          break;
        case 'propagate':
          if (this.seenPeerEvent(data.payload._id)) {
            return;
          }
          // Re-propagate message
          this.propagateMessage(data.payload);
          this.cachePeerEvent(data.payload._id, data.payload.senderId);
          // Emit the propagated data as if it were received directly
          self.emit('receivedPeerData', data.payload.type, data.payload.payload, {
            id: data.payload.senderId,
            nick: data.payload.senderNick,
            isForwarded: true,
          });
          break;
        default:
          if (this.seenPeerEvent(data._id)) {
            return;
          }
          this.cachePeerEvent(data._id, peer.id);
          self.emit('receivedPeerData', data.type, data.payload, peer);
          if (this.config.network.maxPeers > 0 && data.shout) {
            data.senderId = peer.id;
            const fwdData = Object.assign({}, { senderId: peer.id, senderNick: peer.nick }, data);
            this.propagateMessage(fwdData);
          }
          break;
      }
    });

    if (this.config.autoRequestMedia) this.startLocalVideo();
  }

  cachePeerEvent(eventId, peerId) {
    if (!this.peerDataCache[eventId]) {
      this.peerDataCache[eventId] = {
        recipients: {
          [peerId]: true
        },
        timestamp: Date.now(),
      };
      return;
    }
    if (!this.peerDataCache[eventId].recipients[peerId]) {
      this.peerDataCache[eventId].recipients[peerId] = true;
    }
    if (Object.keys(this.peerDataCache).length > 500) {
      // Object.keys(this.peerDataCache).re
    }
  }

  seenPeerEvent(eventId) {
    if (this.peerDataCache[eventId]) {
      return true;
    }
    return false;
  }

  propagateMessage(data, channel = 'liowebrtc') {
    this.getPeers()
      .forEach((peer) => {
        if (!this.peerDataCache[data._id]) {
          this.cachePeerEvent(data._id, data.senderId);
        }
        if (!this.peerDataCache[data._id].recipients[peer.id]) {
          peer.sendDirectly('propagate', data, channel, true);
        }
      });
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
    // if (this.config.media.video) this.emit('videoRemoved', peer);
  }

  getId(peer) { // eslint-disable-line
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

        this.roomCount = Object.keys(roomDescription.clients).length;

        for (id of Object.keys(roomDescription.clients).reverse()) {
          client = roomDescription.clients[id];
          for (type in client) {
            if (client[type]) {
              const peerCount = this.webrtc.getPeers().length;
              if (this.config.network.maxPeers > 0 && (peerCount >= this.config.network.minPeers || peerCount >= this.config.network.maxPeers)) {
                break;
              }
              peer = self.webrtc.createPeer({
                id,
                type,
                enableDataChannels: self.config.enableDataChannels && type !== 'screen',
                receiveMedia: {
                  offerToReceiveAudio: type !== 'screen' && !this.config.dataOnly && this.config.receiveMedia.offerToReceiveAudio ? 1 : 0,
                  offerToReceiveVideo: !this.config.dataOnly && self.config.receiveMedia.offerToReceiveVideo ? 1 : 0,
                },
              });
              self.emit('createdPeer', peer);
              peer.start();
              if (this.config.debug) console.log('CREATED PEER');
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
        attachMediaStream(stream, this.config.localVideoEl, this.config.localVideo);
      }
    });
  }

  attachStream(stream, el, opts) { // eslint-disable-line
    const options = {
      autoplay: true,
      muted: false,
      mirror: true,
      audio: false,
    };
    attachMediaStream(stream, el, opts || options);
  }

  setLocalVideo(element) {
    this.config.localVideoEl = element;
  }

  stopLocalVideo() {
    this.webrtc.stop();
  }

  quit() {
    this.stopLocalVideo();
    this.leaveRoom();
    this.disconnect();
  }

  testReadiness() {
    const self = this;
    if (this.sessionReady) {
      if (this.config.dataOnly || (!this.config.media.video && !this.config.media.audio)) {
        self.emit('ready', self.connection.getSessionid());
      } else if (this.webrtc.localStreams.length > 0) {
        self.emit('ready', self.connection.getSessionid());
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
