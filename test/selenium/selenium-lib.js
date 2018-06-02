// https://code.google.com/p/selenium/wiki/WebDriverJs
const webdriver = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');
const os = require('os');

if (os.platform() === 'darwin') {
  require('chromedriver');
  require('geckodriver');
}

function buildDriver(browser) {
  // Firefox options.
  // http://selenium.googlecode.com/git/docs/api/javascript/module_selenium-webdriver_firefox.html
  const profile = new firefox.Profile();
  profile.setPreference('media.navigator.streams.fake', true);
  profile.setPreference('media.navigator.permission.disabled', true);
  profile.setPreference('xpinstall.signatures.required', false);

  const firefoxOptions = new firefox.Options()
    .setBinary(os.platform() === 'darwin' ? '' : 'browsers/bin/firefox-stable')
    .setProfile(profile);

    // Chrome options.
    // http://selenium.googlecode.com/git/docs/api/javascript/module_selenium-webdriver_chrome_class_Options.html#addArguments

  const chromeOptions = new chrome.Options()
    .setChromeBinaryPath(os.platform() === 'darwin' ? null : 'browsers/bin/chrome-stable')
    .addArguments('allow-file-access-from-files')
    .addArguments('use-fake-device-for-media-stream')
    .addArguments('use-fake-ui-for-media-stream');
  // use-file-for-fake-audio-capture -- see https://code.google.com/p/chromium/issues/detail?id=421054

  const driver = new webdriver.Builder()
    .forBrowser(browser || process.env.BROWSER || 'firefox')
    .setFirefoxOptions(firefoxOptions)
    .setChromeOptions(chromeOptions);

  if (browser === 'firefox') {
    driver.getCapabilities().set('marionette', true);
  }

  return driver.build();
}

module.exports = {
  buildDriver,
};
