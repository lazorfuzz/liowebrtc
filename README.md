# LioWebRTC
A WebRTC library that makes it easy to embed scalable peer to peer communication into UI components.

LioWebRTC works standalone, but it is also compatible with React, Vue, Electron, etc. It can be configured for scalability using partial mesh networks, making it possible to emit data to thousands of peers in a room, while only needing to be connected to at least one other peer in the room.

Peers in a LioWebRTC partial mesh network can self-optimize by default; each peer caches portions of the entire p2p network, and sends their cached graphs to newly joined peers. That means a peer can build an almost complete view of the entire graph without having to query each node (+1 scalability 😉).

[Click here](https://chatdemo.razorfart.com/) to see a chatroom demo built with LioWebRTC.

[Click here](https://vchatdemo.razorfart.com/) to see a video conferencing demo app built with LioWebRTC.

## Using LioWebRTC with React
React developers may want to take a look at [react-liowebrtc](https://github.com/lazorfuzz/react-liowebrtc).

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
    localVideoEl: localVideoIdOrRef, // The local video element
    autoRequestMedia: true, // Immediately request camera and mic access upon initialization
    debug: true, // Displays events emitted by liowebrtc in the console
    url: 'https://your-signaling-server.com:443/' // The url for your signaling server. If no url is passed, liowebrtc uses the default demo signaling server. (The default server is for demo purposes only, and is not reliable. Plus, I'm the only one paying for it 🙁. Please use your own in production!)
});
```

### Data channels only
Disable video/audio streaming, and only allow data channels.
```js
const webrtc = new LioWebRTC({
    dataOnly: true
});
```

### Audio and data channels only
Great for voice calls.
```js
const webrtc = new LioWebRTC({
    autoRequestMedia: true,
    media: {
        video: false,
        audio: true
    }
});
```

### Partial mesh network
Peers only form direct connections with a maximum of maxPeers and a minimum of minPeers. shout()ing still works because peers wil re-propagate messages to other peers. Note: partial mesh networks only work if you're only using data channels.
```js
const webrtc = new LioWebRTC({
  dataOnly: true,
  network: {
    maxPeers: 8,
    minPeers: 4
  }
})
```

### Join a room once it's ready

```js
webrtc.on('ready', () => {
    // Joins a room if it exists, creates it if it doesn't
    webrtc.joinRoom('your room name');
});
```

### Emitting to the hive
Sometimes a peer wants to let every other peer in the room to know about something. This can be accomplished with
```shout(messageType, payload)```
```js
webrtc.shout('event-label', { success: true, payload: '137' });
```
Now for the recipients, handle the peer event with a listener:
```js
webrtc.on('receivedPeerData', (type, data, peer) => {
    if (type === 'event-label' && data.success) {
        console.log(`Peer ${peer.id} emitted ${data.payload}`);
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
});
```

All communications via shout/whisper are sent over the default data channel and emitted by the LioWebRTC instance as events. You can create your own custom listeners suited for whatever purpose you'd like.

### Attaching a peer's media stream to a video element
```js
webrtc.on('peerStreamAdded', (stream, peer) => {
    webrtc.attachStream(stream, yourVideoElementOrRef);
});
```

###

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
      roomID: `party-${this.props.roomName}`,
      peers: [],
      muted: false,
      camPaused: false
    };
    this.remoteVideos = {};
  }

  componentDidMount() {
    this.webrtc = new LioWebRTC({
      // The url for your signaling server. Use your own in production!
      url: 'https://sm1.lio.app:443/',
      // The local video ref set within your render function
      localVideoEl: this.localVid,
      // Immediately request camera access
      autoRequestMedia: true,
      // Optional: nickname
      nick: this.state.nick,
      debug: true
    });

    this.webrtc.on('peerStreamAdded', this.addVideo);
    this.webrtc.on('peerStreamRemoved', this.removeVideo);
    this.webrtc.on('ready', this.readyToJoin);
    this.webrtc.on('iceFailed', this.handleConnectionError);
    this.webrtc.on('connectivityError', this.handleConnectionError);
  }

  addVideo = (stream, peer) => {
    this.setState({ peers: [...this.state.peers, peer] }, () => {
      this.webrtc.attachStream(stream, this.remoteVideos[peer.id]);
    });
  }

  removeVideo = (peer) => {
    this.setState({
      peers: this.state.peers.filter(p => !p.closed)
    });
  }

  handleConnectionError = (peer) => {
    const pc = peer.pc;
    console.log('had local relay candidate', pc.hadLocalRelayCandidate);
    console.log('had remote relay candidate', pc.hadRemoteRelayCandidate);
  }

  readyToJoin = () => {
    // Starts the process of joining a room.
    this.webrtc.joinRoom(this.state.roomID, (err, desc) => {
    });
  }

  // Show fellow peers in the room
  generateRemotes = () => this.state.peers.map((p) => (
    <div key={p.id}>
      <div id={/* The video container needs a special id */ `${this.webrtc.getContainerId(p)}`}>
        <video
          // Important: The video element needs both an id and ref
          id={this.webrtc.getId(p)}
          ref={(v) => this.remoteVideos[p.id] = v}
          />
      </div>
        <p>{p.nick}</p>
    </div>
    ));

  disconnect = () => {
    this.webrtc.quit();
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
        {this.generateRemotes()}
      </div>
    );
  }
}

export default Party;

```

## API

### Constructor Options

`new LioWebRTC(options)`

- `object options`
  - `string url` - url for your socket.io signaling server
  - `bool debug` - *optional* logs all webrtc events
  - `string nick` - *optional* sets your nickname. Peers' nicknames can be accessed with `peer.nick`
  - `[string|DomElement|Ref] localVideoEl` - Can be a ref, DOM element, or ID of the local video
  - `bool autoRequestMedia` - *optional(=false)* automatically request
  user media. Use `true` to request automatically, or `false` to request media
  later with `startLocalVideo`
  - `bool dataOnly` *optional(=false)* option to ensure that video and audio stream channels
  are turned off
  - `bool autoRemoveVideos` - *optional(=true)* option to automatically remove
  video elements when streams are stopped.
  - `bool adjustPeerVolume` - *optional(=true)* option to reduce peer volume
  when the local participant is speaking
  - `number peerVolumeWhenSpeaking` - *optional(=.0.25)* value used in
  conjunction with `adjustPeerVolume`. Uses values between 0 and 1
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
  - `object network` - *optional* options for setting minimum and maximum peers to connect to.
  Defaults to
  ```javascript
  {
    minPeers: 2, // connect to at least 2 peers
    maxPeers: 0 // when 0, maxPeers is infinite
  }
  ```
  - `bool selfOptimize` - *optional(=true)* whether or not peers in a partial mesh network should self-optimize their connections. LioWebRTC uses a more object-oriented version of an adjacency list to represent the p2p graph, with the weights of the edges representing roundtrip latency between two nodes. With `selfOptimize` set to true, peers automatically disconnect from neighbors with latencies >=1 std. deviation from the mean, and reconnect to a new random peer.

### Fields

`connection` - the socket signaling connection

`webrtc` - the underlying WebRTC session manager

### Events

To set up event listeners, use the LioWebRTC instance created with the
constructor. Example:

```js
// Emitted when a peer's media stream becomes available
this.webrtc.on('peerStreamAdded', (stream, peer) => {
    // Attach the MediaStream to a video element
    // this.webrtc.attachStream(stream, this.remoteVideos[peer.id]);
});
// Emitted when we receive data from a peer via the data channel
this.webrtc.on('receivedPeerData', (type, payload, peer) => {
    // Find something to do with the data
});
```

`'connectionReady', sessionId` - emitted when the signaling connection emits the
`connect` event, with the unique id for the session.

`'createdPeer', peer` - this will be emitted when:
- joining a room with existing peers, once for each peer
- a new peer joins your room

`'leftRoom', roomName` - emitted after successfully leaving the current room,
ending all peers, and stopping local stream

`'mute', data` - emitted when a peer mutes their video or audioOn
- `data` an object that contains an `id` property that returns the id of the peer, and a `name` property that indicates which stream was muted, `video` or `audio`

`'removedPeer', peer` - emitted when a peer loses connection or exits the room
- `peer` - the peer associated with the stream that was removed

`'ready', sessionId` - emitted when liowebrtc is ready to join a room
- `sessionId` - the socket.io connection session ID

`'receivedPeerData', type, payload, peer` - emitted when data is received from a peer that sent the data with `shout` or `whisper`
- `type` a label, usually a string, that describes the payload
- `payload` any kind of data sent by the peer, usually an object
- `peer` the object representing the peer and its peer connection

`'receivedSignalData', type, payload, peer` - emitted when data is received from a peer that sent the data via the socket.io signaling server with `broadcast` or `transmit`
- `type` a label, usually a string, that describes the payload
- `payload` any kind of data sent by the peer, usually an object
- `peer` the object representing the peer and its peer connection

`'stunservers', [...args]` - emitted when the signaling server emits a list of stun servers.

`'turnservers', [...args]` - emitted when the signaling server emits a list of turn servers.

`'unmute', data` - emitted when a peer mutes their video or audioOn
- `data` an object that contains an `id` property for the id of the peer that sent the event, and a `name` property that indicates which stream was muted, `video` or `audio`

`'peerStreamAdded', stream, peer` - emitted when a peer's MediaStream becomes available
- `stream` - the MediaStream associated with the peer
- `peer` - the peer associated with the stream that was added

`'peerStreamRemoved', peer` - emitted when a peer stream is removed
- `peer` - the peer associated with the stream that was removed

### Methods

`attachStream(stream, el, opts)` - attaches a media stream to a video or audio element
- `MediaStream stream` - an object representing a local or peer media stream
- `HTMLElement el` - the element (or ref if you're using React) to attach the media stream to, usually a video or audio element
- `object opts` - *optional* optional configuration for attachStream
    - `bool autoplay` - autoplay the video once attached. Defaults to `true`
    - `bool muted` - mute the video once attached. Defaults to `false`
    - `bool mirror` - mirror the video once attached. Defaults to `true`
    - `bool audio` - attach to `<audio>` element instead of `<video>` element. Defaults to `false`

`broadcast(messageType, payload)` - broadcasts a message to all peers in the
room via the signaling server (similar to `shout`, but not p2p). Listen for peers' broadcasts on the `receivedSignalData` event.
- `string messageType` an arbitrary label, usually a string, that describes the payload
- `object payload` - an arbitrary value or object to send to peers

`createRoom(name, callback)` - emits the `create` event and optionally invokes `callback` on response

`disconnect()` - calls `disconnect` on the signaling connection and deletes it. Peers will still be available

`emit(eventLabel, ...args)` - emit arbitrary event (Emits locally. To emit stuff other peers, use `shout`)

`getClients((err, clients))` - asks the socket.io signaling server for a list of peers currently in the room.
- `object clients` - An object whose keys are the client IDs and values are client types.

`getContainerId(peer)` - get the DOM id associated with a peer's media element. In JSX, you will need to set the id of the container element to this value
- `Peer peer` - the object representing the peer and its peer connection

`getMyId()` - get your own peer ID

`getId(peer)` - get the DOM id associated with a peer's media stream. In JSX, you will need to set the id of the peer's media element to this value.
- `Peer peer` - the object representing the peer and its peer connection

`getPeerById(id)` - returns a peer with a given `id`
- `string id`  - the id of the peer

`getPeerByNick(nick)` - returns a peer with a given `nick`
- `string nick` - the peer's nickname

`getPeers(sessionId)` - returns all peers by `sessionId`
- `string sessionId` - the sid of the current room. Will return all peers if no sessionId is provided.

`joinRoom(name, callback)` - joins the room `name`. Callback is
invoked with `callback(err, roomDescription)` where `roomDescription` is yielded
by the connection on the `join` event. See [SignalBuddy](https://github.com/lazorfuzz/signalbuddy) for more info.

`leaveRoom()` - leaves the currently joined room and stops local streams

`mute()` - mutes the local audio stream to your peers (stops sending audio in the WebRTC audio channel)

`on(ev, fn)` - creates an event listener for event `ev` handled by `fn`

`pause()` - pauses both video and audio streams to your peers

`pauseVideo()` - pauses the video stream to your peers (stops sending video in the WebRTC video channel)

`quit()` - stops the local video, leaves the currently joined room, and disconnects from the signaling server

`resume()` - resumes sending video and audio to your peers

`resumeVideo()` - resumes the video stream to your peers (resumes sending video in the WebRTC video channel)

`sendDirectlyToAll(messageType, payload, channel)` - sends a message
to all peers in the room via a data channel (same as `shout`, except you can specify your own data channel. Use this if you need to set up a new data channel, e.g. a dedicated file-sharing channel, etc.)
- `string channel` - (optional) the name of the data channel. If it doesn't exist, it will be created.

`setVolumeForAll(volume)` - set the volume level for all peers

`shout(messageType, payload)` - sends a message
to all peers in the room via the default p2p data channel. Listen for peers' shouts on the `receivedPeerData` event.
- `string messageType` - an arbitrary label, usually a string, that describes the payload
- `object payload` - an arbitrary value or object to send to peers

`startLocalVideo()` - starts the local video or audio streams with the `media` options provided
in the config. Use this if `autoRequestMedia` is set to false

`stopLocalVideo()` - stops all local media streams

`transmit(peer, messageType, payload)` - sends a message to a single peer in the
room via the signaling server (similar to `whisper`, but not p2p). Listen for peers' transmissions on the `receivedSignalData` event.
- `Peer peer` - the object representing the peer and its peer connection
- `string messageType` - an arbitrary label, usually a string, that describes the payload
- `object payload` - any kind of data sent by the peer, usually an object

`unmute()` - unmutes the audio stream to your peers (resumes sending audio in the WebRTC audio channel)
- `float volume` - the volume level, between 0 and 1

`whisper(peer, messageType, payload)` - sends a message to a single peer in the room via the default p2p data channel. Listen for peers' whispers on the `receivedPeerData` event.
- `Peer peer` - the object representing the peer and its peer connection
- `string messageType` - an arbitrary label, usually a string, that describes the payload
- `object payload` - any kind of data sent by the peer, usually an object


## Signaling

WebRTC needs to be facilitated with signaling; a service that acts as a matchmaker for peers before they establish direct video/audio/data channels. Signaling can be done in any way, e.g. via good old fashioned carrier pigeons. Signaling services only need to fulfill the absolute minimal role of matchmaking peers.

[SignalBuddy](https://github.com/lazorfuzz/signalbuddy) is a scalable [socket.io](http://socket.io/) signaling server, and is very easy to set up. socket.io enables real-time, bidirectional communication between a client and server via web sockets. It also allows us to easily segment peers into rooms.

For emitting data to peers, LioWebRTC provides a unified, event-based API that enables peers to seamlessly switch between `shout`ing (p2p data channels) or `broadcast`ing (socket.io) to all the peers in a room. It's up to you to decide which protocol to use, but socket.io should ideally only be used for transmitting things like metadata, one-off events, etc. Both protocols are real-time, bidirectional, and event-based.

### Connection

LioWebRTC wraps socketio-client and returns a connection object. This the connection to the signaling server. The connection object comes with the following methods:

- `on(ev, fn)` - a method to set a listener for event `ev`
- `emit()` - send/emit arbitrary events on the connection
- `getSessionId()` - returns the session ID of the connection
- `disconnect()` - disconnect from the signaling server (closes the web socket)

### Signaling Server Url

LioWebRTC uses SignalBuddy to facilitate signaling. LioWebRTC works out of the box with a demo SignalBuddy server that was intended for testing purposes. However, for production purposes, IT IS NOT RELIABLE. In production, you will need to set up your own [SignalBuddy](https://github.com/lazorfuzz/signalbuddy) server (or any other socket.io solution that implements matchmaking).
