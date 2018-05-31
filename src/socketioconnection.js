import io from 'socket.io-client';

class SocketIoConnection {
  constructor(config) {
    this.connection = io.connect(config.url, config.socketio);
  }

  on(ev, fn) {
    this.connection.on(ev, fn);
  }

  emit() {
    this.connection.emit(...arguments);
  }

  getSessionid() {
    return this.connection.id;
  }

  disconnect() {
    return this.connection.disconnect();
  }
}

export default SocketIoConnection;
