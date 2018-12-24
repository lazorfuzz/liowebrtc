import PeerConnection from 'rtcpeerconnection';
import WildEmitter from 'wildemitter';
import FileTransfer from 'filetransfer';
import webrtcSupport from './webrtcsupport';

function isAllTracksEnded(stream) {
  let isAllTracksEnded = true;
  stream.getTracks().forEach((t) => {
    isAllTracksEnded = t.readyState === 'ended' && isAllTracksEnded;
  });
  return isAllTracksEnded;
}

class Peer extends WildEmitter {
  constructor(options) {
    super();
    const self = this;
    this.id = options.id;
    this.parent = options.parent;
    this.type = options.type || 'video';
    this.oneway = options.oneway || false;
    this.sharemyscreen = options.sharemyscreen || false;
    this.browserPrefix = options.prefix;
    this.stream = options.stream;
    this.enableDataChannels = options.enableDataChannels === undefined ? this.parent.config.enableDataChannels : options.enableDataChannels;
    this.receiveMedia = options.receiveMedia || this.parent.config.receiveMedia;
    this.channels = {};
    this.sid = options.sid || Date.now().toString();
    // Create an RTCPeerConnection via the polyfill
    this.pc = new PeerConnection(this.parent.config.peerConnectionConfig, this.parent.config.peerConnectionConstraints);
    this.pc.on('ice', this.onIceCandidate.bind(this));
    this.pc.on('endOfCandidates', (event) => {
      self.send('endOfCandidates', event);
    });
    this.pc.on('offer', (offer) => {
      if (self.parent.config.nick) offer.nick = self.parent.config.nick;
      self.send('offer', offer);
    });
    this.pc.on('answer', (answer) => {
      if (self.parent.config.nick) answer.nick = self.parent.config.nick;
      self.send('answer', answer);
    });
    this.pc.on('addStream', this.handleRemoteStreamAdded.bind(this));
    this.pc.on('addChannel', this.handleDataChannelAdded.bind(this));
    this.pc.on('removeStream', this.handleStreamRemoved.bind(this));
    // Just fire negotiation needed events for now
    // When browser re-negotiation handling seems to work
    // we can use this as the trigger for starting the offer/answer process
    // automatically. We'll just leave it be for now while this stabalizes.
    this.pc.on('negotiationNeeded', this.emit.bind(this, 'negotiationNeeded'));
    this.pc.on('iceConnectionStateChange', this.emit.bind(this, 'iceConnectionStateChange'));
    this.pc.on('iceConnectionStateChange', () => {
      switch (self.pc.iceConnectionState) {
        case 'failed':
          // currently, in chrome only the initiator goes to failed
          // so we need to signal this to the peer
          if (self.pc.pc.localDescription.type === 'offer') {
            self.parent.emit('iceFailed', self);
            self.send('connectivityError');
          }
          break;
        case 'closed':
          this.handleStreamRemoved(false);
          break;
        default:
          break;
      }
    });
    this.pc.on('signalingStateChange', this.emit.bind(this, 'signalingStateChange'));
    this.logger = this.parent.logger;

    this.parent.localStreams.forEach((stream) => {
      self.pc.addStream(stream);
    });

    this.on('channelOpen', (channel) => {
    });

    // proxy events to parent
    this.on('*', function () {
      self.parent.emit(...arguments);
    });
  }

  handleMessage(message) {
    const self = this;
    this.logger.log('getting', message.type, message);
    if (message.prefix) this.browserPrefix = message.prefix;

    if (message.type === 'offer') {
      if (!this.nick) {
        const n = message.payload.nick;
        this.nick = n;
      }
      // delete message.payload.nick;
      this.pc.handleOffer(message.payload, (err) => {
        if (err) {
          return;
        }
        // auto-accept
        self.pc.answer((err, sessionDescription) => {
          // self.send('answer', sessionDescription);
          // console.log('answering', sessionDescription);
        });
      });
    } else if (message.type === 'answer') {
      if (!this.nick) this.nick = message.payload.nick;
      delete message.payload.nick;
      this.pc.handleAnswer(message.payload);
    } else if (message.type === 'candidate') {
      this.pc.processIce(message.payload);
    } else if (message.type === 'connectivityError') {
      this.parent.emit('connectivityError', self);
    } else if (message.type === 'mute') {
      this.parent.emit('mute', { id: message.from, name: message.payload.name });
    } else if (message.type === 'unmute') {
      this.parent.emit('unmute', { id: message.from, name: message.payload.name });
    } else if (message.type === 'endOfCandidates') {
      // Edge requires an end-of-candidates. Since only Edge will have mLines or tracks on the
      // shim this will only be called in Edge.
      const mLines = this.pc.pc.transceivers || [];
      mLines.forEach((mLine) => {
        if (mLine.iceTransport) {
          mLine.iceTransport.addRemoteCandidate({});
        }
      });
    } else if (message.type === 'signalData') {
      this.parent.emit('receivedSignalData', message.payload.type, message.payload.payload, self);
    }
  }

  // send via signaling channel
  send(messageType, payload) {
    const message = {
      to: this.id,
      sid: this.sid,
      broadcaster: this.broadcaster,
      roomType: this.type,
      type: messageType,
      payload,
      prefix: webrtcSupport.prefix,
      timestamp: Date.now()
    };
    this.logger.log('sending', messageType, message);
    this.parent.emit('message', message);
  }

  // send via data channel
  // returns true when message was sent and false if channel is not open
  sendDirectly(messageType, payload, channel = 'liowebrtc', shout = false, messageId = `${Date.now()}_${Math.random() * 1000000}`) {
    const message = {
      type: messageType,
      payload,
      _id: messageId,
      shout,
    };
    this.logger.log('sending via datachannel', channel, messageType, message);
    const dc = this.getDataChannel(channel);
    if (dc.readyState !== 'open') return false;
    dc.send(JSON.stringify(message));
    return true;
  }

  // Internal method registering handlers for a data channel and emitting events on the peer
  _observeDataChannel(channel) {
    const self = this;
    channel.onclose = this.emit.bind(this, 'channelClose', channel);
    channel.onerror = this.emit.bind(this, 'channelError', channel);
    channel.onmessage = (event) => {
      self.emit('channelMessage', self, channel.label, JSON.parse(event.data), channel, event);
    };
    channel.onopen = this.emit.bind(this, 'channelOpen', channel);
  }

  // Fetch or create a data channel by the given name
  getDataChannel(name = 'liowebrtc', opts) {
    let channel = this.channels[name];
    opts || (opts = {});
    if (channel) return channel;
    // if we don't have one by this label, create it
    channel = this.channels[name] = this.pc.createDataChannel(name, opts);
    this._observeDataChannel(channel);
    return channel;
  }

  onIceCandidate(candidate) {
    if (this.closed) return;
    if (candidate) {
      const pcConfig = this.parent.config.peerConnectionConfig;
      if (webrtcSupport.prefix === 'moz' && pcConfig && pcConfig.iceTransports &&
                  candidate.candidate && candidate.candidate.candidate &&
                  !candidate.candidate.candidate.includes(pcConfig.iceTransports)) {
        this.logger.log('Ignoring ice candidate not matching pcConfig iceTransports type: ', pcConfig.iceTransports);
      } else {
        this.send('candidate', candidate);
      }
    } else {
      this.logger.log('End of candidates.');
    }
  }

  start() {
    const self = this;

    // well, the webrtc api requires that we either
    // a) create a datachannel a priori
    // b) do a renegotiation later to add the SCTP m-line
    // Let's do (a) first...
    if (this.enableDataChannels) {
      this.getDataChannel('liowebrtc');
    }

    this.pc.offer(this.receiveMedia, (err, sessionDescription) => {
      // self.send('offer', sessionDescription);
    });
  }

  icerestart() {
    const constraints = this.receiveMedia;
    constraints.mandatory.IceRestart = true;
    this.pc.offer(constraints, (err, success) => { });
  }

  end(emitRemoval = true) {
    if (this.closed) return;
    this.pc.close();
    this.handleStreamRemoved(emitRemoval);
    if (emitRemoval) {
      this.parent.emit('removedPeer', this);
    }
  }

  handleRemoteStreamAdded(event) {
    const self = this;
    if (this.stream) {
      this.logger.warn('Already have a remote stream');
    } else {
      this.stream = event.stream;

      this.stream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (isAllTracksEnded(self.stream)) {
            self.end();
          }
        });
      });

      this.parent.emit('peerStreamAdded', this.stream, this);
    }
  }

  handleStreamRemoved(emitRemoval = true) {
    const peerIndex = this.parent.peers.indexOf(this);
    if (peerIndex > -1) {
      this.parent.peers.splice(peerIndex, 1);
      this.closed = true;
      if (emitRemoval) this.parent.emit('peerStreamRemoved', this);
    }
  }

  handleDataChannelAdded(channel) {
    this.channels[channel.label] = channel;
    this._observeDataChannel(channel);
  }

  sendFile(file) {
    const sender = new FileTransfer.Sender();
    const dc = this.getDataChannel(`filetransfer${(new Date()).getTime()}`, {
      protocol: INBAND_FILETRANSFER_V1,
    });
      // override onopen
    dc.onopen = () => {
      dc.send(JSON.stringify({
        size: file.size,
        name: file.name,
      }));
      sender.send(file, dc);
    };
    // override onclose
    dc.onclose = () => {
      // ('sender received transfer');
      sender.emit('complete');
    };
    return sender;
  }
}

export default Peer;
