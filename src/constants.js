export const inheritedMethods = [
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
];

export const defaultConfig = {
  url: 'https://sm1.lio.app:443/',
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
  constraints: {
    maxPeers: 0,
    minPeers: 2
  },
  selfOptimize: true
};

export const defaultChannel = 'liowebrtc';
