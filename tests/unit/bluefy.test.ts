import { describe, expect, it } from 'vitest';
import { deviceName, isAppleMobile, shouldSuggestBluefy } from '../../src/bluefy';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/125.0.2535.60 Mobile/15E148 Safari/605.1.15',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('isAppleMobile', () => {
  it('is true for iPhone Safari', () => expect(isAppleMobile(UA.iphoneSafari, 'iPhone', 5)).toBe(true));
  it('is true for iPhone Chrome (CriOS)', () => expect(isAppleMobile(UA.iphoneChrome, 'iPhone', 5)).toBe(true));
  it('is true for iPhone Edge (EdgiOS)', () => expect(isAppleMobile(UA.iphoneEdge, 'iPhone', 5)).toBe(true));
  it('is true for an old-style iPad user agent', () => expect(isAppleMobile(UA.ipadOld, 'iPad', 5)).toBe(true));
  it('is true for iPadOS 13+ with a Mac user agent', () => expect(isAppleMobile(UA.ipadDesktop, 'MacIntel', 5)).toBe(true));
  it('is false for a real Mac', () => expect(isAppleMobile(UA.macSafari, 'MacIntel', 0)).toBe(false));
  it('is false for Android Chrome', () => expect(isAppleMobile(UA.androidChrome, 'Linux armv81', 5)).toBe(false));
  it('is false for Windows', () => expect(isAppleMobile(UA.windowsChrome, 'Win32', 0)).toBe(false));
  it('is false for a touch-screen Windows laptop', () => expect(isAppleMobile(UA.windowsChrome, 'Win32', 10)).toBe(false));
});

describe('shouldSuggestBluefy', () => {
  const iphone = { signedIn: true, hasBluetooth: false, ua: UA.iphoneSafari, platform: 'iPhone', maxTouchPoints: 5 };

  it('suggests it to a signed-in iPhone rider with no Web Bluetooth', () => expect(shouldSuggestBluefy(iphone)).toBe(true));
  it('suggests it on iPadOS with a Mac user agent', () => {
    expect(shouldSuggestBluefy({ ...iphone, ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });
  it('does not suggest it when signed out', () => expect(shouldSuggestBluefy({ ...iphone, signedIn: false })).toBe(false));
  it('does not suggest it in Bluefy itself (Web Bluetooth present)', () => expect(shouldSuggestBluefy({ ...iphone, hasBluetooth: true })).toBe(false));
  it('does not suggest it on a Mac, Android or Windows', () => {
    expect(shouldSuggestBluefy({ ...iphone, ua: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(shouldSuggestBluefy({ ...iphone, ua: UA.androidChrome, platform: 'Linux armv81' })).toBe(false);
    expect(shouldSuggestBluefy({ ...iphone, ua: UA.windowsChrome, platform: 'Win32', maxTouchPoints: 0 })).toBe(false);
  });
});

describe('deviceName', () => {
  it('names the device', () => {
    expect(deviceName(UA.iphoneChrome, 'iPhone', 5)).toBe('iPhone');
    expect(deviceName(UA.ipadOld, 'iPad', 5)).toBe('iPad');
    expect(deviceName(UA.ipadDesktop, 'MacIntel', 5)).toBe('iPad');
    expect(deviceName('', '', 0)).toBe('iPhone or iPad');
  });
});
