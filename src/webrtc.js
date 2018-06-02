import util from 'util';
import mockconsole from 'mockconsole';
import LocalMedia from './localmedia';
import Peer from './peer';
import webrtcSupport from './webrtcsupport';

class WebRTC extends LocalMedia {
  constructor(opts) {
    super(opts);
    const self = this;
    const options = opts || {};
    const config = this.config = {
      debug: false,
      peerConnectionConfig: {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      },
      peerConnectionConstraints: {
        optional: [],
      },
      receiveMedia: {
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1,
      },
      enableDataChannels: true,
    };
    let item;

    this.logger = ((() => {
      // we assume that if you're in debug mode and you didn't
      // pass in a logger, you actually want to log as much as
      // possible.
      if (opts.debug) {
        return opts.logger || console;
      }
      // or we'll use your logger which should have its own logic
      // for output. Or we'll return the no-op.
      return opts.logger || mockconsole;
    })());

    // set options
    for (item in options) {
      if (options.hasOwnProperty(item)) {
        this.config[item] = options[item];
      }
    }

    // check for support
    if (!webrtcSupport.support) {
      this.logger.error('Your browser doesn\'t seem to support WebRTC');
    }

    // where we'll store our peer connections
    this.peers = [];

    // call localMedia constructor
    // localMedia.call(this, this.config);

    this.on('speaking', () => {
      if (!self.hardMuted) {
        self.peers.forEach((peer) => {
          if (peer.enableDataChannels) {
            const dc = peer.getDataChannel('liowebrtc');
            if (dc.readyState !== 'open') return;
            dc.sendDirectlyToAll(JSON.stringify({ type: 'speaking' }));
          }
        });
      }
    });
    this.on('stoppedSpeaking', () => {
      if (!self.hardMuted) {
        self.peers.forEach((peer) => {
          if (peer.enableDataChannels) {
            const dc = peer.getDataChannel('liowebrtc');
            if (dc.readyState !== 'open') return;
            dc.sendDirectlyToAll(JSON.stringify({ type: 'stoppedSpeaking' }));
          }
        });
      }
    });
    this.on('volumeChange', (volume, treshold) => {
      if (!self.hardMuted) {
        self.peers.forEach((peer) => {
          if (peer.enableDataChannels) {
            const dc = peer.getDataChannel('liowebrtc');
            if (dc.readyState !== 'open') return;
            dc.sendDirectlyToAll(JSON.stringify({ type: 'payload', volume }));
          }
        });
      }
    });

    // log events in debug mode
    if (this.config.debug) {
      this.on('*', (event, val1, val2) => {
        let logger;
        // if you didn't pass in a logger and you explicitly turning on debug
        // we're just going to assume you're wanting log output with console
        if (self.config.logger === mockconsole) {
          logger = console;
        } else {
          logger = self.logger;
        }
        logger.log('event:', event, val1, val2);
      });
    }
  }

  createPeer(opts) {
    let peer;
    opts.parent = this;
    peer = new Peer(opts);
    this.peers.push(peer);
    return peer;
  }

  // removes peers
  removePeers(id, type) {
    this.getPeers(id, type).forEach((peer) => {
      peer.end();
    });
  }

  // fetches all Peer objects by session id and/or type
  getPeers(sessionId, type) {
    return this.peers.filter(peer => (!sessionId || peer.id === sessionId) && (!type || peer.type === type));
  }

  // sends message to all
  sendToAll(message, payload) {
    this.peers.forEach((peer) => {
      peer.send(message, payload);
    });
  }

  // sends message to all using a datachannel
  // only sends to anyone who has an open datachannel
  sendDirectlyToAll(message, payload, channel) {
    this.peers.forEach((peer) => {
      if (peer.enableDataChannels) {
        peer.sendDirectly(message, payload, channel);
      }
    });
  }

  shout(messageLabel, payload) {
    this.sendDirectlyToAll(messageLabel, payload, 'liowebrtc');
  }

  whisper(peer, messageLabel, payload) {
    peer.sendDirectly(messageLabel, payload);
  }
}

export default WebRTC;
