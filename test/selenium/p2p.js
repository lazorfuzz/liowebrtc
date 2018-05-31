
const test = require('tape');

// https://code.google.com/p/selenium/wiki/WebDriverJs
const seleniumHelpers = require('./selenium-lib');
const webdriver = require('selenium-webdriver');

function doJoin(driver, room) {
  return driver.get(`file://${process.cwd()}/test/index.html?${room}`);
}

function testP2P(browserA, browserB, t) {
  const room = `testing_${Math.floor(Math.random() * 100000)}`;

  const userA = seleniumHelpers.buildDriver(browserA);
  doJoin(userA, room);

  const userB = seleniumHelpers.buildDriver(browserB);
  doJoin(userB, room);

  userA.wait(() => userA.executeScript(() => window.webrtc && window.webrtc.getPeers().length === 1 && window.webrtc.getPeers()[0].pc.iceConnectionState === 'connected'), 30 * 1000)
    .then(() => {
      t.pass('P2P connected');
      userA.quit();
      userB.quit().then(() => {
        t.end();
      });
    })
    .then(null, (err) => {
      t.fail(err);
      userA.quit();
      userB.quit();
    });
}

test('P2P, Chrome-Chrome', (t) => {
  testP2P('chrome', 'chrome', t);
});

test('P2P, Firefox-Firefox', (t) => {
  testP2P('firefox', 'firefox', t);
});

test('P2P, Chrome-Firefox', (t) => {
  testP2P('chrome', 'firefox', t);
});

test('P2P, Firefox-Chrome', (t) => {
  testP2P('firefox', 'chrome', t);
});
