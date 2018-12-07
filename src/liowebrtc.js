import WildEmitter from 'wildemitter';
import attachMediaStream from 'attachmediastream';
import mockconsole from 'mockconsole';
import WebRTC from './webrtc';
import webrtcSupport from './webrtcsupport';
import SocketIoConnection from './socketioconnection';
import { Graph, addNode, addConnection, removeConnection, getNeighbors, isNeighbor, getDroppablePeer } from './PeerOptimizer';
import { inheritedMethods, defaultConfig, defaultChannel } from './constants';

class LioWebRTC extends WildEmitter {
  constructor(opts) {
    super();
    const self = this;
    const options = opts || {};
    this.config = defaultConfig;
    const config = this.config;

    this.peerDataCache = {};
    this.unconnectivePeers = {};
    this.id = '';
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
    this.capabilities = webrtcSupport;
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
        if (this.config.dataOnly && this.config.constraints.maxPeers > 0 && totalPeers >= this.config.constraints.maxPeers) {
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
          if (this.config.dataOnly || this.config.constraints.maxPeers > 0) {
            this.sendPing(peer, peer.id, true);
          } else {
            peer.start();
            this.emit('createdPeer', peer);
          }
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

    opts.logger = this.logger;
    opts.debug = false;
    this.webrtc = new WebRTC(opts);
    inheritedMethods.forEach((method) => {
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

    self.on('removedPeer', (peer) => {
      if (peer.id) {
        removeConnection(this.id, peer.id);
      }
    });

    self.on('channelClose', (channel) => {
      if (channel.label === 'liowebrtc' &&
        this.config.dataOnly &&
        this.config.constraints.maxPeers > 0 &&
        getNeighbors(this.id).length < this.config.constraints.minPeers) {
        this.connectToRandomPeer();
      }
    });

    this.webrtc.on('channelMessage', (peer, label, data) => {
      if (data.payload._id && this.peerDataCache[data.payload._id]) {
        return;
      }
      switch (data.type) {
        case '_volume':
          self.emit('remoteVolumeChange', data.payload, peer);
          break;
        case '_propagate':
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
        case '_ping':
          this.sendPong(peer, data.payload);
          break;
        case '_pong':
          addConnection(this.id, peer.id, (Date.now() - data.payload[0]) + data.payload[1]);
          break;
        case '_connections':
          data.payload.forEach(connection => addConnection(peer.id, connection.id, connection.weight));
          break;
        default:
          if (this.seenPeerEvent(data._id)) {
            return;
          }
          this.cachePeerEvent(data._id, peer.id);
          self.emit('receivedPeerData', data.type, data.payload, peer);
          if (this.config.constraints.maxPeers > 0 && data.shout) {
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
    if (Object.keys(this.peerDataCache).length > 1024) {
      // Sort by timestamp
      const sortedCache = Object.entries(this.peerDataCache).sort((a, b) => a[1].timestamp - b[1].timestamp);
      // Delete oldest item
      delete this.peerDataCache[sortedCache[0][0]];
    }
  }

  seenPeerEvent(eventId) {
    if (this.peerDataCache[eventId]) {
      return true;
    }
    return false;
  }

  sendPong(peer, start, channel = defaultChannel) {
    const now = Date.now();
    peer.sendDirectly('_pong', [now, now - start], channel);
  }

  sendPing(peer, peerId, firstPing = false, channel = defaultChannel) {
    if (firstPing) peer.start();
    setTimeout(this.ping.bind(this, peer, peerId, firstPing, channel), 1000);
  }

  ping(peer, peerId, firstPing, channel, tries = 0) {
    if (peer.sendDirectly('_ping', Date.now(), channel)) {
      // this.logger.log('sent ping to', peer.id);
      if (firstPing) this.emit('createdPeer', peer);
    } else {
      // The channel is closed
      if (tries === 2) {
        this.unconnectivePeers[peerId] = true;
        peer.end(false);
        return;
      }
      setTimeout(this.ping.bind(this, peer, peerId, firstPing, channel, tries + 1), 1000);
    }
  }

  connectToRandomPeer() {
    this.getClients((err, clients) => {
      const ids = Object.keys(clients).filter(c => !(this.unconnectivePeers[c] === true || c === this.id || isNeighbor(this.id, c)));
      if (ids.length) {
        const randId = ids[Math.floor(Math.random() * ids.length)];
        this.connectToPeer(randId, clients[randId]);
      }
    });
  }

  sendConnections(peer, channel = defaultChannel) {
    if (peer.sendDirectly('_connections', this.getPeers().map((p) => {
      const edge = Graph.findEdge(this.id, p.id);
      return { id: p.id, weight: edge.getWeight() };
    }), channel)) {
      // connections sent
    } else {
      peer.end();
    }
  }

  propagateMessage(data, channel = defaultChannel) {
    this.getPeers()
      .forEach((peer) => {
        if (!this.peerDataCache[data._id]) {
          this.cachePeerEvent(data._id, data.senderId);
        }
        if (!this.peerDataCache[data._id].recipients[peer.id]) {
          peer.sendDirectly('_propagate', data, channel, true);
        }
      });
  }

  trimPeers() {
    const pid = getDroppablePeer();
    const peer = this.webrtc.getPeerById(pid);
  }

  leaveRoom() {
    if (this.roomName) {
      this.connection.emit('leave');
      while (this.webrtc.peers.length) {
        this.webrtc.peers[0].end();
      }
      this.emit('leftRoom', this.roomName);
      this.roomName = undefined;
    }
  }

  disconnect() {
    this.connection.disconnect();
    delete this.connection;
  }

  handlePeerStreamAdded(stream, peer) {
    const self = this;
    //this.emit('peerStreamAdded', stream, peer);

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
    // (this.config.media.video) this.emit('peerStreamRemoved', peer);
  }

  getDomId(peer) { // eslint-disable-line
    return [peer.id, peer.type, peer.broadcaster ? 'broadcasting' : 'incoming'].join('_');
  }

  getMyId() {
    return this.id;
  }

  getContainerId(peer) {
    return `container_${this.getDomId(peer)}`;
  }

  // set volume on video tag for all peers takse a value between 0 and 1
  setVolumeForAll(volume) {
    this.webrtc.peers.forEach((peer) => {
      if (peer.videoEl) peer.videoEl.volume = volume;
    });
  }

  getClients(callback) {
    this.connection.emit('getClients', this.roomName, (err, clients) => {
      if (callback) callback(err, clients.clients);
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
        // console.log(roomDescription);
        this.id = roomDescription.you;
        addNode(this.id);
        this.unconnectivePeers[this.id] = true;
        for (id of Object.keys(roomDescription.clients).reverse().filter(item => item !== this.id)) {
          client = roomDescription.clients[id];
          for (type in client) {
            if (client[type]) {
              const peerCount = this.webrtc.getPeers().length;
              if (this.config.dataOnly && this.config.constraints.maxPeers > 0 && (peerCount >= this.config.constraints.minPeers || peerCount >= this.config.constraints.maxPeers)) {
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
              if (this.config.dataOnly || this.config.constraints.maxPeers > 0) {
                this.sendPing(peer, peer.id, true);
              } else {
                peer.start();
                this.emit('createdPeer', peer);
              }
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
      if (this.config.dataOnly || (!this.config.media.video && !this.config.media.audio) || this.webrtc.localStreams.length > 0) {
        self.emit('ready', self.connection.getSessionid());
      }
    }
  }

  connectToPeer(peerId, client) {
    let type;
    let peer;
    for (type in client) {
      if (client[type]) {
        const peerCount = this.webrtc.getPeers().length;
        if (this.config.constraints.maxPeers > 0 && peerCount >= this.config.constraints.maxPeers) {
          break;
        }
        peer = this.webrtc.createPeer({
          id: peerId,
          type,
          enableDataChannels: this.config.enableDataChannels && type !== 'screen',
          receiveMedia: {
            offerToReceiveAudio: type !== 'screen' && !this.config.dataOnly && this.config.receiveMedia.offerToReceiveAudio ? 1 : 0,
            offerToReceiveVideo: !this.config.dataOnly && this.config.receiveMedia.offerToReceiveVideo ? 1 : 0,
          },
        });
        if (this.config.dataOnly || this.config.constraints.maxPeers > 0) {
          this.sendPing(peer, peerId, true);
        } else {
          peer.start();
          this.emit('createdPeer', peer);
        }
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
