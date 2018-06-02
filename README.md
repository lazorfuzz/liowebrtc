# LioWebRTC
An Electron-compatible, event-based WebRTC library that makes it easy to embed peer to peer communication into React components.

LioWebRTC was built on SimpleWebRTC, and modified to be compatible with React, JSX, and Electron.

[Click here](https://chatdemo.razorfart.com/) to see a chatroom demo app built with React and LioWebRTC.

## Usage

### Installation

```js
yarn add liowebrtc
// Or
npm i liowebrtc
```

### Import LioWebRTC
```js
import LioWebRTC from 'liowebrtc';
```

### Create LioWebRTC instance
By default, this enables video, audio, and data channels.
```js
const webrtc = new LioWebRTC({
    // The local video ref set within your render function, or the element's ID
    localVideoEl: 'localVid',
    // Immediately request camera and mic access.
    autoRequestMedia: true,
    // Displays events emitted by the webrtc object in the console.
    debug: true,
    // The url for your signaling server
    url: 'https://sandbox.simplewebrtc.com:443/',
});
```

### Join a room once it's ready

```js
webrtc.on('readyToCall', () => {
    // Create or join a room with any name
    webrtc.joinRoom('your room name');
});
```

### Emitting to the hive
Sometimes a peer wants to let every other peer in the room to know about something. This can be accomplished with 
```shout(messageType, payload)```
```js
webrtc.shout('taskCompleted', { success: true, id: '137' });
```
Now for the recipients, handle the peer event with a listener:
```js
webrtc.on('receivedPeerData', (type, data, peer) => {
    if (type === 'taskCompleted' && data.success) {
        console.log(`Peer ${peer.id} completed task ${data.id}`);
    }
});
```

### Communicating with a single peer
Sometimes a peer only wants to send data directly to another peer. This can be accomplished with 
```whisper(peer, messageType, payload)```
```js
webrtc.whisper(peer, 'directMessage', { msg: 'Hello world!' });
```
Receiving the message is the same as handling a peer event:
```js
webrtc.on('receivedPeerData', (type, data, peer) => {
    if (type === 'directMessage') console.log(`Peer ${peer.id} says: ${data.msg}`);
});
```

### Live-syncing state
```js
componentDidUpdate(prevProps, prevState) {
    if (this.state.position !== prevState.position) {
        this.webrtc.shout('stateUpdate', this.state);
    }
}

this.webrtc.on('receivedPeerData', (type, state, peer) => {
    if (type === 'stateUpdate') this.setState({ peerState: state });
});
```

All communications via shout/whisper are sent over the default data channel and emitted by the LioWebRTC instance as events. You can create your own custom listeners suited for whatever purpose you'd like.

### Data channels only
Disable webcam/mic streaming, and only enable data channel.
```js
const webrtc = new LioWebRTC({
    // The url for your signaling server
    url: 'https://sandbox.simplewebrtc.com:443/',
    dataOnly: true
});
```
### Audio and data channels only
Great for voice chatting.
```js
const webrtc = new LioWebRTC({
    // The url for your signaling server
    url: 'https://sandbox.simplewebrtc.com:443/',
    autoRequestMedia: true,
    media: {
        video: false,
        audio: true
    }
});
```

## Example

### P2P Video Chat Component
```jsx
import React, { Component } from 'react';
import LioWebRTC from 'liowebrtc';

class Party extends Component {
  constructor(props) {
    super(props);
    this.state = {
      nick: this.props.nick,
      peers: [],
      roomID: `party-${this.props.roomName}`,
      muted: false,
      camPaused: false
    };
    this.remoteVideos = {};
  }

  componentDidMount() {
    this.webrtc = new LioWebRTC({
      // The url for your signaling server
      url: 'https://sandbox.simplewebrtc.com:443/',
      // The local video reference set within your render function
      localVideoEl: this.localVid,
      // Immediately request camera access
      autoRequestMedia: true,
      // Optional: The nickname of the peer in the room
      nick: this.state.nick,
    });

    this.webrtc.on('videoAdded', this.addVideo);
    this.webrtc.on('videoRemoved', this.removeVideo);
    this.webrtc.on('readyToCall', this.readyToCall);
    this.webrtc.on('iceFailed', this.handleConnectionError);
    this.webrtc.on('connectivityError', this.handleConnectionError);
  }
  
  addVideo = (stream, peer) => {
    this.setState({
      peers: [...this.state.peers, peer]
    }, () => {
      this.webrtc.attachStream(stream, this.remoteVideos[peer.id]);
    });
  }
  
  removeVideo = (video, peer) => {
    this.setState({
      peers: this.state.peers.filter(p => p.id)
    });
  }
  
  handleConnectionError = (peer) => {
    const pc = peer.pc;
    console.log('had local relay candidate', pc.hadLocalRelayCandidate);
    console.log('had remote relay candidate', pc.hadRemoteRelayCandidate);
  }
  
  readyToCall = () => {
    // Starts the process of joining a room.
    this.webrtc.joinRoom(this.state.roomID, (err, desc) => {
    });
  }
  
  // Show fellow peers in the room
  generateRemotes = () => this.state.peers.map((p) => (
    <div key={p.id}>
      // The video parent container needs a special id
      <div id={`${this.webrtc.getContainerId(p)}`}>
        <video
          key={this.webrtc.getId(p)}
          // Important: The video element needs both an id and ref
          id={this.webrtc.getId(p)}
          ref={(v) => this.remoteVideos[p.id] = v}
          />
      </div>
        <p>{p.nick}</p>
    </div>
    ));
  
  disconnect = () => {
    this.webrtc.stopLocalVideo();
    this.webrtc.leaveRoom();
    this.webrtc.disconnect();
  }

  componentWillUnmount() {
    this.disconnect();
  }
  
  render() {
    return (
      <div>
        <div>
            <video
              // Important: The local video element needs to have a ref
              ref={(vid) => { this.localVid = vid; }}
            />
            <p>{this.state.nick}</p>
        </div>

        <div id="remoteVideos">
          {this.generateRemotes()}
        </div>
      </div>
    );
  }
}

export default Party;
  
```

## API

### Constructor

`new LioWebRTC(options)`

- `object options`
  - `string url` - url for your socket.io signaling server.
  - `bool debug` - *optional* logs all webrtc events 
  - `string nick` - *optional* sets your nickname. Peers' nicknames can be accessed with `peer.nick`
  - `[string|DomElement|Ref] localVideoEl` - Can be a ref, DOM element, or ID of the local video
  - `bool autoRequestMedia` - *optional(=true)* automatically request
  user media. Use `true` to request automatically, or `false` to request media
  later with `startLocalVideo`
  - `bool dataOnly` *optional(=false)* option to ensure that video and audio stream channels
  are turned off
  - `bool autoRemoveVideos` - *optional(=true)* option to automatically remove
  video elements when streams are stopped.
  - `bool adjustPeerVolume` - *optional(=true)* option to reduce peer volume
  when the local participant is speaking
  - `number peerVolumeWhenSpeaking` - *optional(=.0.25)* value used in
  conjunction with `adjustPeerVolume`. Uses values between 0 and 1.
  - `object media` - media options to be passed to `getUserMedia`. Defaults to
  `{ video: true, audio: true }`. Valid configurations described
  [on MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
  with official spec
  [at w3c](http://w3c.github.io/mediacapture-main/#dom-mediadevices-getusermedia).
  - `object receiveMedia` - *optional* RTCPeerConnection options. Defaults to
  `{ offerToReceiveAudio: 1, offerToReceiveVideo: 1 }`.
  - `object localVideo` - *optional* options for attaching the local video
  stream to the page. Defaults to
  ```javascript
  {
      autoplay: true, // automatically play the video stream on the page
      mirror: true, // flip the local video to mirror mode (for UX)
      muted: true // mute local video stream to prevent echo
  }
  ```
  - `object logger` - *optional* alternate logger for the instance; any object
  that implements `log`, `warn`, and `error` methods.

### Fields

`capabilities` - the webrtcsupport module that returns an object that
describes browser capabilities.

`config` - the configuration options extended from options passed to the
constructor

`connection` - the socket (or alternate) signaling connection

`webrtc` - the underlying WebRTC session manager

### Events

To set up event listeners, use the LioWebRTC instance created with the
constructor. Example:

```js
this.webrtc.on('receivedPeerData', (type, payload, peer) => {
    // ...
})
```

`'connectionReady', sessionId` - emitted when the signaling connection emits the
`connect` event, with the unique id for the session.

`'receivedPeerData', type, payload, peer` - emitted when a peer sends data via `shout` or `whisper`
- `type` a label, usually a string, that describes the payload
- `payload` any kind of data sent by the peer, usually an object
- `peer` the object representing the peer and its peer connection

`'createdPeer', peer` - this will be emitted when:
- joining a room with existing peers, once for each peer
- a new peer joins a joined room
- sharing screen, once for each peer

- `peer` - the object representing the peer and its peer connection

`'stunservers', [...args]` - emitted when the signaling server emits this event.

`'turnservers', [...args]` - emitted when the signaling server emits this event.

`'localScreenAdded', el` - emitted after triggering the start of screen sharing

- `el` the element that contains the local screen stream

`'leftRoom', roomName` - emitted after successfully leaving the current room,
ending all peers, and stopping the local screen stream

`'videoAdded', stream, peer` - emitted when a peer stream is added
- `stream` - the MediaStream associated with the peer
- `peer` - the peer associated with the stream that was added

`'videoRemoved', peer` - emitted when a peer stream is removed
- `peer` - the peer associated with the stream that was removed

### Methods

`createRoom(name, callback)` - emits the `create` event and optionally invokes `callback` on response

`joinRoom(name, callback)` - joins the room `name`. Callback is
invoked with `callback(err, roomDescription)` where `roomDescription` is yielded
by the connection on the `join` event. See [signalmaster](https://github.com/andyet/signalmaster) for details about rooms.

`startLocalVideo()` - starts the local video or audio streams with the `media` options provided
in the config

`mute()` - mutes the local audio stream to your peers (stops sending audio in the WebRTC audio channel)

`unmute()` - unmutes the audio stream to your peers (resumes sending audio in the WebRTC audio channel)

`pauseVideo()` - pauses the video stream to your peers (stops sending video in the WebRTC video channel)

`resumeVideo()` - resumes the video stream to your peers (resumes sending video in the WebRTC video channel)

`pause()` - pauses both video and audio streams to your peers

`resume()` - resumes sending video and audio to your peers

`shout(messageType, payload)` - broadcasts a message
to all peers in the room via the default data channel
- `string messageType` - A value that represents the classification of the payload
- `object payload` - an arbitrary value or object to send to peers

`whisper(peer, messageType, payload)` - sends a message to a single peer in the room via the default data channel
- `string messageType` - A value that represents the classification of the payload
- `object payload` - an arbitrary value or object to send to peers

`sendToAll(messageType, payload)` - broadcasts a message to all peers in the
room via the signaling server

- `string messageType` - The event label that be broadcasted via the signaling server
- `object payload` - an arbitrary value or object to send to peers

`sendDirectlyToAll(messageType, payload, channel)` - broadcasts a message
to all peers in the room via a data channel

- `string messageType` - the event label that peers will listen for
- `object payload` - an arbitrary value or object
- `string channel` - (optional) the name of the data channel

`getPeers(sessionId, type)` - returns all peers by `sessionId` and/or `type`

`attachStream(stream, el)` - attaches a media stream to a video or audio element.
- `MediaStream stream` - an object representing a media stream
- `HTMLElement el` - the element (or ref if you're using React) to attach the media stream to

`shareScreen(callback)` - initiates screen capture request to browser, then streams the video to peers in the room

`getLocalScreen()` - returns the local screen stream

`stopScreenShare()` - stops the screen share stream and removes it from the room

`stopLocalVideo()` - stops all local media streams

`setVolumeForAll(volume)` - used to set the volume level for all peers

- `volume` - the volume level, between 0 and 1

`leaveRoom()` - leaves the currently joined room and stops local screen share

`disconnect()` - calls `disconnect` on the signaling connection and deletes it

`handlePeerStreamAdded(peer)` - used internally to attach media stream to the
DOM and perform other setup

`handlePeerStreamRemoved(peer)` - used internally to remove the video container
from the DOM and emit `videoRemoved`

`getId(peer)` - get the DOM id associated with a peer's media stream. In JSX, you will need to set the id of the peer's media element to this value.

`getContainerId(peer)` - get the DOM id associated with a peer's media element. In JSX, you will need to set the id of the container element to this value.




## Signaling

### Connection

For signaling, LioWebRTC uses [socket.io](http://socket.io/) to
communicate with the signaling server, and returns a connection object. The connection object comes with the following methods:

- `on(ev, fn)` - a method to set a listener
- `emit()` - send/emit arbitrary events on the connection
- `getSessionId()` - returns the session ID of the connection
- `disconnect()` - disconnect from the signaling server (closes the websocket)

### Signaling Server

LioWebRTC uses the signaling server provided for testing purposes by SimpleWebRTC.
In production, you will need to set up your own [signalmaster](https://github.com/andyet/signalmaster) server, and pass in your server's url when creating an instance of LioWebRTC. To start your signalmaster server in production mode using PM2, do the following:
```
NODE_ENV=production pm2 start signalmaster
```
